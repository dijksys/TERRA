import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DownloadWizardPage from '../../src/pages/admin/DownloadWizardPage'
import { api } from '../../src/services/api'

const picker = vi.hoisted(() => ({ selection: { folders: [], files: [] } }))
vi.mock('../../src/services/api', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } }
})
vi.mock('../../src/features/drive/FolderPicker', () => ({
  default: ({ selected, onChange }) => {
    picker.selection = selected
    return (
      <div>
        <output data-testid="picker-selection">{selected.folders.length}/{selected.files.length}</output>
        <button type="button" onClick={() => onChange({ folders: [{ id: 'folder-1' }], files: [] })}>
          Añadir carpeta
        </button>
      </div>
    )
  },
}))

const worker = {
  id: '11111111-1111-4111-8111-111111111111',
  first_name: 'María',
  last_name: 'Rodríguez',
  display_name: 'María Rodríguez',
  email: 'maria@example.test',
  area_name: 'Recursos Humanos',
  position_name: 'Jefatura',
  status: 'active',
}

const otherWorker = {
  id: '22222222-2222-4222-8222-222222222222',
  first_name: 'Juan',
  last_name: 'Pérez',
  display_name: 'Juan Pérez',
  email: 'juan@example.test',
  area_name: 'Sistemas',
  position_name: 'Analista',
  status: 'active',
}

const connection = { status: 'connected', has_refresh_token: true, policy_consent_version: '2026-11' }
const policy = { version: '2026-11' }

function defaultGet(path) {
  const url = new URL(path, 'http://local')
  if (url.pathname === '/admin/users') {
    const page = Number(url.searchParams.get('page') || 1)
    const q = url.searchParams.get('q') || ''
    if (q === 'sin-resultados') return Promise.resolve({ data: [], pagination: { total: 0 } })
    if (q === 'error') return Promise.reject(new Error('búsqueda falló'))
    if (page === 2) return Promise.resolve({ data: [otherWorker], pagination: { total: 45 } })
    return Promise.resolve({ data: [worker], pagination: { total: 45 } })
  }
  const detail = url.pathname.match(/^\/admin\/users\/([^/]+)$/)
  if (detail) {
    const id = detail[1]
    const user = id === otherWorker.id ? otherWorker : worker
    return Promise.resolve({ user, organization_history: [] })
  }
  if (url.pathname.endsWith('/drive/connection')) {
    return Promise.resolve({ connection, policy })
  }
  return Promise.reject(new Error(`ruta inesperada ${path}`))
}

function renderWizard(entry = '/app/admin/downloads') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <DownloadWizardPage />
    </MemoryRouter>,
  )
}

function usersRequests() {
  return api.get.mock.calls.map(([path]) => path).filter((path) => path.startsWith('/admin/users?'))
}

