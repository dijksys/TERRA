import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminDashboard from '../../src/pages/admin/DashboardPage'
import { api } from '../../src/services/api'

const auth = vi.hoisted(() => ({ permissions: [] }))
const realtime = vi.hoisted(() => ({ handler: null }))

vi.mock('../../src/services/api', () => ({ api: { get: vi.fn() } }))
vi.mock('../../src/app/AuthContext', () => ({
  useAuth: () => ({ can: (permission) => auth.permissions.includes(permission) }),
}))
vi.mock('../../src/features/realtime/RealtimeContext', () => ({
  useRealtimeChannel: (channel, handler) => {
    realtime.handler = handler
    return 'connected'
  },
}))

const allPermissions = [
  'admin.dashboard.read', 'admin.users.read', 'admin.organization.read', 'admin.jobs.read',
  'admin.drive.read', 'admin.jobs.create', 'admin.audit.read', 'admin.policy.write',
]

const dashboard = {
  active_users: 12,
  pending_profiles: 2,
  suspended_users: 1,
  areas: 4,
  positions: 9,
  queued_jobs: 3,
  running_jobs: 2,
  waiting_authorization_jobs: 1,
  completed_jobs: 44,
  failed_jobs: 2,
  stored_bytes: 2883584,
  connected_drives: 6,
  reauth_drives: 2,
  oldest_queue_age_seconds: 1200,
  oldest_queued_age_seconds: 1200,
  oldest_waiting_authorization_age_seconds: 300,
  queue_warning_threshold_seconds: 900,
  recent_activity: [],
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <AdminDashboard />
    </MemoryRouter>,
  )
}

