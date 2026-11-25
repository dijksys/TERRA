import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingPage from '../../src/pages/OnboardingPage'

const auth = vi.hoisted(() => ({
  user: null,
  loading: false,
  pendingProfile: false,
  refresh: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/app/AuthContext', () => ({ useAuth: () => auth }))

vi.mock('../../src/features/profile/ProfileForm', () => ({
  default: ({ submitLabel }) => (
    <form>
      <button type="submit">{submitLabel}</button>
    </form>
  ),
}))

const pendingUser = {
  id: 'worker-1',
  first_name: 'María',
  last_name: 'Rodríguez',
  display_name: 'María Rodríguez',
  email: 'maria@example.test',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/onboarding']}>
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/" element={<p>inicio</p>} />
        <Route path="/app" element={<p>aplicación</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('OnboardingPage', () => {
  beforeEach(() => {
    auth.user = pendingUser
    auth.loading = false
    auth.pendingProfile = true
    auth.refresh.mockClear()
  })

  it('muestra la cabecera tipo píldora y la composición de onboarding', () => {
    const { container } = renderPage()

    const navbar = screen.getByTestId('onboarding-navbar')
    expect(navbar.tagName).toBe('HEADER')
    expect(navbar).toHaveClass('rounded-full', 'border', 'border-border', 'bg-card', 'shadow-sm', 'min-h-16', 'w-full')

    expect(within(navbar).getByText('T')).toBeInTheDocument()
    expect(within(navbar).getByText('TERRA')).toBeInTheDocument()
    expect(within(navbar).getByText('Configuración inicial')).toBeInTheDocument()
    expect(within(navbar).queryByRole('button')).not.toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Complete su perfil', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Datos personales')).toBeInTheDocument()
    expect(screen.getByText('Área y cargo')).toBeInTheDocument()
    expect(screen.getByText('Perfil activo')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-steps')).toHaveClass('grid')

    expect(container.querySelector('form')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Activar mi perfil' })).toBeInTheDocument()

    // La cabecera vive en un contenedor con el mismo ancho y padding que el contenido.
    const headerWrapper = navbar.parentElement
    expect(headerWrapper).toHaveClass('mx-auto', 'w-full', 'max-w-3xl', 'px-4', 'sm:px-6')
    expect(container.querySelector('main')).toHaveClass('mx-auto', 'w-full', 'max-w-3xl', 'px-4', 'sm:px-6')
  })

  it('redirige a / cuando no hay sesión', async () => {
    auth.user = null
    auth.loading = false
    renderPage()
    expect(await screen.findByText('inicio')).toBeInTheDocument()
  })

  it('redirige a /app cuando el perfil ya está activo', async () => {
    auth.pendingProfile = false
    renderPage()
    expect(await screen.findByText('aplicación')).toBeInTheDocument()
  })

  it('muestra el estado de carga sin la cabecera', () => {
    auth.loading = true
    auth.user = null
    renderPage()
    expect(screen.getByText('Verificando su cuenta…')).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-navbar')).not.toBeInTheDocument()
  })
})
