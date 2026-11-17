//go:build integration

package integration_test

import (
	"context"
	"testing"

	drivepkg "terra/internal/drive"
	"terra/tests/helpers"
)

func TestAdminConnectionsUseRefreshTokenSemantics(t *testing.T) {
	pool := helpers.Pool(t)
	areaID, positionID := helpers.SeedOrganization(t, pool, "Área Conexiones", "Cargo Conexiones")
	withToken := helpers.SeedUser(t, pool, areaID, positionID, "active")
	withoutToken := helpers.SeedUser(t, pool, areaID, positionID, "active")
	reauth := helpers.SeedUser(t, pool, areaID, positionID, "active")
	revoked := helpers.SeedUser(t, pool, areaID, positionID, "active")
	helpers.SeedPolicy(t, pool, "2026-11")
	tokenConn := helpers.SeedConnection(t, pool, withToken, "2026-11")
	_ = helpers.SeedConnection(t, pool, withoutToken, "2026-11")
	reauthConn := helpers.SeedConnection(t, pool, reauth, "2026-11")
	revokedConn := helpers.SeedConnection(t, pool, revoked, "2026-11")
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `UPDATE drive_connections SET refresh_token_ciphertext='\x01'::bytea WHERE id=$1`, tokenConn); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE drive_connections SET status='reauthorization_required' WHERE id=$1`, reauthConn); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE drive_connections SET status='revoked', refresh_token_ciphertext=NULL WHERE id=$1`, revokedConn); err != nil {
		t.Fatal(err)
	}

	repo := drivepkg.NewRepository(pool)
	connected, total, err := repo.AdminList(ctx, "connected", 1, 20)
	if err != nil || total != 1 || len(connected) != 1 || connected[0].ID != tokenConn || !connected[0].HasRefreshToken {
		t.Fatalf("conectadas: %+v total=%d err=%v", connected, total, err)
	}
	pending, total, err := repo.AdminList(ctx, "reauthorization_required", 1, 20)
	if err != nil || total != 2 || len(pending) != 2 {
		t.Fatalf("reconexión: %+v total=%d err=%v", pending, total, err)
	}
	seen := map[string]drivepkg.ConnectionStatus{}
	for _, row := range pending {
		seen[row.UserID.String()] = row.Status
	}
	if seen[withoutToken.String()] != drivepkg.StatusReauthorizationNeeded || seen[reauth.String()] != drivepkg.StatusReauthorizationNeeded {
		t.Fatalf("estados derivados: %+v", seen)
	}
	revokedRows, total, err := repo.AdminList(ctx, "revoked", 1, 20)
	if err != nil || total != 1 || len(revokedRows) != 1 || revokedRows[0].ID != revokedConn {
		t.Fatalf("revocadas: %+v total=%d err=%v", revokedRows, total, err)
	}
}