describe('Dashboard administrativo', () => {
  beforeEach(() => {
    auth.permissions = allPermissions
    api.get.mockReset()
    api.get.mockResolvedValue(dashboard)
  })

  it('presenta KPI accionables y conserva almacenamiento informativo', async () => {
    renderDashboard()
    expect(await screen.findByText('Trabajadores activos')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /Trabajadores activos/ })).toHaveAttribute('href', '/app/admin/workers?status=active')
    expect(screen.getByRole('link', { name: /Áreas \/ cargos/ })).toHaveAttribute('href', '/app/admin/organization')
    expect(screen.getByRole('link', { name: /Trabajos en curso/ })).toHaveAttribute('href', '/app/admin/jobs?status=active')
    expect(screen.getByRole('link', { name: /Completados/ })).toHaveAttribute('href', '/app/admin/jobs?status=completed')
    expect(screen.getByRole('link', { name: /Fallidos \/ parciales/ })).toHaveAttribute('href', '/app/admin/jobs?status=attention')
    expect(screen.getByRole('link', { name: /Drives conectados/ })).toHaveAttribute('href', '/app/admin/connections?status=connected')
    expect(screen.getByRole('link', { name: /Requieren reconexión/ })).toHaveAttribute('href', '/app/admin/connections?status=reauthorization_required')
    expect(screen.getByRole('link', { name: /Cola más antigua/ })).toHaveAttribute('href', '/app/admin/jobs?status=queued')
    expect(screen.queryByRole('link', { name: /Almacenamiento/ })).not.toBeInTheDocument()
    expect(screen.getByText('20 min')).toBeInTheDocument()
  })

  it('muestra alertas reales y enlaces operativos', async () => {
    renderDashboard()
    expect(await screen.findByText('Cola con espera prolongada')).toBeInTheDocument()
    expect(screen.getByText(/esperando\. El umbral configurado es 15 minutos/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Revisar cola' })).toHaveAttribute('href', '/app/admin/jobs?status=queued')
    expect(screen.getByText('Trabajos esperando autorización')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Revisar conexiones' })).toHaveAttribute('href', '/app/admin/connections?status=reauthorization_required')
    expect(screen.getByText('Conexiones que requieren reconexión')).toBeInTheDocument()
    expect(screen.getByText('Trabajos fallidos o parciales')).toBeInTheDocument()
  })

  it('oculta alertas sin contenido accionable', async () => {
    api.get.mockResolvedValue({
      ...dashboard,
      queued_jobs: 0,
      failed_jobs: 0,
      reauth_drives: 0,
      waiting_authorization_jobs: 0,
      oldest_queued_age_seconds: 0,
    })
    renderDashboard()
    expect(await screen.findByText('Trabajadores activos')).toBeInTheDocument()
    expect(screen.queryByText('Cola con espera prolongada')).not.toBeInTheDocument()
    expect(screen.queryByText('Trabajos esperando autorización')).not.toBeInTheDocument()
    expect(screen.queryByText('Conexiones que requieren reconexión')).not.toBeInTheDocument()
    expect(screen.queryByText('Trabajos fallidos o parciales')).not.toBeInTheDocument()
  })

  it('actualiza indicadores y alertas con dashboard.metrics', async () => {
    renderDashboard()
    await screen.findByText('Trabajadores activos')

    await act(async () => {
      realtime.handler({
        type: 'dashboard.metrics',
        data: { ...dashboard, queued_jobs: 0, oldest_queued_age_seconds: 0, reauth_drives: 0, waiting_authorization_jobs: 0, failed_jobs: 0 },
      })
    })

    expect(screen.queryByText('Cola con espera prolongada')).not.toBeInTheDocument()
    expect(screen.queryByText('Conexiones que requieren reconexión')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cola más antigua/ })).toBeInTheDocument()
  })

  it('respeta permisos: solo lectura no ve creación ni tarjetas fuera de su alcance', async () => {
    auth.permissions = ['admin.dashboard.read', 'admin.users.read', 'admin.jobs.read', 'admin.audit.read']
    renderDashboard()
    expect(await screen.findByText('Trabajadores activos')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Nueva descarga/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Áreas \/ cargos/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Drives conectados/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Trabajos en curso/ })).toBeInTheDocument()
  })

  it('presenta error inicial y estado sin actividad', async () => {
    api.get.mockRejectedValueOnce(new Error('dashboard no disponible'))
    const first = renderDashboard()
    expect(await screen.findByText('dashboard no disponible')).toBeInTheDocument()
    first.unmount()

    api.get.mockResolvedValue(dashboard)
    renderDashboard()
    expect(await screen.findByText('Sin actividad registrada.')).toBeInTheDocument()
  })

  it('presenta Accesos rápidos como píldoras con destinos e iconos actuales', async () => {
    renderDashboard()
    await screen.findByText('Trabajadores activos')

    const card = screen.getByRole('heading', { name: 'Accesos rápidos' }).closest('.card')
    expect(card).toHaveClass('h-fit', 'self-start')
    expect(within(card).getAllByRole('link')).toHaveLength(4)

    for (const [name, href, icon] of [
      ['Trabajadores', '/app/admin/workers', 'lucide-users'],
      ['Conexiones de Drive', '/app/admin/connections', 'lucide-database'],
      ['Historial de trabajos', '/app/admin/jobs', 'lucide-file-clock'],
      ['Política institucional', '/app/admin/policy', 'lucide-shield-alert'],
    ]) {
      const link = within(card).getByRole('link', { name })
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveClass('btn-secondary', 'w-full', 'justify-start', 'gap-3', 'rounded-full', 'px-4')
      const svg = link.querySelector('svg')
      expect(svg).toHaveClass(icon, 'h-4', 'w-4', 'shrink-0')
    }
  })

  it('adapta Accesos rápidos a la cantidad de permisos disponibles', async () => {
    auth.permissions = ['admin.dashboard.read', 'admin.users.read']
    renderDashboard()
    await screen.findByText('Trabajadores activos')

    const card = screen.getByRole('heading', { name: 'Accesos rápidos' }).closest('.card')
    expect(within(card).getAllByRole('link')).toHaveLength(1)
    expect(within(card).getByRole('link', { name: 'Trabajadores' })).toHaveAttribute('href', '/app/admin/workers')
    expect(within(card).queryByRole('link', { name: 'Conexiones de Drive' })).not.toBeInTheDocument()
  })

  it('omite la tarjeta de Accesos rápidos cuando no hay enlaces autorizados', async () => {
    auth.permissions = ['admin.dashboard.read']
    renderDashboard()
    await screen.findByText('Trabajadores activos')
    expect(screen.queryByRole('heading', { name: 'Accesos rápidos' })).not.toBeInTheDocument()
  })
})
