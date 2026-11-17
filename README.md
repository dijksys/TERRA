# TERRA

Sistema de gestión documental basado en Go, React, PostgreSQL y Google Drive API.
Permite que cada trabajador autorice individualmente su cuenta de Google y que un
administrador inicie copias controladas de su Drive. Los documentos se conservan
en un volumen privado y se clasifican por **área → cargo → trabajador →
snapshot**.

## Alcance de esta distribución

TERRA se proporciona actualmente como un entorno de desarrollo y validación
local basado en Docker y Docker Compose. La configuración soportada se encuentra
en un único archivo `deploy/compose.yaml`, que define cuatro servicios: `web`
(Vite con HMR), `api` (Go), `worker` (Go) y `db` (PostgreSQL). El comando
`./terra` y los scripts de `deploy/scripts/` administran este entorno local.

El repositorio no constituye una distribución productiva lista para desplegar en
una institución ni incluye una topología de producción o staging. Aunque
`backend/Dockerfile` contiene un target multi-stage `production` para compilar y
validar los binarios del backend, este se utiliza como comprobación técnica en
CI. No representa por sí solo una release integral ni un procedimiento de
despliegue soportado. El `frontend/Dockerfile` actual está destinado al servidor
de desarrollo Vite.

No se proporcionan Compose productivo, imagen de frontend de producción, reverse
proxy, configuración TLS/certificados, dominios, orquestación, gestión de secretos
productivos ni pipeline de publicación y despliegue. Cada
institución debe diseñar, implementar, revisar y operar por separado su
infraestructura, seguridad, comunicaciones, monitoreo, copias de seguridad,
recuperación y procedimientos operativos antes de realizar una implantación
productiva.

## Propiedad y mantenimiento

TERRA es propiedad de **dijksys**, propietario y mantenedor oficial del proyecto.

