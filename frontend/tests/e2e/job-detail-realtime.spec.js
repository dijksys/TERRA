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

const job = {
  id: 'job-1',
  status: 'downloading',
  scope_type: 'selected_items',
  total_items: 4,
  completed_items: 0,
  skipped_items: 0,
  failed_items: 0,
  total_bytes: 4096,
  downloaded_bytes: 0,
  created_at: '2026-11-10T10:00:00Z',
  drive_owner_name: 'María Rodríguez',
  requested_by_name: 'Ada Admin',
  area_name: 'Recursos Humanos',
  position_name: 'Analista',
  roots: [],
  file_roots: [],
}

function item(status) {
  return {
    id: 'item-1',
    job_id: 'job-1',
    drive_node_id: 'node-1',
    google_file_id: 'file-1',
    stored_file_id: status === 'completed' ? 'stored-file-1' : null,
    name: 'Reporte.pdf',
    mime_type: 'application/pdf',
    status,
    attempt_count: 1,
    size_bytes: 2048,
    sha256: 'abcdef0123456789',
  }
}

async function installFakeSocket(page) {
  await page.addInitScript(() => {
    window.__sockets = []
    window.__sent = []
    window.__objectURLs = 0
    const original = URL.createObjectURL?.bind(URL)
    if (original) {
      URL.createObjectURL = (...args) => {
        window.__objectURLs += 1
        return original(...args)
      }
    }
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
      send(raw) {
        window.__sent.push(JSON.parse(raw))
      }
      close() {
        this.readyState = 3
        this.onclose?.()
      }
    }
    window.WebSocket = FakeSocket
  })
}

test('el detalle reconcilia elementos por WebSocket y descarga de forma nativa', async ({ page }) => {
  await installFakeSocket(page)
  let itemStatus = 'pending'
  let itemsRequests = 0

  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url())
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.endsWith('/auth/me')) {
      return json({
        user: worker,
        permissions: WORKER_PERMISSIONS,
        has_local_credentials: true,
        must_rotate_password: false,
        pending_profile: false,
      })
    }
    if (url.pathname === '/api/v1/download-jobs/job-1') return json(job)
    if (url.pathname === '/api/v1/download-jobs/job-1/items') {
      itemsRequests += 1
      return json({ data: [item(itemStatus)], pagination: { page: 1, page_size: 25, total: 1 } })
    }
    if (url.pathname === '/api/v1/files/stored-file-1/content') {
      return route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="Reporte.pdf"',
          'Content-Length': '9',
          'Cache-Control': 'private, no-store',
        },
        body: 'documento',
      })
    }
    return json({ data: [], pagination: { total: 0 } })
  })

  await page.goto('/app/jobs/job-1')
  await expect(page.getByRole('heading', { name: 'Trabajo JOB-1' })).toBeVisible()
  await expect(page.getByText('Pendiente')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__sent.some((message) => message.type === 'subscribe'))).toBe(true)

  const socketMessage = async (message) => {
    await page.evaluate((payload) => {
      window.__sockets.find((socket) => socket.url.includes('/api/v1/realtime')).onmessage({ data: JSON.stringify(payload) })
    }, message)
  }

  itemStatus = 'downloading'
  await socketMessage({
    type: 'job.item.started', revision: 2, event_id: 1,
    data: { job_id: 'job-1', payload: { item_id: 'item-1' }, progress: { status: 'downloading' } },
  })
  await expect(page.getByText('Descargando')).toBeVisible()

  itemStatus = 'retrying'
  await socketMessage({
    type: 'job.item.retrying', revision: 3, event_id: 2,
    data: { job_id: 'job-1', payload: { item_id: 'item-1', error_code: 'timeout' }, progress: { status: 'downloading' } },
  })
  await expect(page.getByText('Reintentando')).toBeVisible()

  const requestsBeforeProgress = itemsRequests
  await socketMessage({
    type: 'job.progress', revision: 4,
    data: {
      job_id: 'job-1',
      progress: {
        status: 'downloading', completed_items: 2, skipped_items: 1, failed_items: 1,
        byte_progress_percent: 50, transferred_bytes: 10, known_total_bytes: 20,
      },
    },
  })
  await expect(page.getByText('4 / 4 elementos')).toBeVisible()
  await page.waitForTimeout(300)
  expect(itemsRequests).toBe(requestsBeforeProgress)

  itemStatus = 'completed'
  await socketMessage({
    type: 'job.item.completed', revision: 5, event_id: 3,
    data: { job_id: 'job-1', payload: { item_id: 'item-1' }, progress: { status: 'downloading' } },
  })
  await expect(page.locator('tbody').getByText('Completado', { exact: true })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Descargar Reporte.pdf' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('Reporte.pdf')
  expect(await page.evaluate(() => window.__objectURLs)).toBe(0)
  await expect(page).toHaveURL('/app/jobs/job-1')

  await expect(page.getByText('Sincronización por REST')).toHaveCount(0)
  await expect(page.locator('.lucide-wifi-off')).toHaveCount(0)
  const actions = page.getByRole('button', { name: /Acciones/ })
  await expect(actions).toBeVisible()
  await actions.click()
  await expect(page.getByRole('menuitem', { name: 'Actualizar' })).toBeVisible()
  await page.keyboard.press('Escape')
})
