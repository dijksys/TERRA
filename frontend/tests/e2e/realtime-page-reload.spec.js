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

const progress = (percent) => ({
  stage: 'downloading',
  status: 'downloading',
  completed_bytes: percent,
  in_flight_bytes: 0,
  transferred_bytes: percent,
  known_total_bytes: 100,
  unknown_size_items: 0,
  byte_progress_percent: percent,
  completed_items: 0,
  skipped_items: 0,
  failed_items: 0,
  pending_items: 1,
  retrying_items: 0,
  downloading_items: 1,
  download_speed_bytes_per_second: 0,
  average_speed_bytes_per_second: 0,
  eta_seconds: 0,
  scan: { folders_discovered: 0, folders_scanned: 0, items_found: 0, downloadable_items: 0, skipped_items: 0 },
  active_downloads: [],
})

const item = {
  id: 'item-1',
  job_id: 'job-1',
  drive_node_id: 'node-1',
  google_file_id: 'file-1',
  stored_file_id: null,
  name: 'Reporte.pdf',
  mime_type: 'application/pdf',
  status: 'pending',
  attempt_count: 1,
  size_bytes: 2048,
  sha256: 'abcdef0123456789',
}

async function installFakeSocket(page) {
  await page.addInitScript(() => {
    window.__sockets = []
    window.__sent = []
    class FakeSocket {
      static OPEN = 1
      constructor(url) {
        this.url = url
        this.readyState = 0
        this.sent = []
        window.__sockets.push(this)
        setTimeout(() => {
          this.readyState = 1
          this.onopen?.()
        }, 0)
      }
      send(raw) {
        this.sent.push(JSON.parse(raw))
        window.__sent.push(JSON.parse(raw))
      }
      close() {
        if (this.readyState === 3) return
        this.readyState = 3
        this.onclose?.()
      }
    }
    window.WebSocket = FakeSocket
  })
}

async function socketMessage(page, message) {
  await page.evaluate((payload) => {
    window.__sockets.find((socket) => socket.url.includes('/api/v1/realtime')).onmessage({ data: JSON.stringify(payload) })
  }, message)
}

async function hardReload(page) {
  const client = await page.context().newCDPSession(page)
  await client.send('Page.reload', { ignoreCache: true })
  await client.detach()
}

function appSocketCount(page) {
  return page.evaluate(() => window.__sockets.filter((socket) => socket.url.includes('/api/v1/realtime')).length)
}

test('F5 y Ctrl+Shift+R restauran una única conexión y reciben snapshot y progreso', async ({ page }) => {
  await installFakeSocket(page)
  const counts = { auth: 0, job: 0, items: 0, creates: 0 }

  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url())
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.endsWith('/auth/me')) {
      counts.auth += 1
      return json({
        user: worker,
        permissions: WORKER_PERMISSIONS,
        has_local_credentials: true,
        must_rotate_password: false,
        pending_profile: false,
      })
    }
    if (url.pathname === '/api/v1/download-jobs/job-1' && route.request().method() === 'GET') {
      counts.job += 1
      return json(job)
    }
    if (url.pathname === '/api/v1/download-jobs/job-1/items') {
      counts.items += 1
      return json({ data: [item], pagination: { page: 1, page_size: 25, total: 1 } })
    }
    if (route.request().method() === 'POST') counts.creates += 1
    return json({ data: [], pagination: { total: 0 } })
  })

  await page.goto('/app/jobs/job-1')
  await expect(page.getByRole('heading', { name: 'Trabajo JOB-1' })).toBeVisible()
  await expect.poll(() => appSocketCount(page)).toBe(1)
  await expect.poll(() => page.evaluate(() => window.__sent.some((message) => message.channel === 'job:job-1'))).toBe(true)
  expect(counts.auth).toBe(1)

  await socketMessage(page, {
    type: 'job.snapshot', revision: 2,
    data: { job_id: 'job-1', job: { id: 'job-1', status: 'downloading' }, progress: progress(40) },
  })
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')

  for (const reload of [() => page.reload(), () => hardReload(page)]) {
    const authBefore = counts.auth

    await reload()
    await expect(page.getByRole('heading', { name: 'Trabajo JOB-1' })).toBeVisible()
    await expect.poll(() => appSocketCount(page)).toBe(1)
    await expect.poll(() => page.evaluate(() => window.__sent.some((message) => message.type === 'subscribe' && message.channel === 'job:job-1'))).toBe(true)

    // StrictMode no duplica /auth/me: una restauración por documento.
    expect(counts.auth).toBe(authBefore + 1)
    expect(counts.creates).toBe(0)

    const jobCallsAfterLoad = counts.job
    await socketMessage(page, {
      type: 'job.snapshot', revision: 4,
      data: { job_id: 'job-1', job: { id: 'job-1', status: 'downloading' }, progress: progress(60) },
    })
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60')

    await socketMessage(page, {
      type: 'job.progress', revision: 5,
      data: { job_id: 'job-1', progress: progress(75) },
    })
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75')

    // El progreso llega por WebSocket: no hay nuevas consultas REST al trabajo.
    expect(counts.job).toBe(jobCallsAfterLoad)
    expect(await appSocketCount(page)).toBe(1)
  }
})
