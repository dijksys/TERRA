import { expect, test } from '@playwright/test'
import { ADMIN_PERMISSIONS } from '../fixtures/permissions'

const admin = {
  id: '11111111-1111-4111-8111-111111111111',
  display_name: 'Ada Admin',
  email: 'ada@example.test',
  status: 'active',
  roles: ['admin'],
}

const recentActivity = Array.from({ length: 12 }, (_, index) => ({
  id: `event-${index}`,
  action: `Evento de auditoría ${index + 1} con descripción operativa`,
  actor_name: 'Ada Admin',
  target_type: 'download_job',
  target_id: `job-${index}`.padEnd(12, '0'),
  created_at: `2026-11-26T${String(10 + index).padStart(2, '0')}:00:00Z`,
}))

const dashboard = {
  active_users: 12,
  pending_profiles: 0,
  suspended_users: 0,
  areas: 4,
  positions: 9,
  queued_jobs: 0,
  running_jobs: 0,
  waiting_authorization_jobs: 0,
  completed_jobs: 9,
  failed_jobs: 0,
  stored_bytes: 2883584,
  connected_drives: 6,
  reauth_drives: 0,
  oldest_queue_age_seconds: 0,
  queue_warning_threshold_seconds: 900,
  recent_activity: recentActivity,
}

async function mockDashboard(page) {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (path.endsWith('/auth/me')) {
      return json({
        user: admin,
        permissions: ADMIN_PERMISSIONS,
        has_local_credentials: true,
        must_rotate_password: false,
        pending_profile: false,
      })
    }
    if (path.endsWith('/admin/dashboard')) return json(dashboard)
    return json({ data: [], pagination: { total: 0 } })
  })
}

async function openDashboard(page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height })
  await page.goto('/app/admin')
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Accesos rápidos' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

async function metrics(page) {
  return page.evaluate(() => {
    const heading = (text) => [...document.querySelectorAll('h2')].find((node) => node.textContent.trim() === text)
    const activity = heading('Actividad reciente').closest('.card')
    const quick = heading('Accesos rápidos').closest('.card')
    const links = [...quick.querySelectorAll('a')]
    const last = links.at(-1)
    const rect = (node) => {
      const box = node.getBoundingClientRect()
      return { top: box.top, left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height }
    }
    return {
      activity: rect(activity),
      quick: rect(quick),
      lastLink: rect(last),
      activityRows: activity.querySelectorAll('li').length,
      activityDates: activity.querySelectorAll('li > span').length,
      quickBackground: getComputedStyle(quick).backgroundColor,
      quickBorder: getComputedStyle(quick).borderTopColor,
      links: links.map((link) => {
        const box = link.getBoundingClientRect()
        const icon = link.querySelector('svg')?.getBoundingClientRect()
        const style = getComputedStyle(link)
        return {
          width: box.width,
          height: box.height,
          iconLeft: icon?.left,
          linkLeft: box.left,
          radius: parseFloat(style.borderTopLeftRadius),
          justifyContent: style.justifyContent,
          background: style.backgroundColor,
          border: style.borderTopColor,
          text: link.textContent.trim(),
        }
      }),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })
}

test('Accesos rápidos conserva altura intrínseca y píldoras en todo el rango de anchos', async ({ page }) => {
  await mockDashboard(page)

  for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 800], [1024, 768], [768, 900], [390, 844], [320, 700]]) {
    await openDashboard(page, width, height)
    const data = await metrics(page)

    expect(data.horizontalOverflow, `overflow a ${width}px`).toBeFalsy()
    expect(data.links).toHaveLength(4)
    expect(data.activityRows).toBe(12)
    expect(data.activityDates).toBe(12)
    expect(data.quick.height, `altura natural a ${width}px`).toBeLessThan(data.activity.height - 40)

    const sideBySide = data.quick.left > data.activity.left + 10
    if (sideBySide) {
      expect(Math.abs(data.quick.top - data.activity.top), `alineación superior a ${width}px`).toBeLessThanOrEqual(1)
    } else {
      expect(data.quick.top, `apilado a ${width}px`).toBeGreaterThan(data.activity.top)
    }

    expect(data.quick.bottom - data.lastLink.bottom, `padding inferior a ${width}px`).toBeGreaterThanOrEqual(16)
    expect(data.quick.bottom - data.lastLink.bottom, `padding inferior a ${width}px`).toBeLessThanOrEqual(32)

    for (const link of data.links) {
      expect(link.width, `ancho interno a ${width}px`).toBeGreaterThan(data.quick.width * 0.8)
      expect(link.width).toBeCloseTo(data.links[0].width, 0)
      expect(link.height).toBeCloseTo(data.links[0].height, 0)
      expect(link.height).toBeGreaterThanOrEqual(40)
      expect(link.radius, `radio de píldora a ${width}px`).toBeGreaterThanOrEqual(link.height / 2)
      expect(link.justifyContent).toBe('flex-start')
      expect(link.iconLeft).toBeLessThan(link.linkLeft + 40)
    }
  }
})