describe('Selector remoto de trabajadores', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.get.mockImplementation(defaultGet)
    picker.selection = { folders: [], files: [] }
  })

  it('carga resultados paginados de 20 y nunca solicita 100', async () => {
    renderWizard()
    expect(await screen.findByText('María Rodríguez')).toBeInTheDocument()

    await waitFor(() => expect(usersRequests().length).toBeGreaterThan(0))
    const initial = new URL(usersRequests()[0], 'http://local')
    expect(initial.searchParams.get('status')).toBe('active')
    expect(initial.searchParams.get('page_size')).toBe('20')
    expect(initial.searchParams.get('page')).toBe('1')
    expect(usersRequests().some((path) => path.includes('page_size=100'))).toBe(false)
    expect(screen.getByText('45 coincidencia(s) · página 1 de 3')).toBeInTheDocument()
    expect(screen.getByText('maria@example.test')).toBeInTheDocument()
    expect(screen.getByText('Recursos Humanos / Jefatura · Activo')).toBeInTheDocument()
  })

  it('busca remotamente por área, cargo, nombre o correo y conserva el término', async () => {
    renderWizard()
    await screen.findByText('María Rodríguez')

    fireEvent.change(screen.getByLabelText('Buscar trabajadores'), { target: { value: 'Recursos Humanos' } })
    await waitFor(() => expect(usersRequests().some((path) => path.includes('q=Recursos+Humanos'))).toBe(true))
    expect(screen.getByLabelText('Buscar trabajadores')).toHaveValue('Recursos Humanos')

    fireEvent.change(screen.getByLabelText('Buscar trabajadores'), { target: { value: 'maria@example.test' } })
    await waitFor(() => expect(usersRequests().some((path) => path.includes('q=maria%40example.test'))).toBe(true))
  })

  it('pagina en el servidor y conserva la selección al cambiar de página', async () => {
    renderWizard()
    await screen.findByText('María Rodríguez')
    fireEvent.click(screen.getByRole('button', { name: /María Rodríguez/ }))
    expect(await screen.findByTestId('selected-worker')).toHaveTextContent('Recursos Humanos / Jefatura')

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await waitFor(() => expect(usersRequests().some((path) => path.includes('page=2'))).toBe(true))
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    await waitFor(() => expect(usersRequests().at(-1)).toContain('page=1'))
    expect(await screen.findByTestId('selected-worker')).toHaveTextContent('Recursos Humanos / Jefatura')
  })

  it('presenta estado vacío y error de búsqueda', async () => {
    renderWizard()
    await screen.findByText('María Rodríguez')
    const input = screen.getByLabelText('Buscar trabajadores')

    fireEvent.change(input, { target: { value: 'sin-resultados' } })
    expect(await screen.findByText('No hay trabajadores que coincidan con la búsqueda.')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'error' } })
    expect(await screen.findByText('búsqueda falló')).toBeInTheDocument()
  })

  it('mantiene el trabajador seleccionado al cambiar el término de búsqueda', async () => {
    renderWizard()
    await screen.findByText('María Rodríguez')
    fireEvent.click(screen.getByRole('button', { name: /María Rodríguez/ }))
    expect(await screen.findByTestId('selected-worker')).toHaveTextContent('Recursos Humanos / Jefatura')
    expect(api.get).toHaveBeenCalledWith(`/admin/users/${worker.id}/drive/connection`)

    fireEvent.change(screen.getByLabelText('Buscar trabajadores'), { target: { value: 'Juan' } })
    await waitFor(() => expect(usersRequests().some((path) => path.includes('q=Juan'))).toBe(true))
    expect(screen.getByTestId('selected-worker')).toHaveTextContent('Recursos Humanos / Jefatura')
  })

  it('una respuesta antigua no sobrescribe una búsqueda más reciente', async () => {
    const first = {}
    api.get.mockImplementation((path) => {
      const url = new URL(path, 'http://local')
      if (url.pathname === '/admin/users' && url.searchParams.get('q') === 'M') {
        return new Promise((resolve) => { first.resolve = resolve })
      }
      if (url.pathname === '/admin/users' && url.searchParams.get('q') === 'María') {
        return Promise.resolve({ data: [worker], pagination: { total: 1 } })
      }
      return defaultGet(path)
    })
    renderWizard()
    const input = screen.getByLabelText('Buscar trabajadores')
    fireEvent.change(input, { target: { value: 'M' } })
    await waitFor(() => expect(first.resolve).toBeTypeOf('function'))

    fireEvent.change(input, { target: { value: 'María' } })
    expect(await screen.findByText('María Rodríguez')).toBeInTheDocument()

    first.resolve({ data: [otherWorker], pagination: { total: 1 } })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByText('maria@example.test')).toBeInTheDocument()
    expect(screen.queryByText('juan@example.test')).not.toBeInTheDocument()
  })

  it('inicializa desde ?worker= aunque no esté en la primera página', async () => {
    const third = {
      ...otherWorker,
      id: '33333333-3333-4333-8333-333333333333',
      display_name: 'Trabajador Fuera de Página',
      email: 'fuera@example.test',
    }
    api.get.mockImplementation((path) => {
      if (path === `/admin/users/${third.id}`) return Promise.resolve({ user: third, organization_history: [] })
      if (path === `/admin/users/${third.id}/drive/connection`) return Promise.resolve({ connection, policy })
      if (path.startsWith('/admin/users?')) return Promise.resolve({ data: [worker], pagination: { total: 45 } })
      return defaultGet(path)
    })

    renderWizard(`/app/admin/downloads?worker=${third.id}`)
    expect(await screen.findByTestId('selected-worker')).toHaveTextContent('Trabajador Fuera de Página')
    expect(api.get).toHaveBeenCalledWith(`/admin/users/${third.id}`)
    expect(api.get).toHaveBeenCalledWith(`/admin/users/${third.id}/drive/connection`)
    expect(await screen.findByText('Conexión y política vigentes. Puede iniciar el snapshot.')).toBeInTheDocument()
  })

  it('cambiar de trabajador limpia archivos y carpetas seleccionados', async () => {
    renderWizard()
    await screen.findByText('María Rodríguez')
    fireEvent.click(screen.getByRole('button', { name: /María Rodríguez/ }))
    expect(await screen.findByTestId('selected-worker')).toHaveTextContent('Recursos Humanos / Jefatura')

    fireEvent.click(document.querySelector('input[value="selected_items"]'))
    fireEvent.click(screen.getByRole('button', { name: 'Añadir carpeta' }))
    expect(screen.getByTestId('picker-selection')).toHaveTextContent('1/0')

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(await screen.findByRole('button', { name: /Juan Pérez/ }))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(`/admin/users/${otherWorker.id}/drive/connection`))
    expect(screen.getByTestId('picker-selection')).toHaveTextContent('0/0')
  })

  it('no muestra cuentas administrativas ni resultados inactivos enviados por el backend', async () => {
    api.get.mockImplementation((path) => {
      const url = new URL(path, 'http://local')
      if (url.pathname === '/admin/users') {
        expect(url.searchParams.get('status')).toBe('active')
        return Promise.resolve({
          data: [worker],
          pagination: { total: 1 },
        })
      }
      return defaultGet(path)
    })
    renderWizard()
    const list = await screen.findByRole('list', { name: 'Resultados de trabajadores' })
    expect(within(list).getByText('María Rodríguez')).toBeInTheDocument()
    expect(within(list).queryByText('Ada Admin')).not.toBeInTheDocument()
  })
})
