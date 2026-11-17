//go:build integration

package integration_test

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"terra/internal/users"
	"terra/tests/helpers"
)

func seedSearchWorker(t *testing.T, pool *pgxpool.Pool, first, last, display, email, status string,
	areaID, positionID *uuid.UUID, roles ...string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := pool.Exec(context.Background(), `INSERT INTO users
		(id, first_name, last_name, display_name, email, area_id, position_id, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		id, first, last, display, email, areaID, positionID, status); err != nil {
		t.Fatalf("seed search worker: %v", err)
	}
	for _, role := range roles {
		if _, err := pool.Exec(context.Background(), `INSERT INTO user_roles (user_id, role_id)
			SELECT $1, id FROM system_roles WHERE key=$2`, id, role); err != nil {
			t.Fatalf("seed search role: %v", err)
		}
	}
	return id
}

func TestWorkerSearchCoversIdentityOrganizationAndAccess(t *testing.T) {
	f := newAccountFixture(t)
	pool := f.pool
	ctx := context.Background()
	areaID, positionID := f.areaID, f.positionID
	hrArea, hrPosition := helpers.SeedOrganization(t, pool, "Recursos Humanos", "Jefatura")

	excludedAdmin := seedSearchWorker(t, pool, "María", "Rodríguez", "Administradora Búsqueda",
		"maria.admin@example.test", "active", &areaID, &positionID, "admin")
	excludedMixed := seedSearchWorker(t, pool, "María", "Rodríguez", "Cuenta Mixta",
		"maria.mixed@example.test", "active", &areaID, &positionID, "user", "admin")
	excludedInactive := seedSearchWorker(t, pool, "María", "Rodríguez", "Inactiva Búsqueda",
		"maria.inactive@example.test", "suspended", &areaID, &positionID, "user")
	// Se crea antes que la página llena para que quede fuera de los primeros 20.
	mariaID := seedSearchWorker(t, pool, "María", "Rodríguez", "María R. de la Cruz",
		"maria.rodriguez@municipio.gob", "active", &hrArea, &hrPosition, "user")
	for index := 0; index < 21; index++ {
		seedSearchWorker(t, pool,
			"Trabajador", fmt.Sprintf("Página %02d", index), fmt.Sprintf("Trabajador Página %02d", index),
			fmt.Sprintf("pagina%02d@example.test", index), "active", &areaID, &positionID, "user")
	}

	list := func(query string, page int) ([]users.User, int) {
		t.Helper()
		data, total, err := f.users.List(ctx, users.ListFilter{Query: query, Status: "active", Page: page, Size: 20})
		if err != nil {
			t.Fatalf("búsqueda %q: %v", query, err)
		}
		for _, user := range data {
			if user.ID == excludedAdmin || user.ID == excludedMixed || user.ID == excludedInactive {
				t.Fatalf("cuenta no trabajadora visible: %s", user.Email)
			}
		}
		return data, total
	}

	for _, query := range []string{"María", "Rodríguez", "María Rodríguez", "MARÍA R. DE LA CRUZ",
		"maria.rodriguez@municipio.gob", "Recursos Humanos", "Jefatura", "recursos", "jefatura"} {
		data, total := list(query, 1)
		if total != 1 || len(data) != 1 || data[0].ID != mariaID {
			t.Fatalf("búsqueda %q: total=%d data=%+v", query, total, data)
		}
	}

	data, total := list("", 1)
	if total != 23 || len(data) != 20 {
		t.Fatalf("página 1: total=%d len=%d", total, len(data))
	}
	page2, total2 := list("", 2)
	if total2 != 23 || len(page2) != 3 {
		t.Fatalf("página 2: total=%d len=%d", total2, len(page2))
	}
	if page2[0].ID != mariaID && page2[1].ID != mariaID {
		t.Fatalf("la segunda página no contiene el trabajador esperado: %+v", page2)
	}

	areaResults, areaTotal := list("Recursos", 1)
	if areaTotal != 1 || areaResults[0].ID != mariaID {
		t.Fatalf("filtro por área: %+v", areaResults)
	}
	positionResults, positionTotal := list("Jefatura", 1)
	if positionTotal != 1 || positionResults[0].ID != mariaID {
		t.Fatalf("filtro por cargo: %+v", positionResults)
	}
	if data, total := list("NoExiste", 1); total != 0 || len(data) != 0 {
		t.Fatalf("sin resultados: total=%d data=%+v", total, data)
	}

	combined, combinedTotal, err := f.users.List(ctx, users.ListFilter{
		Query: "Recursos", Status: "active", AreaID: &hrArea, PositionID: &hrPosition, Page: 1, Size: 20,
	})
	if err != nil || combinedTotal != 1 || len(combined) != 1 || combined[0].ID != mariaID {
		t.Fatalf("filtros combinados: %+v total=%d err=%v", combined, combinedTotal, err)
	}
	excludedCombined, excludedTotal, err := f.users.List(ctx, users.ListFilter{
		Query: "Recursos", Status: "suspended", AreaID: &hrArea, Page: 1, Size: 20,
	})
	if err != nil || excludedTotal != 0 || len(excludedCombined) != 0 {
		t.Fatalf("estado combinado no excluyó: total=%d err=%v", excludedTotal, err)
	}

	byArea, byAreaTotal, err := f.users.List(ctx, users.ListFilter{Status: "active", AreaID: &hrArea, Page: 1, Size: 20})
	if err != nil || byAreaTotal != 1 || byArea[0].ID != mariaID {
		t.Fatalf("filtro area_id: %+v total=%d err=%v", byArea, byAreaTotal, err)
	}
	byPosition, byPositionTotal, err := f.users.List(ctx, users.ListFilter{Status: "active", PositionID: &hrPosition, Page: 1, Size: 20})
	if err != nil || byPositionTotal != 1 || byPosition[0].ID != mariaID {
		t.Fatalf("filtro position_id: %+v total=%d err=%v", byPosition, byPositionTotal, err)
	}

	longQuery := strings.Repeat("a", 101)
	rec := f.serve(t, http.HandlerFunc(f.adminHandler.Users), f.principalID, http.MethodGet,
		"/api/v1/admin/users?"+url.Values{"q": {longQuery}}.Encode(), "", nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("consulta excesivamente larga: %d %s", rec.Code, rec.Body.String())
	}

	rec = f.serve(t, http.HandlerFunc(f.adminHandler.Users), f.principalID, http.MethodGet,
		"/api/v1/admin/users?"+url.Values{"status": {"active"}, "q": {"María Rodríguez"}, "page": {"1"}, "page_size": {"20"}}.Encode(), "", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), mariaID.String()) {
		t.Fatalf("listado HTTP: %d %s", rec.Code, rec.Body.String())
	}
}
