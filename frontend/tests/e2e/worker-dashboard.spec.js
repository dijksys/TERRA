import { expect, test } from '@playwright/test'
import { WORKER_PERMISSIONS } from '../fixtures/permissions'

const worker = {
  id: '22222222-2222-4222-8222-222222222222',
  first_name: 'María',
  last_name: 'Rodríguez',
  display_name: 'María Rodríguez',
  email: 'maria@example.test',
  area_name: 'Recursos Humanos',
  position_name: 'Analista',
  status: 'active',
  roles: ['user'],
}

const baseConnection = {
  status: 'connected',
  has_refresh_token: true,
  google_email: 'maria@example.test',
  policy_consent_version: '2026-11',
}

const policy = { version: '2026-11', published_at: '2026-11-01T10:00:00Z', content: 'Política vigente' }

const recentJobs = Array.from({ length: 5 }, (_, index) => ({
  id: `job-${index}`,
  status: index === 0 ? 'downloading' : 'completed',
  scope_type: 'my_drive_full',
  total_items: 10,
  completed_items: 10,
  downloaded_bytes: 2048,
  total_bytes: 2048,
  created_at: '2026-11-10T10:00:00Z',
}))

async function mockDashboard(page, { connection = baseConnection, summary = { active_jobs: 12, total_jobs: 40 }, summaryStatus = 200 } = {}) {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path.endsWith('/auth/me')) {
      return json({
        user: worker,
        permissions: WORKER_PERMISSIONS,
        has_local_credentials: true,
        must_rotate_password: false,
        pending_profile: false,
      })
    }
    if (path.endsWith('/me/drive/connection')) return json({ connection, policy })
    if (path.endsWith('/download-jobs/summary')) {
      return summaryStatus === 200 ? json(summary) : json({ error: { message: 'resumen no disponible' } }, 500)
    }
    if (path.endsWith('/download-jobs')) {
      return json({ data: recentJobs, pagination: { total: 40 } })
    }
    return json({ data: [], pagination: { total: 0 } })
  })
}

test('el dashboard usa el resumen agregado y los estados reales', async ({ page }) => {
  await mockDashboard(page, { summary: { active_jobs: 12, total_jobs: 40 } })
  await page.goto('/app')

  await expect(page.getByRole('heading', { name: 'Hola, María' })).toBeVisible()
  await expect(page.getByText('Trabajos activos')).toBeVisible()
  await expect(page.getByText('12', { exact: true })).toBeVisible()
  await expect(page.getByText('Vinculada')).toBeVisible()
  await expect(page.getByText('Aceptada')).toBeVisible()
  await expect(page.getByText('Trabajo JOB-0')).toBeVisible()
  await expect(page.getByText('Trabajo JOB-4')).toBeVisible()
  await expect(page.getByText('Trabajo JOB-5')).toHaveCount(0)
})

test('el dashboard informa un resumen no disponible sin mostrar cero', async ({ page }) => {
  await mockDashboard(page, { summaryStatus: 500 })
  await page.goto('/app')
  await expect(page.getByText('No disponible')).toBeVisible()
  await expect(page.getByText('No fue posible consultar el resumen de trabajos.')).toBeVisible()
  await expect(page.getByText('0', { exact: true })).toHaveCount(0)
})

test('el dashboard diferencia conexión revocada, reconexión y política pendiente', async ({ page }) => {
  await mockDashboard(page, {
    connection: { ...baseConnection, status: 'revoked', policy_consent_version: '2026-10' },
  })
  await page.goto('/app')
  await expect(page.getByText('Revocada', { exact: true })).toBeVisible()
  await expect(page.getByText('Pendiente', { exact: true })).toBeVisible()
})

test('el dashboard diferencia una conexión sin refresh token', async ({ page }) => {
  await mockDashboard(page, { connection: { ...baseConnection, has_refresh_token: false } })
  await page.goto('/app')
  await expect(page.getByText('Requiere reconexión', { exact: true }).first()).toBeVisible()
})

async function installWorkerSocket(page) {
  await page.addInitScript(() => {
    window.__sockets = []
    window.__sent = []
    class FakeSocket {
      static OPEN = 1
      constructor(url) {
        this.url = url
        this.readyState = 0
        window.__sockets.push(this)
        setTimeout(() => {
          this.readyState = 1
          this.onopen?.()
        }, 0)
      }
      send(raw) { window.__sent.push(JSON.parse(raw)) }
      close() { this.readyState = 3; this.onclose?.() }
    }
    window.WebSocket = FakeSocket
  })
}

test('el dashboard del trabajador se actualiza por el canal worker.dashboard', async ({ page }) => {
  await installWorkerSocket(page)
  await mockDashboard(page, { summary: { active_jobs: 12, total_jobs: 40 } })
  await page.goto('/app')
  await expect(page.getByText('12', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() =>
    window.__sent.some((message) => message.type === 'subscribe' && message.channel === 'worker.dashboard'))).toBe(true)

  const emit = (data) => page.evaluate((payload) => {
    window.__sockets.find((socket) => socket.url.includes('/api/v1/realtime'))
      .onmessage({ data: JSON.stringify(payload) })
  }, data)

  await emit({
    type: 'worker.dashboard.snapshot',
    data: {
      generated_at: '2026-11-16T10:00:00Z',
      summary: { active_jobs: 2, total_jobs: 41 },
      recent: [{ ...recentJobs[0], id: 'job-new', status: 'queued' }],
    },
  })
  await expect(page.getByText('2', { exact: true })).toBeVisible()
  await expect(page.getByText('Trabajo JOB-NEW')).toBeVisible()
  await expect(page.getByText('Trabajo JOB-1')).toHaveCount(0)

  await emit({
    type: 'worker.dashboard.metrics',
    data: {
      generated_at: '2026-11-16T09:59:00Z',
      summary: { active_jobs: 99, total_jobs: 99 },
      recent: [],
    },
  })
  await page.waitForTimeout(150)
  await expect(page.getByText('2', { exact: true })).toBeVisible()

  await emit({
    type: 'worker.dashboard.metrics',
    data: {
      generated_at: '2026-11-16T10:01:00Z',
      summary: { active_jobs: 4, total_jobs: 42 },
      recent: [
        { ...recentJobs[0], id: 'job-newer', status: 'downloading' },
        { ...recentJobs[1], id: 'job-new', status: 'queued' },
      ],
    },
  })
  await expect(page.getByText('4', { exact: true })).toBeVisible()
  await expect(page.getByText('Trabajo JOB-NEWE')).toBeVisible()

  await page.getByRole('link', { name: /Trabajos activos/ }).click()
  await expect(page).toHaveURL(/\/app\/jobs\?status=active$/)
  await expect(page.getByRole('combobox', { name: 'Filtrar por estado' })).toContainText('En curso')
})
