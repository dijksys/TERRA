import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JobDetailPage from '../../src/pages/JobDetailPage'
import { api } from '../../src/services/api'

const auth = vi.hoisted(() => ({ can: vi.fn(() => true) }))
const realtime = vi.hoisted(() => ({ refs: null, connected: true }))
vi.mock('../../src/app/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../src/services/api', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } }
})
vi.mock('../../src/features/downloads/useJobEvents', () => ({
  useJobEvents: (jobId, onSnapshot, onItemEvent) => {
    realtime.refs = { jobId, onSnapshot, onItemEvent }
    return realtime.connected
  },
}))

const job = {
  id: 'job-1',
  status: 'downloading',
  scope_type: 'selected_items',
  total_items: 4,
  completed_items: 0,
  skipped_items: 0,
  failed_items: 0,
  total_bytes: 2048,
  downloaded_bytes: 0,
  created_at: '2026-11-05T10:00:00Z',
  drive_owner_name: 'Tra Bajador',
  requested_by_name: 'Ada Admin',
  area_name: 'Gestión Documental',
  position_name: 'Analista',
  roots: [],
  file_roots: [],
}

const item = (overrides = {}) => ({
  id: 'item-1',
  job_id: 'job-1',
  drive_node_id: 'node-1',
  google_file_id: 'file-1',
  stored_file_id: 'stored-file-1',
  name: 'Reporte.pdf',
  mime_type: 'application/pdf',
  status: 'completed',
  attempt_count: 1,
  size_bytes: 2048,
  sha256: 'abcdef0123456789',
  ...overrides,
})

function renderPage(basePath = '/app/jobs') {
  return render(
    <MemoryRouter initialEntries={[`${basePath}/job-1`]}>
      <Routes>
        <Route path={`${basePath}/:id`} element={<JobDetailPage basePath={basePath} />} />
      </Routes>
    </MemoryRouter>,
  )
}

function mockApi(items, jobOverride = job) {
  api.get.mockImplementation((path) => {
    if (path === '/download-jobs/job-1') return Promise.resolve(jobOverride)
    if (path.startsWith('/download-jobs/job-1/items')) {
      return Promise.resolve({ data: items, pagination: { page: 1, page_size: 25, total: items.length } })
    }
    return Promise.reject(new Error(`ruta inesperada ${path}`))
  })
}

function itemsCalls() {
  return api.get.mock.calls.filter(([path]) => path.startsWith('/download-jobs/job-1/items'))
}

async function emitItemEvent(type = 'job.item.started', payload = { item_id: 'item-1' }) {
  await act(async () => {
    realtime.refs.onItemEvent({ type, revision: 2, event_id: 10, data: { job_id: 'job-1', payload } })
  })
}

