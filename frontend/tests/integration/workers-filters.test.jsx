import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkersPanel from '../../src/pages/admin/WorkersPanel'
import { api } from '../../src/services/api'

vi.mock('../../src/services/api', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, api: { get: vi.fn() } }
})

const worker = {
  id: 'w1',
  first_name: 'María',
  last_name: 'Rodríguez',
  display_name: 'María Rodríguez',
  email: 'maria@example.test',
  area_id: 'a1',
  area_name: 'Recursos Humanos',
  position_id: 'p1',
  position_name: 'Jefatura',
  status: 'active',
  last_login_at: '2026-11-10T10:00:00Z',
}

const pending = {
  ...worker,
  id: 'w2',
  display_name: 'Pendiente Sin Área',
  email: 'pendiente@example.test',
  area_id: null,
  area_name: '',
  position_id: null,
  position_name: '',
  status: 'pending_profile',
}

const areas = [
  { id: 'a1', name: 'Recursos Humanos' },
  { id: 'a2', name: 'Sistemas' },
]
const positions = {
  a1: [{ id: 'p1', name: 'Jefatura' }, { id: 'p1b', name: 'Analista' }],
  a2: [{ id: 'p2', name: 'Desarrollo' }],
}

function usersRequest() {
  const path = api.get.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/admin/users?')).at(-1)
  return new URL(path, 'http://local')
}

function mockApi() {
  api.get.mockImplementation((path) => {
    const url = new URL(path, 'http://local')
    if (url.pathname === '/admin/areas') return Promise.resolve({ data: areas })
    const match = url.pathname.match(/^\/admin\/areas\/([^/]+)\/positions$/)
    if (match) return Promise.resolve({ data: positions[match[1]] || [] })
    if (url.pathname === '/admin/users') {
      return Promise.resolve({ data: [worker, pending], pagination: { total: 45 } })
    }
    return Promise.reject(new Error(`ruta inesperada ${path}`))
  })
}

async function chooseOption(name, option) {
  const trigger = screen.getByRole('combobox', { name })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.click(trigger)
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

function renderPanel(entry = '/app/admin/workers') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <WorkersPanel />
    </MemoryRouter>,
  )
}

describe('WorkersPanel con filtros combinados', () => {
  beforeEach(() => {
    api.get.mockReset()
    mockApi()
  })

  it('inicializa filtros desde la URL y los envía juntos al backend', async () => {
    renderPanel('/app/admin/workers?status=active&area_id=a1&position_id=p1')
    expect(await screen.findByText('María Rodríguez')).toBeInTheDocument()

    await waitFor(() => {
      const url = usersRequest()
      expect(url.searchParams.get('status')).toBe('active')
      expect(url.searchParams.get('area_id')).toBe('a1')
      expect(url.searchParams.get('position_id')).toBe('p1')
      expect(url.searchParams.get('page')).toBe('1')
    })
    expect(api.get).toHaveBeenCalledWith('/admin/areas/a1/positions')
  })

  it('al cambiar de área limpia el cargo, recarga cargos y reinicia la paginación', async () => {
    renderPanel('/app/admin/workers?status=active&area_id=a1&position_id=p1&page=2')
    await screen.findByText('María Rodríguez')

    await chooseOption('Filtrar por área', 'Sistemas')
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/admin/areas/a2/positions'))
    await waitFor(() => {
      const url = usersRequest()
      expect(url.searchParams.get('area_id')).toBe('a2')
      expect(url.searchParams.has('position_id')).toBe(false)
      expect(url.searchParams.get('page')).toBe('1')
      expect(url.searchParams.get('status')).toBe('active')
    })
    const cargo = screen.getByRole('combobox', { name: 'Filtrar por cargo' })
    expect(cargo).not.toBeDisabled()
  })

  it('permite combinar búsqueda, estado, área y cargo', async () => {
    renderPanel()
    await screen.findByText('María Rodríguez')

    fireEvent.change(screen.getByLabelText('Buscar trabajadores'), { target: { value: 'Recursos Humanos' } })
    fireEvent.click(screen.getByRole('button', { name: /Buscar/ }))
    await waitFor(() => expect(usersRequest().searchParams.get('q')).toBe('Recursos Humanos'))

    await chooseOption('Filtrar por estado', 'Perfil pendiente')
    await waitFor(() => expect(usersRequest().searchParams.get('status')).toBe('pending_profile'))

    await chooseOption('Filtrar por área', 'Recursos Humanos')
    await waitFor(() => expect(usersRequest().searchParams.get('area_id')).toBe('a1'))

    await chooseOption('Filtrar por cargo', 'Jefatura')
    await waitFor(() => expect(usersRequest().searchParams.get('position_id')).toBe('p1'))
    expect(usersRequest().searchParams.get('q')).toBe('Recursos Humanos')
    expect(usersRequest().searchParams.get('status')).toBe('pending_profile')
  })

  it('mantiene filtros al paginar', async () => {
    renderPanel('/app/admin/workers?status=active&area_id=a1')
    await screen.findByText('María Rodríguez')
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))
    await waitFor(() => {
      const url = usersRequest()
      expect(url.searchParams.get('page')).toBe('2')
      expect(url.searchParams.get('status')).toBe('active')
      expect(url.searchParams.get('area_id')).toBe('a1')
    })
  })

  it('limpia un cargo sin área para no generar combinaciones inválidas', async () => {
    renderPanel('/app/admin/workers?position_id=p1')
    await screen.findByText('María Rodríguez')
    await waitFor(() => {
      const url = usersRequest()
      expect(url.searchParams.has('position_id')).toBe(false)
      expect(url.searchParams.has('area_id')).toBe(false)
    })
  })

  it('identifica perfiles pendientes y asignaciones incompletas', async () => {
    renderPanel()
    expect(await screen.findByText('Pendiente Sin Área')).toBeInTheDocument()
    expect(screen.getByText('Perfil pendiente')).toBeInTheDocument()
    expect(screen.getByText('Sin área')).toBeInTheDocument()
    expect(screen.getByText('Sin cargo')).toBeInTheDocument()
    expect(screen.getByText('Recursos Humanos')).toBeInTheDocument()
    expect(screen.getByText('Jefatura')).toBeInTheDocument()
  })

  it('presenta error del listado y estado sin resultados', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/admin/areas') return Promise.resolve({ data: areas })
      if (path.startsWith('/admin/areas/')) return Promise.resolve({ data: [] })
      return Promise.reject(new Error('listado no disponible'))
    })
    const first = renderPanel()
    expect(await screen.findByText('listado no disponible')).toBeInTheDocument()
    first.unmount()

    mockApi()
    api.get.mockImplementation((path) => {
      if (path === '/admin/areas') return Promise.resolve({ data: areas })
      if (path.startsWith('/admin/areas/')) return Promise.resolve({ data: [] })
      return Promise.resolve({ data: [], pagination: { total: 0 } })
    })
    renderPanel()
    expect(await screen.findByText('No hay trabajadores con este filtro')).toBeInTheDocument()
  })
})
