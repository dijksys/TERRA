//go:build integration

package integration_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"terra/internal/downloads"
	"terra/tests/helpers"
)

func TestJobStatusGroupsApplyToCountAndList(t *testing.T) {
	pool := helpers.Pool(t)
	areaID, positionID := helpers.SeedOrganization(t, pool, "Área Estados", "Cargo Estados")
	ownerID := helpers.SeedUser(t, pool, areaID, positionID, "active")
	helpers.SeedPolicy(t, pool, "2026-11")
	connID := helpers.SeedConnection(t, pool, ownerID, "2026-11")
	ctx := context.Background()
	repo := downloads.NewRepository(pool)

	statuses := []string{
		downloads.JobQueued, downloads.JobScanning, downloads.JobDownloading,
		downloads.JobWaitingAuthorization, downloads.JobCancelRequested,
		downloads.JobCompleted, downloads.JobFailed, downloads.JobPartiallyCompleted,
		downloads.JobCancelled,
	}
	for index, status := range statuses {
		job, _, err := repo.Create(ctx, &downloads.Job{
			ID: uuid.New(), RequestedByUserID: ownerID, DriveOwnerUserID: ownerID,
			DriveConnectionID: connID, AreaID: areaID, PositionID: positionID,
			AreaName: "Área Estados", PositionName: "Cargo Estados", AreaSlug: "area-estados",
			PositionSlug: "cargo-estados", ScopeType: downloads.ScopeMyDriveFull,
			IdempotencyKey: "status-" + status + "-" + string(rune('a'+index)),
		}, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE download_jobs SET status=$2 WHERE id=$1`, job.ID, status); err != nil {
			t.Fatal(err)
		}
	}

	assertGroup := func(filter string, want int, wantStatuses map[string]bool) {
		t.Helper()
		jobs, total, err := repo.List(ctx, downloads.ListFilter{Status: filter, Page: 1, Size: 20})
		if err != nil {
			t.Fatal(err)
		}
		if total != want || len(jobs) != want {
			t.Fatalf("%s: total=%d len=%d", filter, total, len(jobs))
		}
		for _, job := range jobs {
			if !wantStatuses[job.Status] {
				t.Fatalf("%s incluyó estado %s", filter, job.Status)
			}
		}
	}

	assertGroup("active", 5, map[string]bool{
		downloads.JobQueued: true, downloads.JobScanning: true, downloads.JobDownloading: true,
		downloads.JobWaitingAuthorization: true, downloads.JobCancelRequested: true,
	})
	assertGroup("attention", 2, map[string]bool{
		downloads.JobFailed: true, downloads.JobPartiallyCompleted: true,
	})
	assertGroup(downloads.JobCompleted, 1, map[string]bool{downloads.JobCompleted: true})
	assertGroup(downloads.JobCancelled, 1, map[string]bool{downloads.JobCancelled: true})
}
