import { expect, test } from '@playwright/test'
import { WORKER_PERMISSIONS } from '../fixtures/permissions'
import { selectOption } from './helpers/select'

const pendingUser = {
  id: 'worker-1',
  first_name: '',
  last_name: '',
  display_name: 'María Rodríguez',
  email: 'maria@example.test',
  area_id: null,
  position_id: null,
  status: 'pending',
  roles: ['user'],
}

async function mockOnboarding(context) {
  await context.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/auth/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: pendingUser,
          permissions: WORKER_PERMISSIONS,
          has_local_credentials: false,
          must_rotate_password: false,
          pending_profile: true,
        }),
      })
    }
    if (path.endsWith('/public/areas')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ id: 'area-1', name: 'Recursos Humanos' }, { id: 'area-2', name: 'Sistemas' }] }),
      })
    }
    if (/\/public\/areas\/[^/]+\/positions$/.test(path)) {
      const area = path.split('/').at(-2)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: area === 'area-2'
            ? [{ id: 'position-2', name: 'Analista' }]
            : [{ id: 'position-1', name: 'Secretaría' }],
        }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], pagination: { total: 0 } }),
    })
  })
}

async function openOnboarding(page, width, height) {
  await page.setViewportSize({ width, height })
  await page.goto('/onboarding')
  await expect(page.getByTestId('onboarding-navbar')).toBeVisible()
  await expect(page.getByTestId('onboarding-steps')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

const viewports = [
  [1920, 1080],
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [768, 900],
  [390, 844],
  [360, 800],
  [320, 700],
]

test('la cabecera es una píldora alineada con el grid de tarjetas en todos los viewports', async ({ page }) => {
  await mockOnboarding(page)

  for (const [width, height] of viewports) {
    await openOnboarding(page, width, height)

    const metrics = await page.evaluate(() => {
      const navbar = document.querySelector('[data-testid="onboarding-navbar"]')
      const steps = document.querySelector('[data-testid="onboarding-steps"]')
      const logo = navbar.querySelector('span')
      const nav = navbar.getBoundingClientRect()
      const grid = steps.getBoundingClientRect()
      const logoBox = logo.getBoundingClientRect()
      const style = getComputedStyle(navbar)
      return {
        navbar: { left: nav.left, right: nav.right, width: nav.width, height: nav.height },
        steps: { left: grid.left, right: grid.right, width: grid.width },
        radius: parseFloat(style.borderTopLeftRadius),
        background: style.backgroundColor,
        borderColor: style.borderTopColor,
        borderWidth: parseFloat(style.borderTopWidth),
        borderStyle: style.borderTopStyle,
        shadow: style.boxShadow,
        minHeight: style.minHeight,
        classList: navbar.className,
        logo: { width: logoBox.width, height: logoBox.height, radius: getComputedStyle(logo).borderRadius },
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }
    })

    expect(Math.abs(metrics.navbar.left - metrics.steps.left), `left a ${width}px`).toBeLessThanOrEqual(1)
    expect(Math.abs(metrics.navbar.right - metrics.steps.right), `right a ${width}px`).toBeLessThanOrEqual(1)
    expect(Math.abs(metrics.navbar.width - metrics.steps.width), `width a ${width}px`).toBeLessThanOrEqual(1)
    expect(metrics.navbar.height, `altura a ${width}px`).toBeGreaterThanOrEqual(60)
    expect(metrics.radius, `radio a ${width}px`).toBeGreaterThanOrEqual(metrics.navbar.height / 2)
    expect(metrics.borderWidth, `borde a ${width}px`).toBeGreaterThan(0)
    expect(metrics.borderStyle).toBe('solid')
    expect(metrics.shadow).not.toBe('none')
    expect(metrics.classList.split(' ')).not.toContain('border-b')
    expect(metrics.navbar.width).toBeLessThan(width - 16)
    expect(metrics.logo.width).toBe(40)
    expect(metrics.logo.height).toBe(40)
    expect(metrics.horizontalOverflow, `overflow a ${width}px`).toBeFalsy()
  }
})

test('la píldora conserva marca, textos y ausencia de controles', async ({ page }) => {
  await mockOnboarding(page)
  await openOnboarding(page, 1440, 900)

  const navbar = page.getByTestId('onboarding-navbar')
  await expect(navbar.getByText('T', { exact: true })).toBeVisible()
  await expect(navbar.getByText('TERRA', { exact: true })).toBeVisible()
  await expect(navbar.getByText('Configuración inicial', { exact: true })).toBeVisible()
  await expect(navbar.getByRole('button')).toHaveCount(0)
  await expect(navbar.getByRole('link')).toHaveCount(0)

  const brand = await page.evaluate(() => {
    const logo = document.querySelector('[data-testid="onboarding-navbar"] span')
    const texts = [...document.querySelectorAll('[data-testid="onboarding-navbar"] p')]
    return {
      logoBackground: getComputedStyle(logo).backgroundColor,
      texts: texts.map((node) => ({
        fontSize: getComputedStyle(node).fontSize,
        color: getComputedStyle(node).color,
        overflow: node.scrollWidth > node.clientWidth,
      })),
    }
  })
  expect(brand.logoBackground).toBe('rgb(4, 120, 87)')
  expect(brand.texts[0].fontSize).toBe('14px')
  expect(brand.texts[1].fontSize).toBe('12px')
  expect(brand.texts.every((text) => !text.overflow)).toBeTruthy()
})

test('la píldora se adapta al tema claro y True Black', async ({ page }) => {
  await mockOnboarding(page)
  await openOnboarding(page, 1440, 900)

  const luminance = (color) => {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [0, 0, 0]
    const linear = channels.map((value) => {
      const channel = value / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }

  const light = await page.evaluate(() => {
    const navbar = document.querySelector('[data-testid="onboarding-navbar"]')
    const logo = navbar.querySelector('span')
    return {
      background: getComputedStyle(navbar).backgroundColor,
      border: getComputedStyle(navbar).borderTopColor,
      logo: getComputedStyle(logo).backgroundColor,
      text: getComputedStyle(navbar.querySelector('p')).color,
    }
  })
  expect(light.background).toBe('rgb(255, 255, 255)')
  expect(light.border).not.toBe(light.background)
  expect(light.logo).toBe('rgb(4, 120, 87)')
  expect(luminance(light.text)).toBeLessThan(luminance(light.background))

  await page.evaluate(() => localStorage.setItem('terra-theme', 'dark'))
  await page.reload()
  await expect(page.getByTestId('onboarding-navbar')).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)

  const dark = await page.evaluate(() => {
    const navbar = document.querySelector('[data-testid="onboarding-navbar"]')
    const logo = navbar.querySelector('span')
    return {
      body: getComputedStyle(document.body).backgroundColor,
      background: getComputedStyle(navbar).backgroundColor,
      border: getComputedStyle(navbar).borderTopColor,
      logo: getComputedStyle(logo).backgroundColor,
      text: getComputedStyle(navbar.querySelector('p')).color,
    }
  })
  expect(dark.body).toBe('rgb(0, 0, 0)')
  expect(dark.background).toBe('rgb(16, 16, 16)')
  expect(dark.border).toBe('rgb(38, 38, 38)')
  expect(dark.logo).toBe('rgb(4, 120, 87)')
  expect(luminance(dark.text)).toBeGreaterThan(0.7)
})

test('el formulario conserva campos, dependencia área/cargo y validaciones', async ({ page }) => {
  await mockOnboarding(page)
  await openOnboarding(page, 1440, 900)

  await expect(page.getByLabel('Nombres')).toBeVisible()
  await expect(page.getByLabel('Apellidos')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Área' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Cargo' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Activar mi perfil' })).toBeVisible()

  await selectOption(page, 'Área', 'Sistemas')
  const cargo = page.getByRole('combobox', { name: 'Cargo' })
  await expect(cargo).not.toBeDisabled()
  await selectOption(page, 'Cargo', 'Analista')
  await expect(cargo).toContainText('Analista')

  await page.getByRole('button', { name: 'Activar mi perfil' }).click()
  await expect(page.getByText('Ingrese sus nombres.')).toBeVisible()
  await expect(page.getByText('Ingrese sus apellidos.')).toBeVisible()

  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBeFalsy()
})
