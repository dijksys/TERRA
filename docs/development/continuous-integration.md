# Integración continua

## Flujo de trabajo

`.github/workflows/ci.yml` valida la calidad del código con GitHub Actions.

Disparadores:

- push;
- pull request;
- `workflow_dispatch` manual.

Se ejecuta en `ubuntu-latest` con permisos `contents: read` y un grupo de concurrencia
que cancela las ejecuciones reemplazadas sobre la misma ref. La clonación usa
`persist-credentials: false`.

## Etapas

1. Clonación del repositorio y verificación de su estructura requerida.
2. Preparación de un `.env` local controlado a partir de `.env.example` y de las
   rutas temporales externas.
3. Validación del entorno local y de la configuración Compose.
4. Construcción de las imágenes de desarrollo con `./terra build`.
5. Construcción del target `production` del backend.
6. Validación de la imagen runtime: sin Go ni Air, con los binarios API y worker.
7. Inicialización del stack local con `./terra init`.
8. Verificación de dependencias del frontend y resolución de Radix.
9. Pruebas del backend y frontend, build del frontend y E2E mediante
   `./terra test all`.
10. Recopilación de diagnósticos y carga de artefactos de pruebas, cobertura e
    informes.
11. Detención de los contenedores con `./terra down --remove` (sin eliminar
    volúmenes).

La construcción del target `production` es una **validación técnica del target
production del backend, sin publicación ni despliegue**. El workflow no inicia
sesión en un registro, no etiqueta releases, no publica imágenes y no contiene
jobs de despliegue.

## Solo Docker

Ninguna acción de setup instala Go, Node, npm ni PostgreSQL en el runner. Toda la
compilación, las pruebas y los navegadores se ejecutan dentro de las imágenes de Compose.
El flujo de trabajo delega en `./terra` para que CI y el desarrollo local compartan los
mismos comandos.

## Pruebas ejecutadas

- Pruebas unitarias del backend y `go vet`.
- Integración del backend contra `terra_test` desechable.
- Lint del frontend.
- Pruebas unitarias del frontend.
- Integración del frontend.
- Cobertura del frontend.
- Build del frontend.
- E2E con Playwright contra Vite y su proxy de API.

Cualquier suite que falle hace fallar el job. Una suite que no puede ejecutarse es un
fallo, no un skip.

## Credenciales

El flujo de trabajo contiene solo valores ficticios para Google y Turnstile. Las pruebas
normales nunca llaman a esos servicios externos. Las pruebas reales de OAuth/Drive siguen
siendo manuales y requieren credenciales fuera del repositorio. No se imprimen secretos
ni se incluyen en commits.

## Artefactos

`artifacts/` contiene:

- `artifacts/tests/*.log`
- `artifacts/coverage/backend-*.out`
- `artifacts/coverage/frontend/`
- `artifacts/playwright-report/`
- diagnósticos de fallo (`ci-status.txt`, `ci-doctor.txt`, `ci-logs.txt`)

Descárgalos desde la página de ejecución del flujo de trabajo en GitHub Actions.

## Contexto de Docker y metadatos de Git

`backend/.dockerignore` y `frontend/.dockerignore` excluyen `.git`, `.github`,
cachés, `node_modules`, `dist`, cobertura e informes de pruebas. Las imágenes no contienen
historial de Git ni credenciales. Los contenedores reciben solo los directorios de código
fuente necesarios para el desarrollo mediante bind mounts; la raíz del repositorio (y
`.git`) no se monta en ningún servicio.

## Ampliar CI

Añade validaciones como un nuevo paso que delegue en `./terra` o en un script existente.
No instales runtimes de lenguajes en el runner y no añadas jobs de despliegue.
Actualiza este documento cuando cambie una etapa.

## Reproducción local

```bash
./terra check
./terra build
./terra init
./terra test all
./terra down --remove
```

## Limitaciones

El flujo de trabajo solo puede ejecutarse por completo en GitHub Actions con Docker
disponible. La validación local cubre los mismos comandos; la ejecución remota debe
confirmarse desde la página de ejecución de Actions.
