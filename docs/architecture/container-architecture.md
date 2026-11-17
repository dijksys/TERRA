# Arquitectura de contenedores (desarrollo local)

## Servicios

```yaml
web:    # Vite dev server + React
api:    # Go, REST + WebSocket
worker: # Go, mismo backend, proceso independiente
db:     # PostgreSQL 18
```

No hay Nginx, Traefik, broker, scheduler, contenedor de migraciones ni servicios
adicionales.

## Imágenes

| Servicio | Imagen | Construcción |
|---|---|---|
| web | `terra-web:local` | `frontend/Dockerfile` |
| api / worker | `terra-backend:local` | `backend/Dockerfile` |
| db | `postgres:18-alpine` | imagen fijada, no se reconstruye |

Las etapas de desarrollo de los Dockerfiles incluyen Go, Air y pruebas en backend;
Node, Vite, Vitest, Playwright y Chromium en web.

## Entorno local y target de compilación del backend

### Entorno ejecutable soportado

El único entorno Compose proporcionado por el repositorio es el desarrollo local:

- `web` con Vite, HMR y proxy `/api`;
- `api` con Air y recarga automática;
- `worker` con Air y recarga automática;
- `db` con PostgreSQL 18.

Este entorno se administra con `./terra` y los scripts de `deploy/scripts/`. No
existe un Compose de producción o staging.

### Target técnico del backend

`backend/Dockerfile` es multi-stage:

| Etapa | Contenido | Uso |
|---|---|---|
| `development` | Go, Air, herramientas de pruebas y código montado | Desarrollo local |
| `build` | Compilación de binarios | Insumo de `production` |
| `production` | Runtime mínimo con `/app/{api,worker,migrate,bootstrap}`; sin Go, Air ni código fuente | Imagen runtime del backend validada por CI |

La etapa `production` es un target de compilación y una imagen runtime del
backend, no una arquitectura de despliegue institucional. CI la construye para
comprobar que contiene los binarios esperados y no las herramientas de
desarrollo; no la publica en un registro ni despliega servicios.
`frontend/Dockerfile` está destinado al servidor de desarrollo Vite y no define
una imagen de frontend de producción.

Las migraciones van embebidas en los binarios mediante `go:embed`.

## Redes y puertos

| Servicio | Puerto interno | Publicado |
|---|---|---|
| web | 5173 | `${WEB_PORT:-8080}:5173` |
| api | 8080 | No |
| worker | — | No |
| db | 5432 | `127.0.0.1:${DB_PORT}:5432` (solo loopback) |

Vite proxy:

```js
'/api': { target: 'http://api:8080' }
```

`web` monta `package.json` y `package-lock.json` como solo lectura para que el diagnóstico
compare los manifiestos vigentes con el `node_modules` de la imagen. No se monta
`node_modules` desde el host ni se usa un volumen que pueda ocultar las dependencias
instaladas durante el build.

Esto cubre REST y WebSocket Upgrade. Los contenedores se comunican por nombre de servicio
(`db`, `api`); nunca por `localhost`.

## Montajes

| Recurso | Tipo | Uso |
|---|---|---|
| `terra_terra-db` | volumen | PostgreSQL |
| `node_modules` | capa de imagen | dependencias del frontend (no se monta el host) |
| `../backend:/src` | bind | source Go |
| `../frontend/src`, `public`, `tests`, configs | binds individuales | source React + HMR |
| `STORAGE_HOST_PATH:/var/lib/terra` | bind externo | documentos: api ro, worker rw; web sin acceso |
| `../.cache/go-mod`, `../.cache/go-build` | bind | cachés Go |

`web` y `db` no montan documentos. `.git` no se monta en ningún servicio.

## Healthchecks

- db: `pg_isready`.
- api: `GET /api/v1/health`.
- worker: proceso vivo (`kill -0 1`).
- web: `GET /@vite/client` verificando JavaScript de Vite (no `index.html`).

Air registra `building...`, `running...` y el arranque del binario. `./terra doctor`
comprueba que API y worker ejecutan Air y que existe un binario compilado activo.

## Orden de arranque

`./terra init`: db healthy → api healthy (migraciones) → bootstrap → worker/web.
Tras el arranque, Air mantiene la recarga de API y worker sin recrear contenedores.
El worker también puede aplicar migraciones con advisory lock, pero el flujo oficial
las aplica desde api.

## Persistencia

- Detener o eliminar contenedores no elimina el volumen PostgreSQL ni `STORAGE_HOST_PATH`.
- `./terra down --remove` no usa `-v`.
- La recuperación tras eliminar contenedores está probada.
