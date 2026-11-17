//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"terra/internal/audit"
	"terra/internal/auth"
	"terra/internal/downloads"
	"terra/internal/platform/config"
	"terra/internal/platform/crypto"
	"terra/internal/realtime"
	"terra/internal/storage"
	"terra/internal/users"
	"terra/tests/helpers"
)

func TestRealtimeAuthenticatesAndAuthorizesChannels(t *testing.T) {
	pool := helpers.Pool(t)
	areaID, positionID := helpers.SeedOrganization(t, pool, "Área Tiempo Real", "Cargo Tiempo Real")
	adminID := seedRealtimeAdmin(t, pool, areaID, positionID)
	workerID := helpers.SeedUser(t, pool, areaID, positionID, "active")
	otherID := helpers.SeedUser(t, pool, areaID, positionID, "active")
	helpers.SeedPolicy(t, pool, "2026-11")
	connID := helpers.SeedConnection(t, pool, workerID, "2026-11")
	otherConnID := helpers.SeedConnection(t, pool, otherID, "2026-11")

	ctx := context.Background()
	usersRepo := users.NewRepository(pool)
	authRepo := auth.NewRepository(pool)
	downloadRepo := downloads.NewRepository(pool)
	store, err := storage.New(t.TempDir(), 1)
	if err != nil {
		t.Fatal(err)
	}
	downloadSvc := downloads.NewService(config.Config{}, downloadRepo, nil, usersRepo, store, audit.NewRepository(pool))
	cfg := config.Config{PublicURL: "http://localhost:8080", SessionCookie: "terra_session", SessionTTL: time.Hour}
	svc := realtime.NewService(cfg, slog.Default(), pool, downloadSvc, downloadRepo, authRepo, usersRepo,
		func(context.Context, bool) (any, error) { return map[string]any{"queued_jobs": 3}, nil })

	handler := httptest.NewServer(http.HandlerFunc(svc.ServeHTTP))
	defer handler.Close()
	wsURL := "ws" + strings.TrimPrefix(handler.URL, "http") + "/api/v1/realtime"

	workerSession := createRealtimeSession(t, authRepo, workerID, "worker-token")
	adminSession := createRealtimeSession(t, authRepo, adminID, "admin-token")

	workerConn := dialRealtime(t, wsURL, "terra_session="+workerSession)
	defer workerConn.Close(websocket.StatusNormalClosure, "test")
	readRealtimeType(t, workerConn, "connection.ready")
	writeRealtime(t, workerConn, map[string]any{"type": "subscribe", "channel": "admin.dashboard"})
	message := readRealtime(t, workerConn)
	if message.Type != "realtime.error" {
		t.Fatalf("el trabajador recibió dashboard: %s", message.Type)
	}

	adminConn := dialRealtime(t, wsURL, "terra_session="+adminSession)
	defer adminConn.Close(websocket.StatusNormalClosure, "test")
	readRealtimeType(t, adminConn, "connection.ready")
	writeRealtime(t, adminConn, map[string]any{"type": "subscribe", "channel": "admin.dashboard"})
	message = readRealtime(t, adminConn)
	if message.Type != "dashboard.snapshot" {
		t.Fatalf("dashboard no autorizado: %s", message.Type)
	}

	job, _, err := downloadRepo.Create(ctx, &downloads.Job{
		ID: uuid.New(), RequestedByUserID: workerID, DriveOwnerUserID: workerID,
		DriveConnectionID: connID, AreaID: areaID, PositionID: positionID,
		AreaName: "Área Tiempo Real", PositionName: "Cargo Tiempo Real", AreaSlug: "area-tiempo-real",
		PositionSlug: "cargo-tiempo-real", ScopeType: downloads.ScopeMyDriveFull,
		IdempotencyKey: "realtime-own",
	}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	otherJob, _, err := downloadRepo.Create(ctx, &downloads.Job{
		ID: uuid.New(), RequestedByUserID: otherID, DriveOwnerUserID: otherID,
		DriveConnectionID: otherConnID, AreaID: areaID, PositionID: positionID,
		AreaName: "Área Tiempo Real", PositionName: "Cargo Tiempo Real", AreaSlug: "area-tiempo-real",
		PositionSlug: "cargo-tiempo-real", ScopeType: downloads.ScopeMyDriveFull,
		IdempotencyKey: "realtime-other",
	}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}

	writeRealtime(t, workerConn, map[string]any{"type": "subscribe", "channel": "job:" + job.ID.String()})
	message = readRealtime(t, workerConn)
	if message.Type != "job.snapshot" {
		t.Fatalf("snapshot propio no recibido: %s", message.Type)
	}
	writeRealtime(t, workerConn, map[string]any{"type": "subscribe", "channel": "job:" + otherJob.ID.String()})
	message = readRealtime(t, workerConn)
	if message.Type != "realtime.error" {
		t.Fatalf("acceso a trabajo ajeno permitido: %s", message.Type)
	}
}

func createRealtimeSession(t *testing.T, repo *auth.Repository, userID uuid.UUID, token string) string {
	t.Helper()
	_, err := repo.CreateSession(context.Background(), userID, crypto.HashToken(token), "csrf",
		time.Now().Add(time.Hour), "realtime-test", "ip")
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func dialRealtime(t *testing.T, url, cookie string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: http.Header{
		"Cookie": {cookie},
		"Origin": {"http://localhost:8080"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	return conn
}

func writeRealtime(t *testing.T, conn *websocket.Conn, value any) {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageText, raw); err != nil {
		t.Fatal(err)
	}
}

func readRealtime(t *testing.T, conn *websocket.Conn) realtime.Message {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, raw, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var message realtime.Message
	if err := json.Unmarshal(raw, &message); err != nil {
		t.Fatal(err)
	}
	return message
}

func readRealtimeType(t *testing.T, conn *websocket.Conn, want string) realtime.Message {
	t.Helper()
	message := readRealtime(t, conn)
	if message.Type != want {
		t.Fatalf("mensaje=%s, se esperaba %s", message.Type, want)
	}
	return message
}

func seedRealtimeAdmin(t *testing.T, pool *pgxpool.Pool, areaID, positionID uuid.UUID) uuid.UUID {
	t.Helper()
	id := helpers.SeedUser(t, pool, areaID, positionID, "active")
	if _, err := pool.Exec(context.Background(), `INSERT INTO user_roles (user_id, role_id)
		SELECT $1, id FROM system_roles WHERE key='admin' ON CONFLICT DO NOTHING`, id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestRealtimePublishesDurableItemTransitions(t *testing.T) {
	pool := helpers.Pool(t)
	areaID, positionID := helpers.SeedOrganization(t, pool, "Área Eventos", "Cargo Eventos")
	workerID := helpers.SeedUser(t, pool, areaID, positionID, "active")
	helpers.SeedPolicy(t, pool, "2026-11")
	connID := helpers.SeedConnection(t, pool, workerID, "2026-11")

	ctx := context.Background()
	usersRepo := users.NewRepository(pool)
	authRepo := auth.NewRepository(pool)
	downloadRepo := downloads.NewRepository(pool)
	downloadSvc := downloads.NewService(config.Config{}, downloadRepo, nil, usersRepo, nil, audit.NewRepository(pool))
	cfg := config.Config{PublicURL: "http://localhost:8080", SessionCookie: "terra_session", SessionTTL: time.Hour}
	svc := realtime.NewService(cfg, slog.Default(), pool, downloadSvc, downloadRepo, authRepo, usersRepo, nil)
	defer svc.Close()

	listenerCtx, stopListener := context.WithCancel(context.Background())
	defer stopListener()
	go svc.RunListener(listenerCtx, helpers.DatabaseURL())
	waitForListener(t, pool)

	handler := httptest.NewServer(http.HandlerFunc(svc.ServeHTTP))
	defer handler.Close()
	wsURL := "ws" + strings.TrimPrefix(handler.URL, "http") + "/api/v1/realtime"
	session := createRealtimeSession(t, authRepo, workerID, "event-token")
	conn := dialRealtime(t, wsURL, "terra_session="+session)
	defer conn.Close(websocket.StatusNormalClosure, "test")
	readRealtimeType(t, conn, "connection.ready")

	job, _, err := downloadRepo.Create(ctx, &downloads.Job{
		ID: uuid.New(), RequestedByUserID: workerID, DriveOwnerUserID: workerID,
		DriveConnectionID: connID, AreaID: areaID, PositionID: positionID,
		AreaName: "Área Eventos", PositionName: "Cargo Eventos", AreaSlug: "area-eventos",
		PositionSlug: "cargo-eventos", ScopeType: downloads.ScopeMyDriveFull,
		IdempotencyKey: "realtime-events",
	}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	writeRealtime(t, conn, map[string]any{"type": "subscribe", "channel": "job:" + job.ID.String()})
	readRealtimeType(t, conn, "job.snapshot")

	for _, event := range []struct {
		eventType string
		message   string
	}{
		{"item.started", "job.item.started"},
		{"item.completed", "job.item.completed"},
		{"item.skipped", "job.item.skipped"},
		{"item.failed", "job.item.failed"},
		{"item.retrying", "job.item.retrying"},
		{"job.done", "job.done"},
		{"job.queued", "job.stage"},
	} {
		itemID := uuid.NewString()
		downloadRepo.AddEvent(ctx, job.ID, event.eventType, map[string]any{
			"item_id": itemID, "name": "archivo.bin", "status": "test",
		})
		var eventID int64
		if err := pool.QueryRow(ctx, `SELECT max(id) FROM job_events WHERE job_id=$1`, job.ID).Scan(&eventID); err != nil {
			t.Fatal(err)
		}
		message := readRealtime(t, conn)
		if message.Type != event.message {
			t.Fatalf("%s se publicó como %s", event.eventType, message.Type)
		}
		if message.EventID != eventID {
			t.Fatalf("%s event_id=%d, esperado %d", event.eventType, message.EventID, eventID)
		}
		data, ok := message.Data.(map[string]any)
		if !ok || data["event_id"] != float64(eventID) {
			t.Fatalf("%s payload sin event_id: %+v", event.eventType, message.Data)
		}
		payload, ok := data["payload"].(map[string]any)
		if !ok || payload["item_id"] != itemID {
			t.Fatalf("%s payload sin item_id: %+v", event.eventType, data["payload"])
		}
	}
}

func waitForListener(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var listening bool
		err := pool.QueryRow(context.Background(), `SELECT EXISTS (
			SELECT 1 FROM pg_stat_activity WHERE query ILIKE '%LISTEN terra_events%')`).Scan(&listening)
		if err != nil {
			t.Fatal(err)
		}
		if listening {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("el listener de PostgreSQL no se inició")
}

func TestWorkerDashboardChannelSnapshotAndIsolation(t *testing.T) {
	pool := helpers.Pool(t)
	areaID, positionID := helpers.SeedOrganization(t, pool, "Área Worker WS", "Cargo Worker WS")
	workerA := helpers.SeedUser(t, pool, areaID, positionID, "active")
	workerB := helpers.SeedUser(t, pool, areaID, positionID, "active")
	workerC := helpers.SeedUser(t, pool, areaID, positionID, "active")
	adminID := seedRealtimeAdmin(t, pool, areaID, positionID)
	helpers.SeedPolicy(t, pool, "2026-11")
	connIDA := helpers.SeedConnection(t, pool, workerA, "2026-11")
	connIDB := helpers.SeedConnection(t, pool, workerB, "2026-11")

	ctx := context.Background()
	usersRepo := users.NewRepository(pool)
	authRepo := auth.NewRepository(pool)
	downloadRepo := downloads.NewRepository(pool)
	downloadSvc := downloads.NewService(config.Config{}, downloadRepo, nil, usersRepo, nil, audit.NewRepository(pool))
	cfg := config.Config{PublicURL: "http://localhost:8080", SessionCookie: "terra_session", SessionTTL: time.Hour}
	svc := realtime.NewService(cfg, slog.Default(), pool, downloadSvc, downloadRepo, authRepo, usersRepo, nil)
	defer svc.Close()
	listenerCtx, stopListener := context.WithCancel(context.Background())
	defer stopListener()
	go svc.RunListener(listenerCtx, helpers.DatabaseURL())
	waitForListener(t, pool)

	handler := httptest.NewServer(http.HandlerFunc(svc.ServeHTTP))
	defer handler.Close()
	wsURL := "ws" + strings.TrimPrefix(handler.URL, "http") + "/api/v1/realtime"
	dial := func(userID uuid.UUID, token string) *websocket.Conn {
		session := createRealtimeSession(t, authRepo, userID, token)
		conn := dialRealtime(t, wsURL, "terra_session="+session)
		readRealtimeType(t, conn, "connection.ready")
		return conn
	}
	connA := dial(workerA, "worker-a-token")
	defer connA.Close(websocket.StatusNormalClosure, "test")
	connB := dial(workerB, "worker-b-token")
	defer connB.Close(websocket.StatusNormalClosure, "test")
	connC := dial(workerC, "worker-c-token")
	defer connC.Close(websocket.StatusNormalClosure, "test")

	for index := 0; index < 7; index++ {
		seedRealtimeJob(t, pool, downloadRepo, workerA, workerA, connIDA, areaID, positionID, "worker-a-"+string(rune('a'+index)))
	}
	seedRealtimeJob(t, pool, downloadRepo, workerB, workerB, connIDB, areaID, positionID, "worker-b")

	writeRealtime(t, connA, map[string]any{"type": "subscribe", "channel": "worker.dashboard"})
	snapshotA := readRealtimeType(t, connA, "worker.dashboard.snapshot")
	dataA := snapshotA.Data.(map[string]any)
	if dataA["summary"].(map[string]any)["active_jobs"] != float64(7) {
		t.Fatalf("resumen A: %+v", dataA["summary"])
	}
	if len(dataA["recent"].([]any)) != 5 {
		t.Fatalf("recientes A: %d", len(dataA["recent"].([]any)))
	}

	writeRealtime(t, connB, map[string]any{"type": "subscribe", "channel": "worker.dashboard"})
	snapshotB := readRealtimeType(t, connB, "worker.dashboard.snapshot")
	if snapshotB.Data.(map[string]any)["summary"].(map[string]any)["active_jobs"] != float64(1) {
		t.Fatalf("resumen B: %+v", snapshotB.Data)
	}
	writeRealtime(t, connC, map[string]any{"type": "subscribe", "channel": "worker.dashboard"})
	snapshotC := readRealtimeType(t, connC, "worker.dashboard.snapshot")
	if snapshotC.Data.(map[string]any)["summary"].(map[string]any)["total_jobs"] != float64(0) {
		t.Fatalf("resumen C: %+v", snapshotC.Data)
	}

	adminConn := dial(adminID, "admin-worker-channel-token")
	defer adminConn.Close(websocket.StatusNormalClosure, "test")
	writeRealtime(t, adminConn, map[string]any{"type": "subscribe", "channel": "worker.dashboard"})
	readRealtimeType(t, adminConn, "realtime.error")

	// Un trabajo solicitado por B pero con Drive de A actualiza a ambos.
	shared := seedRealtimeJob(t, pool, downloadRepo, workerB, workerA, connIDA, areaID, positionID, "worker-shared")
	downloadRepo.AddEvent(ctx, shared, "job.queued", map[string]any{"status": "queued"})
	metricsA := readRealtimeType(t, connA, "worker.dashboard.metrics")
	metricsB := readRealtimeType(t, connB, "worker.dashboard.metrics")
	if metricsA.Data.(map[string]any)["summary"].(map[string]any)["active_jobs"] != float64(8) {
		t.Fatalf("métricas A: %+v", metricsA.Data)
	}
	if metricsB.Data.(map[string]any)["summary"].(map[string]any)["active_jobs"] != float64(2) {
		t.Fatalf("métricas B: %+v", metricsB.Data)
	}
	if _, err := readRealtimeTimeout(t, connC); err == nil {
		t.Fatal("el trabajador C recibió métricas ajenas")
	}

	// La reconexión entrega un snapshot con el estado persistido actual.
	connA.Close(websocket.StatusNormalClosure, "reconnect")
	connA2 := dial(workerA, "worker-a-second-token")
	defer connA2.Close(websocket.StatusNormalClosure, "test")
	writeRealtime(t, connA2, map[string]any{"type": "subscribe", "channel": "worker.dashboard"})
	reconnected := readRealtimeType(t, connA2, "worker.dashboard.snapshot")
	if reconnected.Data.(map[string]any)["summary"].(map[string]any)["active_jobs"] != float64(8) {
		t.Fatalf("snapshot tras reconexión: %+v", reconnected.Data)
	}
}

func seedRealtimeJob(t *testing.T, pool *pgxpool.Pool, repo *downloads.Repository, requester, owner, conn,
	area, position uuid.UUID, key string) uuid.UUID {
	t.Helper()
	job, _, err := repo.Create(context.Background(), &downloads.Job{
		ID: uuid.New(), RequestedByUserID: requester, DriveOwnerUserID: owner,
		DriveConnectionID: conn, AreaID: area, PositionID: position,
		AreaName: "Área Worker WS", PositionName: "Cargo Worker WS", AreaSlug: "area-worker-ws",
		PositionSlug: "cargo-worker-ws", ScopeType: downloads.ScopeMyDriveFull, IdempotencyKey: key,
	}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	return job.ID
}

func readRealtimeTimeout(t *testing.T, conn *websocket.Conn) (realtime.Message, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
	defer cancel()
	_, raw, err := conn.Read(ctx)
	if err != nil {
		return realtime.Message{}, err
	}
	var message realtime.Message
	if err := json.Unmarshal(raw, &message); err != nil {
		t.Fatal(err)
	}
	return message, nil
}
