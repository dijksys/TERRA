//go:build integration

package integration_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"terra/internal/admin"
	"terra/internal/audit"
	"terra/internal/downloads"
	drivepkg "terra/internal/drive"
	"terra/internal/organization"
	"terra/internal/users"
	"terra/tests/helpers"
)

func seedDashboardJob(t *testing.T, pool *pgxpool.Pool, repo *downloads.Repository, requester, owner, conn,
	area, position uuid.UUID, key, status string, age time.Duration) uuid.UUID {
	t.Helper()
	job, _, err := repo.Create(context.Background(), &downloads.Job{
		ID: uuid.New(), RequestedByUserID: requester, DriveOwnerUserID: owner,
		DriveConnectionID: conn, AreaID: area, PositionID: position,
		AreaName: "Área Dashboard", PositionName: "Cargo Dashboard", AreaSlug: "area-dashboard",
		PositionSlug: "cargo-dashboard", ScopeType: downloads.ScopeMyDriveFull, IdempotencyKey: key,
	}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `UPDATE download_jobs
		SET status=$2, created_at=now()-make_interval(secs => $3) WHERE id=$1`, job.ID, status, age.Seconds()); err != nil {
		t.Fatal(err)
	}
	return job.ID
}

func TestAdminDashboardReflectsOperationalState(t *testing.T) {
	pool := helpers.Pool(t)
	ctx := context.Background()
	areaID, positionID := helpers.SeedOrganization(t, pool, "Área Dashboard", "Cargo Dashboard")
	_, _ = helpers.SeedOrganization(t, pool, "Área Secundaria", "Cargo Secundario")
	active1 := helpers.SeedUser(t, pool, areaID, positionID, "active")
	active2 := helpers.SeedUser(t, pool, areaID, positionID, "active")
	active3 := helpers.SeedUser(t, pool, areaID, positionID, "active")
	_ = helpers.SeedUser(t, pool, areaID, positionID, "pending_profile")
	_ = helpers.SeedUser(t, pool, areaID, positionID, "suspended")
	helpers.SeedPolicy(t, pool, "2026-11")

	conn1 := helpers.SeedConnection(t, pool, active1, "2026-11")
	_ = helpers.SeedConnection(t, pool, active2, "2026-11")
	conn3 := helpers.SeedConnection(t, pool, active3, "2026-11")
	if _, err := pool.Exec(ctx, `UPDATE drive_connections SET refresh_token_ciphertext='\x01'::bytea WHERE id=$1`, conn1); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE drive_connections SET status='reauthorization_required' WHERE id=$1`, conn3); err != nil {
		t.Fatal(err)
	}

	repo := downloads.NewRepository(pool)
	queued1 := seedDashboardJob(t, pool, repo, active1, active1, conn1, areaID, positionID,
		"dashboard-queued-1", downloads.JobQueued, 20*time.Minute)
	seedDashboardJob(t, pool, repo, active1, active1, conn1, areaID, positionID,
		"dashboard-queued-2", downloads.JobQueued, 5*time.Minute)
	seedDashboardJob(t, pool, repo, active1, active1, conn1, areaID, positionID,
		"dashboard-scanning", downloads.JobScanning, time.Minute)
	seedDashboardJob(t, pool, repo, active1, active1, conn1, areaID, positionID,
		"dashboard-downloading", downloads.JobDownloading, time.Minute)
	seedDashboardJob(t, pool, repo, active1, active1, conn1, areaID, positionID,
		"dashboard-cancel", downloads.JobCancelRequested, time.Minute)
	seedDashboardJob(t, pool, repo, active1, active1, conn1, areaID, positionID,
		"dashboard-waiting", downloads.JobWaitingAuthorization, 5*time.Minute)
	completed := seedDashboardJob(t, pool, repo, active1, active1, conn1, areaID, positionID,
		"dashboard-completed", downloads.JobCompleted, time.Hour)
	seedDashboardJob(t, pool, repo, active1, active1, conn1, areaID, positionID,
		"dashboard-completed-2", downloads.JobCompleted, time.Hour)
	seedDashboardJob(t, pool, repo, active1, active1, conn1, areaID, positionID,
		"dashboard-failed", downloads.JobFailed, time.Hour)
	seedDashboardJob(t, pool, repo, active1, active1, conn1, areaID, positionID,
		"dashboard-partial", downloads.JobPartiallyCompleted, time.Hour)

	driveRepo := drivepkg.NewRepository(pool)
	nodeID, err := driveRepo.UpsertNode(ctx, conn1, drivepkg.RemoteFile{
		ID: "dashboard-file", Name: "Resumen.pdf", MimeType: "application/pdf", CanDownload: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	relativePath := "areas/dashboard/Resumen.pdf"
	if _, err := repo.CreateItem(ctx, completed, nodeID, relativePath, downloads.ItemPending, nil, "", ""); err != nil {
		t.Fatal(err)
	}
	var itemID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM download_items WHERE job_id=$1 AND drive_node_id=$2`,
		completed, nodeID).Scan(&itemID); err != nil {
		t.Fatal(err)
	}
	if err := repo.MarkCompleted(ctx, completed, active1, itemID, nodeID, relativePath,
		1234, "sha", "", "rev", nil); err != nil {
		t.Fatal(err)
	}
	_ = queued1

	auditRepo := audit.NewRepository(pool)
	actor := active1
	auditRepo.Record(ctx, audit.Event{ActorUserID: &actor, Action: "download_job.created", TargetType: "download_job"})
	auditRepo.Record(ctx, audit.Event{ActorUserID: &actor, Action: "admin.account.created", TargetType: "account"})

	svc := admin.NewService(pool, users.NewRepository(pool), organization.NewRepository(pool),
		auditRepo, driveRepo, repo)
	svc.SetQueueWarningThreshold(15 * time.Minute)

	dashboard, err := svc.Dashboard(ctx, audit.ScopeFull)
	if err != nil {
		t.Fatal(err)
	}
	if dashboard.ActiveUsers != 3 || dashboard.PendingProfiles != 1 || dashboard.SuspendedUsers != 1 {
		t.Fatalf("usuarios: %+v", dashboard)
	}
	if dashboard.Areas != 2 || dashboard.Positions != 2 {
		t.Fatalf("organización: areas=%d positions=%d", dashboard.Areas, dashboard.Positions)
	}
	if dashboard.QueuedJobs != 2 || dashboard.RunningJobs != 3 || dashboard.WaitingAuthJobs != 1 {
		t.Fatalf("trabajos activos: %+v", dashboard)
	}
	if dashboard.CompletedJobs != 2 || dashboard.FailedJobs != 2 {
		t.Fatalf("trabajos terminales: %+v", dashboard)
	}
	if dashboard.StoredBytes != 1234 {
		t.Fatalf("almacenamiento=%d", dashboard.StoredBytes)
	}
	if dashboard.ConnectedDrives != 1 || dashboard.ReauthDrives != 2 {
		t.Fatalf("drives: connected=%d reauth=%d", dashboard.ConnectedDrives, dashboard.ReauthDrives)
	}
	if dashboard.OldestQueuedAgeSec < 19*60 || dashboard.OldestWaitingAuthAgeSec < 4*60 {
		t.Fatalf("antigüedades: queued=%d waiting=%d", dashboard.OldestQueuedAgeSec, dashboard.OldestWaitingAuthAgeSec)
	}
	if dashboard.QueueWarningThresholdSec != 900 {
		t.Fatalf("umbral=%d", dashboard.QueueWarningThresholdSec)
	}
	if len(dashboard.RecentAudit) != 2 {
		t.Fatalf("auditoría completa=%d", len(dashboard.RecentAudit))
	}

	operational, err := svc.Dashboard(ctx, audit.ScopeOperational)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range operational.RecentAudit {
		if event.Action == "admin.account.created" {
			t.Fatal("la auditoría operacional no debe incluir eventos administrativos")
		}
	}
}

func TestAdminDashboardEmptyState(t *testing.T) {
	pool := helpers.Pool(t)
	ctx := context.Background()
	svc := admin.NewService(pool, users.NewRepository(pool), organization.NewRepository(pool),
		audit.NewRepository(pool), drivepkg.NewRepository(pool), downloads.NewRepository(pool))
	dashboard, err := svc.Dashboard(ctx, audit.ScopeFull)
	if err != nil {
		t.Fatal(err)
	}
	if dashboard.OldestQueuedAgeSec != 0 || dashboard.OldestWaitingAuthAgeSec != 0 ||
		dashboard.QueuedJobs != 0 || dashboard.ConnectedDrives != 0 || dashboard.ReauthDrives != 0 {
		t.Fatalf("estado vacío: %+v", dashboard)
	}
}
