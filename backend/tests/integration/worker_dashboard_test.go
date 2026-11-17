//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"terra/internal/downloads"
	"terra/internal/platform/config"
	"terra/internal/platform/principal"
	"terra/internal/platform/rbac"
	"terra/tests/helpers"
)

func seedSummaryJob(t *testing.T, pool *pgxpool.Pool, repo *downloads.Repository, requester, owner, conn uuid.UUID,
	area, position uuid.UUID, key, status string) uuid.UUID {
	t.Helper()
	job, _, err := repo.Create(context.Background(), &downloads.Job{
		ID: uuid.New(), RequestedByUserID: requester, DriveOwnerUserID: owner,
		DriveConnectionID: conn, AreaID: area, PositionID: position,
		AreaName: "Área Resumen", PositionName: "Cargo Resumen", AreaSlug: "area-resumen",
		PositionSlug: "cargo-resumen", ScopeType: downloads.ScopeMyDriveFull, IdempotencyKey: key,
	}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE download_jobs SET status=$2 WHERE id=$1`, job.ID, status); err != nil {
		t.Fatal(err)
	}
	return job.ID
}

func TestWorkerDashboardSummaryAggregatesAccessibleJobs(t *testing.T) {
	pool := helpers.Pool(t)
	ctx := context.Background()
	areaID, positionID := helpers.SeedOrganization(t, pool, "Área Resumen", "Cargo Resumen")
	workerID := helpers.SeedUser(t, pool, areaID, positionID, "active")
	otherID := helpers.SeedUser(t, pool, areaID, positionID, "active")
	adminID := helpers.SeedUser(t, pool, areaID, positionID, "active")
	if _, err := pool.Exec(ctx, `INSERT INTO user_roles (user_id, role_id)
		SELECT $1, id FROM system_roles WHERE key='admin' ON CONFLICT DO NOTHING`, adminID); err != nil {
		t.Fatal(err)
	}
	helpers.SeedPolicy(t, pool, "2026-11")
	workerConn := helpers.SeedConnection(t, pool, workerID, "2026-11")
	otherConn := helpers.SeedConnection(t, pool, otherID, "2026-11")

	repo := downloads.NewRepository(pool)
	service := downloads.NewService(config.Config{}, repo, nil, nil, nil, nil)

	summary, err := service.Summary(ctx, workerID, false)
	if err != nil || summary.ActiveJobs != 0 || summary.TotalJobs != 0 {
		t.Fatalf("resumen vacío: %+v err=%v", summary, err)
	}

	for index, status := range []string{
		downloads.JobQueued, downloads.JobQueued, downloads.JobScanning, downloads.JobDownloading,
		downloads.JobDownloading, downloads.JobWaitingAuthorization, downloads.JobCancelRequested,
	} {
		seedSummaryJob(t, pool, repo, workerID, workerID, workerConn, areaID, positionID,
			"active-"+string(rune('a'+index)), status)
	}
	seedSummaryJob(t, pool, repo, workerID, workerID, workerConn, areaID, positionID, "terminal-completed", downloads.JobCompleted)
	seedSummaryJob(t, pool, repo, workerID, workerID, workerConn, areaID, positionID, "terminal-failed", downloads.JobFailed)
	// Acceso por ser solicitante aunque el Drive sea de otro trabajador.
	seedSummaryJob(t, pool, repo, workerID, otherID, otherConn, areaID, positionID, "requester-access", downloads.JobQueued)
	// Acceso por ser propietario aunque el solicitante sea el administrador.
	seedSummaryJob(t, pool, repo, adminID, workerID, workerConn, areaID, positionID, "owner-access", downloads.JobScanning)
	// No accesible para el trabajador.
	seedSummaryJob(t, pool, repo, otherID, otherID, otherConn, areaID, positionID, "foreign", downloads.JobDownloading)

	summary, err = service.Summary(ctx, workerID, false)
	if err != nil {
		t.Fatal(err)
	}
	want := downloads.JobSummary{
		ActiveJobs: 9, QueuedJobs: 3, ScanningJobs: 2, DownloadingJobs: 2,
		WaitingAuthorizationJobs: 1, CancelRequestedJobs: 1, TotalJobs: 11,
	}
	if *summary != want {
		t.Fatalf("resumen trabajador=%+v, esperado %+v", *summary, want)
	}

	adminSummary, err := service.Summary(ctx, adminID, true)
	if err != nil {
		t.Fatal(err)
	}
	if adminSummary.TotalJobs != 12 || adminSummary.ActiveJobs != 10 || adminSummary.DownloadingJobs != 3 {
		t.Fatalf("resumen administrativo=%+v", *adminSummary)
	}

	// El endpoint aplica el alcance según el permiso del principal autenticado.
	handler := downloads.NewHandler(service, repo, config.Config{}, "ip-secret")
	serveSummary := func(actorID uuid.UUID, admin bool) *httptest.ResponseRecorder {
		permissions := []string{}
		if admin {
			permissions = rbac.PermissionsFor([]string{"admin"})
		}
		req := httptest.NewRequest(http.MethodGet, "/api/v1/download-jobs/summary", nil)
		req = req.WithContext(principal.With(req.Context(), principal.Principal{User: principal.Identity{
			ID: actorID, Status: "active", Permissions: permissions,
		}}))
		rec := httptest.NewRecorder()
		handler.Summary(rec, req)
		return rec
	}

	rec := serveSummary(workerID, false)
	var body downloads.JobSummary
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &body) != nil || body.ActiveJobs != 9 {
		t.Fatalf("handler trabajador: %d %s", rec.Code, rec.Body.String())
	}
	rec = serveSummary(adminID, true)
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &body) != nil || body.ActiveJobs != 10 {
		t.Fatalf("handler administrador: %d %s", rec.Code, rec.Body.String())
	}
}
