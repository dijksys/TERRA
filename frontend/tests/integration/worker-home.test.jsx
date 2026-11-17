import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkerHome from '../../src/pages/worker/HomePage'
import { api } from '../../src/services/api'

vi.mock('../../src/services/api', () => ({
  api: { get: vi.fn() },
}))

const realtime = vi.hoisted(() => ({ handler: null }))
vi.mock('../../src/features/realtime/RealtimeContext', () => ({
  useRealtimeChannel: (channel, handler) => {
    realtime.handler = handler
    return 'connected'
  },
}))

vi.mock('../../src/app/AuthContext', () => ({
  useAuth: () => ({
    user: {
      first_name: 'María',
      display_name: 'María Rodríguez',
      area_name: 'Recursos Humanos',
      position_name: 'Analista',
      email: 'maria@example.test',
    },
  }),
}))

const jobs = Array.from({ length: 5 }, (_, index) => ({
  id: `job-${index}`,
  status: index === 0 ? 'downloading' : 'completed',
  total_items: 2,
  downloaded_bytes: 1024,
  created_at: '2026-11-10T10:00:00Z',
}))

const connected = {
  status: 'connected',
  has_refresh_token: true,
  google_email: 'maria@example.test',
  policy_consent_version: '2026-11',
}
const policy = { version: '2026-11' }

function mockDashboard({ connection = connected, published = policy, summary = { active_jobs: 12, total_jobs: 40 }, summaryError = false } = {}) {
  api.get.mockImplementation((path) => {
    if (path === '/me/drive/connection') return Promise.resolve({ connection, policy: published })
    if (path === '/download-jobs?page_size=5') return Promise.resolve({ data: jobs, pagination: { total: 40 } })
    if (path === '/download-jobs/summary') {
      return summaryError ? Promise.reject(new Error('resumen no disponible')) : Promise.resolve(summary)
    }
    return Promise.reject(new Error(`ruta inesperada ${path}`))
  })
}

function renderHome() {
  return render(
    <MemoryRouter>
      <WorkerHome />
    </MemoryRouter>,
  )
}

describe('Dashboard del trabajador', () => {
  beforeEach(() => {
    api.get.mockReset()
    realtime.handler = null
  })

  async function emit(message) {
    await act(async () => {
      realtime.handler(message)
    })
  }

  it('usa el resumen agregado y no el tamaño de la lista reciente', async () => {
    mockDashboard()
    renderHome()
    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByText('Trabajos activos')).toBeInTheDocument()
    expect(screen.getAllByText('Trabajo JOB-0').length).toBeGreaterThan(0)
    expect(screen.queryByText('5')).not.toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/download-jobs/summary')
  })

  it.each([
    ['connected', true, 'Vinculada'],
    ['reauthorization_required', true, 'Requiere reconexión'],
    ['revoked', true, 'Revocada'],
    ['error', true, 'Error de conexión'],
    ['connected', false, 'Requiere reconexión'],
  ])('presenta la conexión %s con refresh token=%s como %s', async (status, hasRefreshToken, label) => {
    mockDashboard({ connection: { ...connected, status, has_refresh_token: hasRefreshToken } })
    renderHome()
    expect((await screen.findAllByText(label)).length).toBeGreaterThan(0)
  })

  it('presenta Sin conectar cuando no existe conexión', async () => {
    mockDashboard({ connection: null })
    renderHome()
    expect(await screen.findByText('Sin conectar')).toBeInTheDocument()
  })

  it.each([
    ['Aceptada', '2026-11'],
    ['Pendiente', '2026-10'],
  ])('presenta la política como %s cuando el consentimiento es %s', async (label, consent) => {
    mockDashboard({ connection: { ...connected, policy_consent_version: consent } })
    renderHome()
    expect((await screen.findAllByText(label)).length).toBeGreaterThan(0)
  })

  it('presenta Pendiente sin consentimiento y Sin publicar sin política', async () => {
    mockDashboard({ connection: { ...connected, policy_consent_version: '' } })
    const first = renderHome()
    expect((await screen.findAllByText('Pendiente')).length).toBeGreaterThan(0)
    first.unmount()

    mockDashboard({ published: null })
    renderHome()
    expect(await screen.findByText('Sin publicar')).toBeInTheDocument()
  })

  it('no presenta cero cuando el resumen falla', async () => {
    mockDashboard({ summaryError: true })
    renderHome()
    expect(await screen.findByText('No disponible')).toBeInTheDocument()
    expect(screen.getByText('No fue posible consultar el resumen de trabajos.')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('mantiene un estado de carga sin cifras falsas', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/me/drive/connection') return Promise.resolve({ connection: connected, policy })
      if (path === '/download-jobs?page_size=5') return Promise.resolve({ data: jobs, pagination: { total: 40 } })
      return new Promise(() => {})
    })
    renderHome()
    expect(await screen.findByText('…')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('aplica el snapshot inicial del canal del trabajador', async () => {
    mockDashboard()
    renderHome()
    await screen.findByText('12')

    await emit({
      type: 'worker.dashboard.snapshot',
      data: {
        generated_at: '2026-11-16T10:00:00Z',
        summary: { active_jobs: 3, total_jobs: 8 },
        recent: [{ ...jobs[0], id: 'new-job', status: 'queued' }],
      },
    })
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Trabajo NEW-JOB')).toBeInTheDocument()
    expect(screen.queryByText('Trabajo JOB-1')).not.toBeInTheDocument()
  })

  it('actualiza resumen y recientes con métricas sin duplicar ni dejar registros fuera del conjunto', async () => {
    mockDashboard()
    renderHome()
    await screen.findByText('12')

    await emit({
      type: 'worker.dashboard.metrics',
      data: {
        generated_at: '2026-11-16T10:01:00Z',
        summary: { active_jobs: 1, total_jobs: 41 },
        recent: [
          { ...jobs[0], id: 'job-new', status: 'completed' },
          { ...jobs[0], id: 'job-new', status: 'completed' },
          { ...jobs[1], id: 'job-1', status: 'downloading' },
        ],
      },
    })
    expect(screen.getAllByText('Trabajo JOB-NEW')).toHaveLength(1)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('Trabajo JOB-2')).not.toBeInTheDocument()
  })

  it('ignora mensajes fuera de orden', async () => {
    mockDashboard()
    renderHome()
    await screen.findByText('12')

    await emit({
      type: 'worker.dashboard.snapshot',
      data: { generated_at: '2026-11-16T10:02:00Z', summary: { active_jobs: 2 }, recent: jobs },
    })
    expect(screen.getByText('2')).toBeInTheDocument()

    await emit({
      type: 'worker.dashboard.metrics',
      data: { generated_at: '2026-11-16T10:01:00Z', summary: { active_jobs: 9 }, recent: [] },
    })
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Trabajo JOB-1')).toBeInTheDocument()
  })

  it('la reconexión reemplaza el estado con el snapshot persistido', async () => {
    mockDashboard()
    renderHome()
    await screen.findByText('12')

    await emit({
      type: 'worker.dashboard.snapshot',
      data: { generated_at: '2026-11-16T10:03:00Z', summary: { active_jobs: 4 }, recent: [jobs[2]] },
    })
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('Trabajo JOB-2')).toBeInTheDocument()
    expect(screen.queryByText('Trabajo JOB-4')).not.toBeInTheDocument()
  })
})
