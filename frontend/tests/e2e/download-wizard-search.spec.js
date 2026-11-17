import { expect, test } from '@playwright/test'
import { ADMIN_PERMISSIONS } from '../fixtures/permissions'

const viewer = {
  id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Ada',
  last_name: 'Admin',
  display_name: 'Ada Admin',
  email: 'ada@example.test',
  area_name: 'Sistemas',
  position_name: 'Administradora',
  status: 'active',
  roles: ['admin'],
}

const workerRows = Array.from({ length: 137 }, (_, index) => {
  const number = index + 1
  return {
    id: `22222222-2222-4222-8222-${String(number).padStart(12, '0')}`,
    first_name: 'Trabajador',
    last_name: String(number),
    display_name: `Trabajador ${number}`,
    email: `trabajador${number}@example.test`,
    area_name: number % 2 === 0 ? 'Recursos Humanos' : 'Sistemas',
    position_name: number % 2 === 0 ? 'Jefatura' : 'Analista',
    status: 'active',
    roles: ['user'],
  }
})

const target = workerRows[136]

async function mockWizard(page) {
  const connectionRequests = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('/drive/connection')) connectionRequests.push(url.pathname)
  })
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url())
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.endsWith('/auth/me')) {
      return json({
        user: viewer,
        permissions: ADMIN_PERMISSIONS,
        has_local_credentials: true,
        must_rotate_password: false,
        pending_profile: false,
      })
    }
    if (url.pathname.endsWith('/admin/users')) {
      const pageNumber = Number(url.searchParams.get('page') || 1)
      const query = (url.searchParams.get('q') || '').toLocaleLowerCase('es')
      const filtered = query
        ? workerRows.filter((worker) =>
            [worker.display_name, worker.email, worker.area_name, worker.position_name]
              .join(' ').toLocaleLowerCase('es').includes(query))
        : workerRows
      const size = Number(url.searchParams.get('page_size') || 20)
      const start = (pageNumber - 1) * size
      return json({ data: filtered.slice(start, start + size), pagination: { total: filtered.length } })
    }
    const detail = url.pathname.match(/\/admin\/users\/([^/]+)$/)
    if (detail) {
      const worker = workerRows.find((item) => item.id === detail[1])
      return worker ? json({ user: worker, organization_history: [] }) : json({ error: { message: 'no encontrado' } }, 404)
    }
    if (url.pathname.endsWith('/drive/connection')) {
      return json({
        connection: {
          status: 'connected',
          has_refresh_token: true,
          google_email: target.email,
          policy_consent_version: '2026-11',
        },
        policy: { version: '2026-11' },
      })
    }
    return json({ data: [], pagination: { total: 0 } })
  })
  return { connectionRequests }
}

test('el asistente busca y selecciona trabajadores fuera de la primera página', async ({ page }) => {
  const requests = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('/admin/users')) requests.push(url)
  })
  const { connectionRequests } = await mockWizard(page)
  await page.goto('/app/admin/downloads')

  await expect(page.getByRole('heading', { name: 'Nueva descarga institucional' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Trabajador 1\b/ })).toBeVisible()
  expect(requests.at(-1).searchParams.get('page_size')).toBe('20')
  expect(requests.some((url) => url.searchParams.get('page_size') === '100')).toBe(false)

  await page.getByRole('button', { name: 'Siguiente' }).click()
  await expect(page.getByRole('button', { name: /Trabajador 21/ })).toBeVisible()

  await page.getByLabel('Buscar trabajadores').fill('Trabajador 137')
  await expect(page.getByRole('button', { name: /Trabajador 137/ })).toBeVisible()
  expect(requests.at(-1).searchParams.get('q')).toBe('Trabajador 137')
  expect(requests.at(-1).searchParams.get('status')).toBe('active')

  await page.getByRole('button', { name: /Trabajador 137/ }).click()
  await expect(page.getByTestId('selected-worker')).toContainText(target.email)
  await expect(page.getByText('Conexión y política vigentes. Puede iniciar el snapshot.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Iniciar descarga/ })).toBeEnabled()
  await expect(page.locator('input[value="my_drive_full"]')).toBeChecked()
  expect(connectionRequests.some((path) => path.endsWith(`/admin/users/${target.id}/drive/connection`))).toBe(true)

  await page.getByLabel('Buscar trabajadores').fill('Recursos Humanos')
  await expect(page.getByTestId('selected-worker')).toContainText(target.email)
  await expect(page.getByText('Conexión y política vigentes. Puede iniciar el snapshot.')).toBeVisible()
})