- Perfil: [github.com/dijksys](https://github.com/dijksys)
- Repositorio oficial: [github.com/dijksys/TERRA](https://github.com/dijksys/TERRA)
- Licencia: [GNU Affero General Public License v3](LICENSE)

## Alcance

Incluye:

- cuatro servicios Docker: `web`, `api`, `worker` y `db`;
- Vite con HMR y proxy `/api`;
- API Go con REST y WebSockets;
- worker independiente con cola PostgreSQL;
- PostgreSQL con volumen persistente;
- comando unificado `./terra` y scripts de operación local;
- pruebas unitarias, de integración, E2E y CI exclusivamente Docker.

No forman parte de esta distribución de despliegue:

- Nginx ni reverse proxy productivo;
- Compose de producción o staging;
- certificados ni configuración TLS;
- dominios;
- VPS ni infraestructura institucional;
- Traefik;
- Cloudflare Tunnel;
- procedimientos de publicación;
- pipeline de despliegue.

## Arquitectura

```text
web (Vite + React) ──/api──► api (Go REST + WebSocket) ──► db (PostgreSQL)
                                     ▲                    ▲
                                     │                    │
                             worker (Go) ─────────────────┘
                                     │
                STORAGE_HOST_PATH (documentos externos)
```

- **web**: interfaz React, HMR y proxy REST/WebSocket.
- **api**: autenticación, RBAC, OAuth, organización, trabajos, WebSockets y archivos.
- **worker**: cola, leases, Drive, descargas/exportaciones y escritura atómica.
- **db**: fuente de verdad y cola persistente (`FOR UPDATE SKIP LOCKED`).

Detalle: [arquitectura](docs/architecture/overview.md).

## Requisitos

- Linux, macOS o Windows con Docker Engine o Docker Desktop.
- Docker Compose v2.
- Bash, Git, curl, tar y sha256sum.
- 2 vCPU y 4 GB de RAM recomendados.
- Espacio para imágenes, PostgreSQL y documentos.

No se requiere Go, Node, npm, PostgreSQL, Vite ni compiladores en el host.

## Instalación inicial

```bash
git clone https://github.com/dijksys/TERRA.git
cd TERRA
cp .env.example .env
chmod 600 .env
./terra check
./terra init
```

Complete como mínimo:

- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` y `DB_PORT`;
- `STORAGE_HOST_PATH` y `BACKUP_HOST_PATH` (pueden quedar vacías para usar las
  rutas XDG/HOME);
- `SESSION_SECRET` (`openssl rand -hex 32`);
- `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`);
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y las dos redirect URIs;
- `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`;
- `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`.

`.env.example` es la referencia y no se versiona `.env`.

## Configuración de Google

1. Habilite Google Drive API en Google Cloud.
2. Configure la marca y el público de la aplicación.
3. Declare los scopes `openid`, `email`, `profile` y
   `https://www.googleapis.com/auth/drive.readonly`.
4. Cree un cliente OAuth de tipo **Aplicación web**.
5. Registre exactamente:

```text
http://localhost:8080/api/v1/auth/google/callback
http://localhost:8080/api/v1/auth/google/drive/callback
```

Guía completa paso a paso:
[Google Cloud, OAuth 2.0 y Google Drive](docs/integrations/google-cloud-drive-oauth.md).

## Acceso

```text
http://localhost:8080
```

El puerto se controla con `WEB_PORT`.

- Trabajadores: **Continuar con Google**.
- Administradores, moderadores y solo lectura: usuario, contraseña y Turnstile.
- Una cuenta administrativa nueva debe cambiar su contraseña inicial.

## Operación habitual

```bash
./terra up
./terra status
./terra logs api
./terra down
```

Los cambios de `.env` requieren recrear el servicio:

```bash
./terra up --recreate=api
./terra up --recreate=worker
```

Los cambios Go se recargan con Air. Los cambios React se recargan con HMR.
Consulte la [referencia canónica de comandos](docs/development/commands-reference.md)
para instalación, pruebas, migraciones, backups, restauración y diagnóstico.

## Documentación

- [Índice general](docs/README.md)
- [Primeros pasos](docs/usage/getting-started.md)
- [Trabajadores](docs/usage/workers.md)
- [Administradores](docs/usage/administrators.md)
- [Moderadores](docs/usage/moderators.md)
- [Solo lectura](docs/usage/read-only.md)
- [Conexión de Google Drive](docs/usage/google-drive.md)
- [Documentos y descargas](docs/usage/documents-and-downloads.md)
- [Referencia de comandos](docs/development/commands-reference.md)
- [Validación de formularios](docs/development/form-validation.md)
- [Pruebas](docs/development/testing.md)
- [Seguridad](docs/security/threat-model.md)
- [OpenAPI](docs/api/openapi.yaml)

## Estado y limitaciones

Distribución de desarrollo local del MVP con integración real de Google Drive
API v3.

- La verificación de Google del scope restringido y el consentimiento con
  cuentas reales son dependencias externas. **Google no ha aprobado ni
  verificado TERRA.**
- El acceso a Drive es solo de lectura y únicamente sobre Mi unidad.
- No se usan cuentas de servicio, delegación de dominio ni unidades compartidas.
- La retención de snapshots se aplica únicamente con
  `./deploy/scripts/retention.sh --apply`; el backend no la ejecuta
  automáticamente.
- Las pruebas con aplicación OAuth External en estado **Prueba** pueden requerir
  reautorizar Drive cada siete días.
- El entorno local no sustituye una revisión de seguridad ni una implantación
  productiva institucional.

## Seguridad esencial

- Refresh tokens cifrados con AES-256-GCM; nunca llegan al navegador.
- Cookies de sesión HttpOnly, SameSite=Lax y CSRF.
- Argon2id para credenciales administrativas locales.
- Turnstile validado en el backend.
- Rutas documentales sanitizadas, sin traversal ni symlinks.
- Documentos accesibles solo mediante API autenticada.
- Toda operación de escritura se valida en el servidor y PostgreSQL actúa como
  última garantía de integridad.

## Contribución

Consulte [CONTRIBUTING.md](CONTRIBUTING.md). Todo formulario nuevo debe seguir el
[estándar de validación](docs/development/form-validation.md).
