import { expect, test } from '@playwright/test'
import { ADMIN_PERMISSIONS, WORKER_PERMISSIONS } from '../fixtures/permissions'

const adminUser = {
  id: 'admin-1',
  display_name: 'Ada Admin',
  email: 'ada@example.test',
  status: 'active',
  roles: ['admin'],
  area_name: 'Sistemas',
}

const workerUser = {
  ...adminUser,
  id: 'worker-1',
  display_name: 'Tra Bajador',
  email: 'worker@example.test',
  roles: ['user'],
}

const policy = {
  version: '2026-01',
  published_at: '2026-01-01T10:00:00Z',
  content: Array.from(
    { length: 80 },
    (_, index) => `Cláusula ${index + 1}: contenido institucional para validar el desplazamiento interno.`,
  ).join('\n\n'),
}

const auditEvent = {
  id: 1,
  action: 'auth.admin.login',
  actor_name: 'Ada Admin',
  actor_user_id: '11111111-1111-4111-8111-111111111111',
  target_type: 'user',
  target_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  metadata: {},
  created_at: '2026-11-07T18:00:00Z',
}

const areas = Array.from({ length: 30 }, (_, index) => ({
  id: `area-${index + 1}`,
  name: `Área institucional ${index + 1}`,
  status: 'active',
}))

const workers = Array.from({ length: 6 }, (_, index) => ({
  id: `worker-${index}`,
  display_name: `Trabajador con nombre institucional extenso ${index + 1}`,
  email: `trabajador.extenso.${index + 1}@municipio.gob.mx`,
  area_name: 'Secretaría de Administración y Finanzas Municipales',
  position_name: 'Coordinación de Modernización Administrativa',
  status: index % 2 === 0 ? 'active' : 'suspended',
  last_login_at: '2026-11-07T18:00:00Z',
}))

async function mockApi(page, role = 'admin') {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: role === 'user' ? workerUser : adminUser,
          permissions: role === 'user' ? WORKER_PERMISSIONS : ADMIN_PERMISSIONS,
          has_local_credentials: role !== 'user',
          must_rotate_password: false,
          pending_profile: false,
        }),
      })
    }
    if (path.endsWith('/public/policy')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(policy) })
    }
    if (path.endsWith('/me/drive/connection')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          connection: {
            status: 'connected',
            google_email: 'worker@example.test',
            connected_at: '2026-01-01T10:00:00Z',
            last_refreshed_at: '2026-11-07T18:00:00Z',
            scopes: 'https://www.googleapis.com/auth/drive.readonly',
            has_refresh_token: true,
            policy_consent_version: policy.version,
            policy_consent_at: '2026-11-07T18:00:00Z',
          },
          policy,
        }),
      })
    }
    if (path.endsWith('/admin/audit-events')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [auditEvent], pagination: { page: 1, page_size: 25, total: 1 } }),
      })
    }
    if (path.endsWith('/admin/areas')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: areas, pagination: { total: areas.length } }),
      })
    }
    if (path.endsWith('/admin/users')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: workers, pagination: { total: workers.length } }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], pagination: { total: 0 } }),
    })
  })
}

async function scrollbarState(locator) {
  return locator.evaluate((element) => ({
    overflowX: getComputedStyle(element).overflowX,
    overflowY: getComputedStyle(element).overflowY,
    scrollbarWidth: getComputedStyle(element).scrollbarWidth,
    webkitScrollbar: getComputedStyle(element, '::-webkit-scrollbar').display,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }))
}

async function expectHiddenScrollbar(locator) {
  const state = await scrollbarState(locator)
  expect(state.scrollbarWidth).toBe('none')
  expect(state.webkitScrollbar).toBe('none')
  return state
}

async function scrollVertically(locator) {
  const scrolled = await locator.evaluate((element) => {
    element.scrollTop = Math.min(120, element.scrollHeight - element.clientHeight)
    return element.scrollTop
  })
  expect(scrolled).toBeGreaterThan(0)
}

test('workspace y navegación ocultan la barra y conservan scroll vertical', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 })
  await mockApi(page)
  await page.goto('/app/admin/workers')
  await expect(page.getByRole('heading', { name: 'Trabajadores', level: 1 })).toBeVisible()

  const workspace = page.getByTestId('admin-scroll')
  await workspace.evaluate((element) => {
    const block = document.createElement('div')
    block.style.height = '900px'
    element.querySelector('main').appendChild(block)
  })
  const workspaceState = await expectHiddenScrollbar(workspace)
  expect(workspaceState.overflowY).toBe('auto')
  expect(workspaceState.scrollHeight).toBeGreaterThan(workspaceState.clientHeight)
  await scrollVertically(workspace)

  const navigation = page.locator('.app-sidebar-navigation')
  await navigation.evaluate((element) => {
    const block = document.createElement('div')
    block.style.height = '900px'
    element.appendChild(block)
  })
  const navigationState = await expectHiddenScrollbar(navigation)
  expect(navigationState.overflowY).toBe('auto')
  expect(navigationState.scrollHeight).toBeGreaterThan(navigationState.clientHeight)
  await scrollVertically(navigation)
})