test('Actividad reciente conserva registros, fechas y enlace de auditoría', async ({ page }) => {
  await mockDashboard(page)
  await openDashboard(page)

  const activity = page.getByRole('heading', { name: 'Actividad reciente' }).locator('xpath=ancestor::div[contains(@class,"card")][1]')
  await expect(activity.locator('li')).toHaveCount(12)
  await expect(activity.locator('li').first().locator('span').last()).toBeVisible()
  await expect(activity.getByRole('link', { name: 'Ver auditoría' })).toHaveAttribute('href', '/app/admin/audit')

  const separators = await activity.locator('li').nth(1).evaluate((element) => ({
    borderTopWidth: getComputedStyle(element).borderTopWidth,
    borderTopStyle: getComputedStyle(element).borderTopStyle,
    borderBottomWidth: getComputedStyle(element).borderBottomWidth,
    borderBottomStyle: getComputedStyle(element).borderBottomStyle,
  }))
  expect(parseFloat(separators.borderTopWidth) + parseFloat(separators.borderBottomWidth)).toBeGreaterThan(0)
  expect([separators.borderTopStyle, separators.borderBottomStyle]).toContain('solid')
})

test('las píldoras respetan tema claro, True Black, hover y foco', async ({ page }) => {
  await mockDashboard(page)
  await openDashboard(page)

  const quick = page.getByRole('heading', { name: 'Accesos rápidos' }).locator('xpath=ancestor::div[contains(@class,"card")][1]')
  const first = quick.getByRole('link', { name: 'Trabajadores' })
  const light = await metrics(page)
  expect(light.quickBackground).toBe('rgb(255, 255, 255)')
  expect(light.links[0].background).toBe('rgb(255, 255, 255)')
  expect(light.quickBorder).not.toBe(light.quickBackground)
  expect(light.links[0].border).not.toBe(light.links[0].background)

  await first.hover()
  const hoverBackground = await first.evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(hoverBackground).not.toBe(light.links[0].background)

  await page.evaluate(() => localStorage.setItem('terra-theme', 'dark'))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Accesos rápidos' })).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)
  const dark = await metrics(page)
  expect(dark.quickBackground).toBe('rgb(16, 16, 16)')
  expect(dark.links[0].background).toBe('rgb(8, 8, 8)')
  expect(dark.quickBorder).not.toBe(dark.quickBackground)
  expect(dark.links[0].border).not.toBe(dark.links[0].background)

  await page.keyboard.press('Tab')
  for (let index = 0; index < 40; index += 1) {
    const active = await page.evaluate(() => document.activeElement?.textContent?.trim())
    if (['Trabajadores', 'Conexiones de Drive', 'Historial de trabajos', 'Política institucional'].includes(active)) break
    await page.keyboard.press('Tab')
  }
  const focus = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement)
    return { outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle }
  })
  expect(focus.outlineStyle).not.toBe('none')
  expect(parseFloat(focus.outlineWidth)).toBeGreaterThan(0)
})
