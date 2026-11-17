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
  last_login_at: '2026-11-05T10:00:00Z',
}

const worker = {
  id: '22222222-2222-4222-8222-222222222222',
  first_name: 'Tra',
  last_name: 'Bajador',
  display_name: 'Trabajador de Prueba con Nombre Largo',
  email: 'trabajador@example.test',
  area_name: 'Gestión Documental',
  position_name: 'Analista de archivo institucional',
  status: 'active',
  roles: ['user'],
}

const connectionResponse = {
  connection: {
    status: 'connected',
    has_refresh_token: true,
    google_email: 'trabajador.institucional@example.test',
    connected_at: '2026-10-01T10:00:00Z',
    policy_consent_version: 3,
  },
  policy: { version: 3 },
}

const items = [
  {
    id: 'folder-1',
    name: 'Documentos institucionales con un nombre extraordinariamente largo para probar el truncamiento',
    mime_type: 'application/vnd.google-apps.folder',
    kind: 'folder',
    size_bytes: null,
    created_time: '2026-09-12T08:15:00Z',
    modified_time: '2026-11-04T16:45:00Z',
    can_download: false,
    is_shortcut: false,
    starred: true,
    shared: true,
  },
  {
    id: 'pdf-1',
    name: 'Informe de auditoría interna del ejercicio fiscal 2026 con anexos.pdf',
    mime_type: 'application/pdf',
    kind: 'file',
    size_bytes: 18432000,
    created_time: '2026-10-02T11:30:00Z',
    modified_time: '2026-11-01T09:05:00Z',
    can_download: true,
    is_shortcut: false,
    starred: false,
    shared: true,
    web_view_link: 'https://drive.google.com/file/d/pdf-1/view',
  },
  {
    id: 'sheet-1',
    name: 'Presupuesto consolidado',
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'file',
    size_bytes: 524288,
    created_time: '2026-09-20T12:00:00Z',
    modified_time: '2026-10-28T18:20:00Z',
    can_download: true,
    is_shortcut: false,
    starred: false,
    shared: false,
  },
  {
    id: 'locked-1',
    name: 'Respaldo restringido.bin',
    mime_type: 'application/octet-stream',
    kind: 'file',
    size_bytes: null,
    created_time: '2026-08-01T07:00:00Z',
    modified_time: '2026-08-02T07:00:00Z',
    can_download: false,
    is_shortcut: false,
    starred: false,
    shared: false,
  },
]

async function mockApi(page) {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: viewer,
          permissions: ADMIN_PERMISSIONS,
          has_local_credentials: true,
          must_rotate_password: false,
          pending_profile: false,
        }),
      })
    }
    if (path.endsWith('/drive/connection')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(connectionResponse) })
    }
    if (path.endsWith('/drive/items')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          parent: { id: 'root-id', name: 'Mi unidad' },
          path: [{ id: 'root-id', name: 'Mi unidad' }],
          is_root: true,
          items,
          next_page_token: '',
        }),
      })
    }
    if (path.endsWith('/admin/users')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [worker], pagination: { total: 1 } }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], pagination: { total: 0 } }),
    })
  })
}

async function openWizard(page) {
  await mockApi(page)
  await page.goto('/app/admin/downloads?worker=' + worker.id)
  await expect(page.getByRole('heading', { name: 'Nueva descarga institucional' })).toBeVisible()
  await page.locator('input[value="selected_items"]').check()
  await expect(page.getByText(items[0].name)).toBeVisible()
}

async function measure(page) {
  return page.evaluate(() => {
    const table = document.querySelector('table')
    const wrap = table.closest('.table-wrap')
    const card = table.closest('.card')
    const main = document.querySelector('[data-testid="admin-scroll"] main')
    const workspace = document.querySelector('[data-testid="admin-workspace"]')
    const pageRoot = main.firstElementChild
    return {
      workspace: workspace.clientWidth,
      main: main.clientWidth,
      page: pageRoot.clientWidth,
      card: card.clientWidth,
      wrap: wrap.clientWidth,
      wrapScroll: wrap.scrollWidth,
      table: table.clientWidth,
      tableScroll: table.scrollWidth,
      docClient: document.documentElement.clientWidth,
      docScroll: document.documentElement.scrollWidth,
      bodyScroll: document.body.scrollWidth,
    }
  })
}