test('el modal global oculta la barra y mantiene el scroll del cuerpo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 })
  await mockApi(page)
  await page.goto('/app/admin/organization')
  await expect(page.getByRole('heading', { name: 'Áreas y cargos', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Nueva área' }).click()

  const body = page.getByTestId('modal-body')
  await expect(body).toHaveClass(/scrollbar-hidden/)
  await body.evaluate((element) => {
    element.innerHTML = '<div style="height: 900px">Contenido extenso</div>'
  })
  const state = await expectHiddenScrollbar(body)
  expect(state.overflowY).toBe('auto')
  expect(state.scrollHeight).toBeGreaterThan(state.clientHeight)
  await scrollVertically(body)
})

test('el modal de auditoría conserva scroll y barra oculta', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(page)
  await page.goto('/app/admin/audit')
  await expect(page.getByRole('heading', { name: 'Auditoría', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Ver detalle de Inicio de sesión administrativo' }).click()

  const body = page.getByTestId('audit-detail-body')
  await expect(body).toHaveClass(/admin-scroll-container/)
  await body.evaluate((element) => {
    const block = document.createElement('div')
    block.style.height = '900px'
    element.appendChild(block)
  })
  const state = await expectHiddenScrollbar(body)
  expect(state.overflowY).toBe('auto')
  expect(state.scrollHeight).toBeGreaterThan(state.clientHeight)
  await scrollVertically(body)
})

test('política, textarea y select usan la utilidad global', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(page)
  await page.goto('/app/admin/policy')
  await expect(page.getByRole('heading', { name: 'Política institucional', level: 1 })).toBeVisible()

  const documentBody = page.locator('div.scrollbar-hidden').filter({ hasText: 'Cláusula 1:' }).first()
  const documentState = await expectHiddenScrollbar(documentBody)
  expect(documentState.overflowY).toBe('auto')
  expect(documentState.scrollHeight).toBeGreaterThan(documentState.clientHeight)
  await scrollVertically(documentBody)

  const textarea = page.getByLabel('Contenido aprobado')
  await expect(textarea).toHaveClass(/scrollbar-hidden/)
  await textarea.fill(
    Array.from({ length: 120 }, (_, index) => `Línea de contenido ${index + 1}`).join('\n'),
  )
  const textareaState = await expectHiddenScrollbar(textarea)
  expect(textareaState.scrollHeight).toBeGreaterThan(textareaState.clientHeight)
  await scrollVertically(textarea)

  await page.goto('/app/admin/workers')
  await expect(page.getByRole('heading', { name: 'Trabajadores', level: 1 })).toBeVisible()
  await page.getByRole('combobox', { name: 'Filtrar por área' }).click()
  const viewport = page.locator('.select-viewport')
  await expect(viewport).toBeVisible()
  await expect(viewport).toHaveClass(/scrollbar-hidden/)
  await expect(page.getByRole('option', { name: 'Área institucional 30' })).toBeVisible()
  const viewportState = await expectHiddenScrollbar(viewport)
  expect(viewportState.overflowY).toBe('auto')
  expect(viewportState.scrollHeight).toBeGreaterThan(viewportState.clientHeight)
  await scrollVertically(viewport)
})

test('el disclosure de Google Drive conserva scroll sin barra', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page, 'user')
  await page.goto('/app/drive')
  await expect(page.getByRole('heading', { name: 'Conexión de Google Drive', level: 1 })).toBeVisible()
  await page.getByText('Leer el contenido de la política').click()

  const body = page.locator('.disclosure-body')
  const state = await expectHiddenScrollbar(body)
  expect(state.overflowY).toBe('auto')
  expect(state.scrollHeight).toBeGreaterThan(state.clientHeight)
  await scrollVertically(body)
})

test('las tablas conservan scroll horizontal sin barra visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await page.goto('/app/admin/workers')
  await expect(page.getByRole('heading', { name: 'Trabajadores', level: 1 })).toBeVisible()

  const wrap = page.locator('.table-wrap')
  const state = await expectHiddenScrollbar(wrap)
  expect(state.overflowX).toBe('auto')
  expect(state.scrollWidth).toBeGreaterThan(state.clientWidth)
  const scrolled = await wrap.evaluate((element) => {
    element.scrollLeft = 120
    return element.scrollLeft
  })
  expect(scrolled).toBeGreaterThan(0)
})

test('la utilidad de scrollbar es independiente del tema', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 })
  await mockApi(page)
  await page.goto('/app/admin/workers')
  await page.evaluate(() => localStorage.setItem('terra-theme', 'dark'))
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)

  const workspace = page.getByTestId('admin-scroll')
  await workspace.evaluate((element) => {
    const block = document.createElement('div')
    block.style.height = '900px'
    element.querySelector('main').appendChild(block)
  })
  const state = await expectHiddenScrollbar(workspace)
  expect(state.scrollHeight).toBeGreaterThan(state.clientHeight)
  await scrollVertically(workspace)
})
