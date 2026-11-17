import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Home, ShieldCheck } from 'lucide-react'
import { ThemeProvider } from '../../src/app/ThemeContext'
import AppSidebar from '../../src/components/navigation/AppSidebar'

const groups = [
  {
    id: 'general',
    label: 'GENERAL',
    items: [{ to: '/app', label: 'Inicio', icon: Home, end: true }],
  },
  {
    id: 'account-security',
    label: 'CUENTA Y SEGURIDAD',
    items: [{ to: '/app/security', label: 'Seguridad', icon: ShieldCheck }],
  },
]

const user = {
  display_name: 'Ada Admin',
  email: 'ada@example.test',
  area_name: 'Sistemas',
  roles: ['admin'],
}

function renderSidebar({
  sidebarGroups = groups,
  variant = 'desktop',
  onLogout = vi.fn(),
  onNavigate = vi.fn(),
} = {}) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/app']}>
        <AppSidebar
          groups={sidebarGroups}
          user={user}
          roleLabel="Administrador"
          variant={variant}
          onLogout={onLogout}
          onNavigate={onNavigate}
        />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('AppSidebar', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('muestra marca, grupos, enlaces, iconos, estado activo e identidad', () => {
    const { container } = renderSidebar()

    expect(screen.getByText('TERRA')).toBeInTheDocument()
    expect(screen.getByText('Gestión documental')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'GENERAL' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'CUENTA Y SEGURIDAD' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/app')
    expect(screen.getByRole('link', { name: 'Seguridad' })).toHaveAttribute('title', 'Seguridad')
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0)
    expect(screen.getByText('Ada Admin')).toBeInTheDocument()
    expect(screen.getByText('Administrador')).toBeInTheDocument()
    expect(screen.getByText('Sistemas')).toBeInTheDocument()
  })

  it('ejecuta logout y ThemeToggle sin alterar la navegación', () => {
    const onLogout = vi.fn()
    renderSidebar({ onLogout })

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(onLogout).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Activar modo oscuro' }))
    expect(screen.getByRole('button', { name: 'Activar modo claro' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inicio' })).toBeInTheDocument()
  })

  it('notifica la navegación desde un enlace', () => {
    const onNavigate = vi.fn()
    renderSidebar({ onNavigate })

    fireEvent.click(screen.getByRole('link', { name: 'Seguridad' }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('distingue la variante desktop de la variante drawer', () => {
    const desktop = renderSidebar()
    expect(desktop.container.querySelector('[data-variant="desktop"]')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-panel')).toBeInTheDocument()
    desktop.unmount()

    const drawer = renderSidebar({ variant: 'drawer' })
    expect(drawer.container.querySelector('[data-variant="drawer"]')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inicio' })).toBeInTheDocument()
  })

  it('renderiza grupos vacíos y respeta los grupos ya filtrados', () => {
    const empty = renderSidebar({ sidebarGroups: [] })
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByText('Ada Admin')).toBeInTheDocument()
    empty.unmount()

    renderSidebar({ sidebarGroups: [groups[0]] })
    expect(screen.getByRole('link', { name: 'Inicio' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Seguridad' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'CUENTA Y SEGURIDAD' })).not.toBeInTheDocument()
  })
})