test.describe('Descargas aprovecha el ancho del workspace', () => {
  test('mide la distribución responsive y no desborda el documento', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openWizard(page)

    const results = {}
    for (const width of [1920, 1648, 1440, 1366, 1280, 1024, 900, 768, 390, 360]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : width === 360 ? 800 : 900 })
      await page.waitForTimeout(120)
      results[width] = await measure(page)
    }

    for (const [width, m] of Object.entries(results)) {
      expect(m.docScroll, `documento a ${width}px`).toBeLessThanOrEqual(m.docClient + 1)
      expect(m.bodyScroll, `body a ${width}px`).toBeLessThanOrEqual(m.docClient + 1)
      expect(m.page, `página a ${width}px`).toBeLessThanOrEqual(m.main + 1)
      expect(m.card, `tarjeta a ${width}px`).toBeLessThanOrEqual(m.page + 1)
      expect(m.wrap, `tabla a ${width}px`).toBeLessThanOrEqual(m.card + 1)
      if (Number(width) >= 1024) {
        expect(m.tableScroll, `tabla sin scroll a ${width}px`).toBeLessThanOrEqual(m.wrap + 1)
        expect(m.wrapScroll, `contenedor sin scroll a ${width}px`).toBeLessThanOrEqual(m.wrap + 1)
      }
    }

    expect(results[1920].card).toBeGreaterThan(1400)
    expect(results[1440].card).toBeGreaterThan(1000)
    expect(results[1024].card).toBeGreaterThan(600)

    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.waitForTimeout(120)
    await expect(page.getByRole('columnheader', { name: 'Elemento' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Tipo' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Tamaño' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Fechas' })).toBeVisible()

    const scrollTop = async (width, height) => {
      await page.setViewportSize({ width, height })
      await page.waitForTimeout(120)
      await page.evaluate(() => document.querySelector('[data-testid="admin-scroll"]')?.scrollTo(0, 0))
      await page.waitForTimeout(80)
    }

    await scrollTop(1920, 1400)
    await page.screenshot({ path: '/tmp/terra-downloads-1920.png' })

    await scrollTop(1440, 1300)
    await page.screenshot({ path: '/tmp/terra-downloads-1440.png' })
    await page.locator('table').evaluate((table) => table.closest('.card').setAttribute('data-shot', 'explorer'))
    await page.locator('[data-shot="explorer"]').screenshot({ path: '/tmp/terra-downloads-explorer-1440.png' })

    // 1024: se muestra Tipo y las fechas se reorganizan bajo el nombre.
    await scrollTop(1024, 900)
    await expect(page.getByRole('columnheader', { name: 'Tipo' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Fechas' })).toBeHidden()

    // En un contenedor estrecho las columnas secundarias se reorganizan bajo el nombre.
    await page.setViewportSize({ width: 900, height: 800 })
    await page.waitForTimeout(120)
    await expect(page.getByRole('columnheader', { name: 'Tipo' })).toBeHidden()
    await expect(page.getByRole('columnheader', { name: 'Fechas' })).toBeHidden()
    await expect(page.getByText('application/pdf').first()).toBeVisible()
    await page.screenshot({ path: '/tmp/terra-downloads-900.png', fullPage: true })

    await scrollTop(390, 1400)
    await page.screenshot({ path: '/tmp/terra-downloads-390.png' })

    await scrollTop(360, 1400)
    await page.screenshot({ path: '/tmp/terra-downloads-360.png' })

    // El explorador usa las mismas superficies y bordes en True Black.
    await page.evaluate(() => localStorage.setItem('terra-theme', 'dark'))
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Nueva descarga institucional' })).toBeVisible()
    await page.locator('input[value="selected_items"]').check()
    await expect(page.locator('table')).toBeVisible()
    await scrollTop(1440, 1300)
    await page.locator('table').evaluate((table) => table.closest('.card').setAttribute('data-shot', 'explorer-dark'))
    await page.locator('[data-shot="explorer-dark"]').screenshot({ path: '/tmp/terra-downloads-dark-1440.png' })
  })
})

test('el selector de trabajadores ocupa el ancho disponible de la tarjeta', async ({ page }) => {
  await mockApi(page)
  const selectorWorkers = Array.from({ length: 6 }, (_, index) => ({
    ...worker,
    id: `44444444-4444-4444-8444-44444444444${index}`,
    first_name: 'Trabajador',
    last_name: `Selección ${index + 1}`,
    display_name: `Trabajador de Selección ${index + 1}`,
    email: `seleccion${index + 1}@example.test`,
  }))
  await page.route(/\/api\/v1\/admin\/users\?/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: selectorWorkers, pagination: { total: selectorWorkers.length } }),
    }),
  )
  await page.route(/\/api\/v1\/admin\/users\/[^/?]+$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: worker, organization_history: [] }),
    }),
  )

  const measureSelector = () => page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    const section = box('[data-testid="worker-selector-section"]')
    const cards = [...document.querySelectorAll('[data-testid="worker-results"] li > button')]
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      })
    const firstRow = cards.length
      ? cards.filter((card) => Math.abs(card.y - cards[0].y) <= 2).length
      : 0
    return {
      section,
      header: box('[data-testid="worker-selector-header"]'),
      search: box('[data-testid="worker-search-area"]'),
      selected: box('[data-testid="selected-worker"]'),
      results: box('[data-testid="worker-results"]'),
      pagination: box('[data-testid="worker-pagination"]'),
      cards,
      columns: firstRow,
      docClient: document.documentElement.clientWidth,
      docScroll: document.documentElement.scrollWidth,
    }
  })

  const expectedColumns = {
    1920: 3,
    1648: 3,
    1440: [2, 3],
    1280: [2, 3],
    1024: [2, 3],
    768: [1, 2],
    390: 1,
    360: 1,
    320: 1,
  }
  const lightShots = [1920, 1440, 1024, 390]

  for (const width of [1920, 1648, 1440, 1280, 1024, 768, 390, 360, 320]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 })
    await page.goto(`/app/admin/downloads?worker=${worker.id}`)
    await expect(page.getByTestId('worker-selector-section')).toBeVisible()
    await expect(page.getByTestId('selected-worker')).toBeVisible()
    await expect(page.getByRole('list', { name: 'Resultados de trabajadores' })).toBeVisible()

    const m = await measureSelector()
    expect(m.docScroll, `sin scroll horizontal a ${width}px`).toBeLessThanOrEqual(m.docClient + 1)
    expect(m.header.y, `encabezado superior a ${width}px`).toBeLessThan(m.search.y)
    expect(m.search.y, `buscador antes de resultados a ${width}px`).toBeLessThan(m.results.y)
    expect(m.results.y, `resultados antes de paginación a ${width}px`).toBeLessThan(m.pagination.y)
    expect(Math.abs(m.results.width - m.section.width), `resultados de ancho completo a ${width}px`).toBeLessThanOrEqual(2)
    expect(m.results.x - m.section.x, `sin columna izquierda vacía a ${width}px`).toBeLessThanOrEqual(2)
    expect(m.selected.x).toBeGreaterThanOrEqual(m.section.x)
    expect(m.selected.x + m.selected.width).toBeLessThanOrEqual(m.section.x + m.section.width + 1)
    expect(m.pagination.x).toBeGreaterThanOrEqual(m.section.x - 1)
    expect(m.pagination.x + m.pagination.width).toBeLessThanOrEqual(m.section.x + m.section.width + 1)
    expect(m.search.width).toBeLessThanOrEqual(m.results.width + 1)

    const wanted = expectedColumns[width]
    if (Array.isArray(wanted)) {
      expect(wanted, `columnas a ${width}px`).toContain(m.columns)
    } else {
      expect(m.columns, `columnas a ${width}px`).toBe(wanted)
    }
    expect(m.cards.every((card) => card.height > 0 && card.width <= m.results.width)).toBe(true)

    if (lightShots.includes(width)) {
      await page.screenshot({ path: `/tmp/terra-worker-selector-${width}.png`, fullPage: false })
    }
  }

  await page.evaluate(() => localStorage.setItem('terra-theme', 'dark'))
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByTestId('worker-selector-section')).toBeVisible()
  for (const width of lightShots) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 })
    await expect(page.getByRole('list', { name: 'Resultados de trabajadores' })).toBeVisible()
    await expect(page.getByTestId('selected-worker')).toBeVisible()
    await page.screenshot({ path: `/tmp/terra-worker-selector-dark-${width}.png`, fullPage: false })
    const m = await measureSelector()
    expect(m.docScroll, `sin scroll horizontal en oscuro a ${width}px`).toBeLessThanOrEqual(m.docClient + 1)
    expect(m.header.y).toBeLessThan(m.search.y)
    expect(m.search.y).toBeLessThan(m.results.y)
  }
})