describe('JobDetailPage y descarga de archivos almacenados', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    auth.can.mockReset()
    auth.can.mockReturnValue(true)
    realtime.connected = true
    global.fetch = vi.fn()
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
    HTMLAnchorElement.prototype.click = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('usa un enlace nativo para stored_file_id sin fetch ni Blob', async () => {
    mockApi([item()])
    renderPage()

    const link = await screen.findByRole('link', { name: 'Descargar Reporte.pdf' })
    expect(link).toHaveAttribute('href', '/api/v1/files/stored-file-1/content')
    expect(link).toHaveTextContent('Descargar')
    expect(global.fetch).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
    expect(screen.getByText('Reporte.pdf')).toBeInTheDocument()
  })

  it('indica No disponible cuando falta stored_file_id', async () => {
    mockApi([item({ stored_file_id: null })])
    renderPage()

    await screen.findByText('Reporte.pdf')
    expect(screen.queryByRole('link', { name: 'Descargar Reporte.pdf' })).not.toBeInTheDocument()
    expect(screen.getByText('No disponible')).toBeInTheDocument()
  })

  it('un trabajador autorizado conserva el enlace de descarga', async () => {
    mockApi([item()])
    renderPage('/app/jobs')
    expect(await screen.findByRole('link', { name: 'Descargar Reporte.pdf' })).toBeInTheDocument()
  })

  it('oculta la descarga administrativa sin admin.files.read', async () => {
    auth.can.mockImplementation((permission) => permission !== 'admin.files.read')
    mockApi([item()])
    renderPage('/app/admin/jobs')

    await screen.findByText('Reporte.pdf')
    expect(screen.queryByRole('link', { name: 'Descargar Reporte.pdf' })).not.toBeInTheDocument()
    expect(screen.queryByText('No disponible')).not.toBeInTheDocument()
  })

  it('muestra progreso indeterminado, velocidad y transferencias activas', async () => {
    mockApi([item()], {
      ...job,
      status: 'downloading',
      progress: {
        stage: 'downloading',
        status: 'downloading',
        completed_bytes: 0,
        in_flight_bytes: 1234,
        transferred_bytes: 1234,
        known_total_bytes: 0,
        unknown_size_items: 1,
        byte_progress_percent: null,
        completed_items: 0,
        skipped_items: 0,
        failed_items: 0,
        pending_items: 1,
        retrying_items: 0,
        downloading_items: 1,
        download_speed_bytes_per_second: 1024,
        average_speed_bytes_per_second: 900,
        eta_seconds: null,
        scan: { folders_discovered: 3, folders_scanned: 2, items_found: 4, downloadable_items: 1, skipped_items: 1 },
        active_downloads: [{
          item_id: 'active-1', name: 'grande.bin', transferred_bytes: 1234,
          expected_bytes: null, progress_percent: null,
        }],
      },
    })
    renderPage()

    expect(await screen.findByText('Transferencias activas')).toBeInTheDocument()
    expect(screen.getByText('grande.bin')).toBeInTheDocument()
    expect(screen.getByText(/sin tamaño conocido/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Progreso indeterminado')
    expect(screen.getByText('En vuelo')).toBeInTheDocument()
  })

  it.each([
    ['job.item.started', 'Descargando'],
    ['job.item.retrying', 'Reintentando'],
    ['job.item.completed', 'Completado'],
    ['job.item.failed', 'Fallido'],
    ['job.item.skipped', 'Omitido'],
  ])('reconcilia la tabla al recibir %s', async (type, label) => {
    mockApi([item({ status: 'pending', stored_file_id: null })])
    renderPage()
    await screen.findByText('Reporte.pdf')
    expect(screen.getByText('Pendiente')).toBeInTheDocument()

    api.get.mockImplementation((path) => {
      if (path === '/download-jobs/job-1') return Promise.resolve(job)
      if (path.startsWith('/download-jobs/job-1/items')) {
        const statuses = {
          'job.item.started': 'downloading',
          'job.item.retrying': 'retrying',
          'job.item.completed': 'completed',
          'job.item.failed': 'failed',
          'job.item.skipped': 'skipped',
        }
        const status = statuses[type]
        return Promise.resolve({
          data: [item({ status, stored_file_id: status === 'completed' ? 'stored-file-1' : null })],
          pagination: { page: 1, page_size: 25, total: 1 },
        })
      }
      return Promise.reject(new Error(`ruta inesperada ${path}`))
    })

    await emitItemEvent(type)
    expect(await screen.findByText(label)).toBeInTheDocument()
  })

  it('actualiza los contadores superiores con el snapshot sin consultar la tabla por bytes', async () => {
    mockApi([item({ status: 'pending', stored_file_id: null })], { ...job, completed_items: 0 })
    renderPage()
    await screen.findByText('Reporte.pdf')
    const calls = itemsCalls().length

    await act(async () => {
      realtime.refs.onSnapshot({
        progress: {
          status: 'downloading', completed_items: 2, skipped_items: 1, failed_items: 1,
          byte_progress_percent: 50, transferred_bytes: 10, known_total_bytes: 20,
        },
        progress_revision: 3,
      })
    })

    expect(screen.getByText('4 / 4 elementos')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(itemsCalls()).toHaveLength(calls)
  })

  it('agrupa varias transiciones cercanas en una sola consulta', async () => {
    mockApi([item({ status: 'pending', stored_file_id: null })])
    renderPage()
    await screen.findByText('Reporte.pdf')
    const calls = itemsCalls().length

    await emitItemEvent('job.item.started')
    await emitItemEvent('job.item.completed')
    await emitItemEvent('job.item.retrying')

    await waitFor(() => expect(itemsCalls()).toHaveLength(calls + 1), { timeout: 2000 })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(itemsCalls()).toHaveLength(calls + 1)
  })

  it('conserva página, tamaño y total al reconciliar', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/download-jobs/job-1') return Promise.resolve(job)
      if (path.startsWith('/download-jobs/job-1/items')) {
        const total = path.includes('page=2') ? 30 : 60
        return Promise.resolve({
          data: [item({ status: 'pending', stored_file_id: null })],
          pagination: { page: path.includes('page=2') ? 2 : 1, page_size: 25, total },
        })
      }
      return Promise.reject(new Error(`ruta inesperada ${path}`))
    })
    renderPage()
    await screen.findByText('Reporte.pdf')

    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))
    await waitFor(() => expect(itemsCalls().at(-1)[0]).toContain('page=2'))
    expect(itemsCalls().at(-1)[0]).toContain('page_size=25')

    await emitItemEvent('job.item.started')
    await waitFor(() => expect(itemsCalls().at(-1)[0]).toContain('page=2'))
    expect(itemsCalls().at(-1)[0]).toContain('page_size=25')
    expect(await screen.findByText('26–30 de 30')).toBeInTheDocument()
  })

  it('una respuesta antigua no sobrescribe una consulta más reciente', async () => {
    const pending = []
    let itemsCall = 0
    api.get.mockImplementation((path) => {
      if (path === '/download-jobs/job-1') return Promise.resolve(job)
      if (path.startsWith('/download-jobs/job-1/items')) {
        itemsCall += 1
        const call = itemsCall
        return new Promise((resolve) => {
          pending.push({ call, resolve })
        })
      }
      return Promise.reject(new Error(`ruta inesperada ${path}`))
    })
    renderPage()
    await waitFor(() => expect(pending).toHaveLength(1))
    pending[0].resolve({
      data: [item({ status: 'pending', stored_file_id: null })],
      pagination: { page: 1, page_size: 25, total: 1 },
    })
    await screen.findByText('Reporte.pdf')

    await emitItemEvent('job.item.started')
    await waitFor(() => expect(pending).toHaveLength(2))
    await emitItemEvent('job.item.completed')
    await waitFor(() => expect(pending).toHaveLength(3))

    pending[2].resolve({
      data: [item({ status: 'completed', stored_file_id: 'stored-file-1' })],
      pagination: { page: 1, page_size: 25, total: 1 },
    })
    expect(await screen.findByText('Completado')).toBeInTheDocument()

    pending[1].resolve({
      data: [item({ status: 'pending', stored_file_id: null })],
      pagination: { page: 1, page_size: 25, total: 1 },
    })
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(screen.getByText('Completado')).toBeInTheDocument()
    expect(screen.queryByText('Pendiente')).not.toBeInTheDocument()
  })

  it('el fallback REST reconcilia la tabla cuando WebSocket no está conectado', async () => {
    vi.useFakeTimers()
    realtime.connected = false
    mockApi([item({ status: 'pending', stored_file_id: null })])
    renderPage()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const calls = itemsCalls().length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5200)
      await Promise.resolve()
    })

    expect(api.get.mock.calls.filter(([path]) => path === '/download-jobs/job-1').length).toBeGreaterThan(1)
    expect(itemsCalls().length).toBeGreaterThan(calls)
  }, 10000)
})
