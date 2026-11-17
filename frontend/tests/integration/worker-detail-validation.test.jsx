import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkerDetailPage from '../../src/pages/admin/WorkerDetailPage'
import { api } from '../../src/services/api'

const auth = vi.hoisted(() => ({ can: vi.fn(() => true) }))
vi.mock('../../src/app/AuthContext', () => ({
  useAuth: () => ({ can: auth.can }),
}))

vi.mock('../../src/services/api', () => ({
  api: { get: vi.fn(), patch: vi.fn() },
}))

const worker = {
  id: 'worker-1',
  first_name: 'María',
  last_name: 'Fernanda',
  display_name: 'María Fernanda',
  email: 'maria@example.test',
  status: 'active',
  roles: ['user'],
  area_id: 'area-1',
  area_name: 'Sistemas',
  position_id: 'pos-1',
  position_name: 'Analista',
  created_at: '2026-01-01T00:00:00Z',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/app/admin/workers/worker-1']}>
      <Routes>
        <Route path="/app/admin/workers/:id" element={<WorkerDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('WorkerDetailPage', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.patch.mockReset()
    auth.can.mockReset()
    auth.can.mockReturnValue(true)
    api.get.mockImplementation((path) => {
      if (path === '/admin/users/worker-1') {
        return Promise.resolve({ user: worker, drive_connection: null, organization_history: [] })
      }
      if (path === '/admin/areas') return Promise.resolve({ data: [{ id: 'area-1', name: 'Sistemas', status: 'active' }] })
      if (path === '/admin/areas/area-1/positions') {
        return Promise.resolve({ data: [{ id: 'pos-1', name: 'Analista', status: 'active' }] })
      }
      return Promise.reject(new Error(`ruta inesperada ${path}`))
    })
  })

  it('presenta el historial como línea de tiempo con antes, después, actor y fecha', async () => {
    api.get.mockImplementation((path) => {
      if (path === '/admin/users/worker-1') {
        return Promise.resolve({
          user: worker,
          drive_connection: null,
          organization_history: [
            {
              id: 2, area_name: 'Recursos Humanos', position_name: 'Jefatura',
              previous_area_name: 'Sistemas', previous_position_name: 'Analista',
              actor_name: 'Ada Admin', created_at: '2026-11-10T15:30:00Z',
            },
            {
              id: 1, area_name: 'Sistemas', position_name: 'Analista',
              previous_area_name: '', previous_position_name: '',
              actor_name: 'Sistema', created_at: '2026-01-01T10:00:00Z',
            },
          ],
        })
      }
      if (path === '/admin/areas') return Promise.resolve({ data: [{ id: 'area-1', name: 'Sistemas', status: 'active' }] })
      if (path === '/admin/areas/area-1/positions') {
        return Promise.resolve({ data: [{ id: 'pos-1', name: 'Analista', status: 'active' }] })
      }
      return Promise.reject(new Error(`ruta inesperada ${path}`))
    })
    renderPage()
    await screen.findByRole('heading', { name: 'María Fernanda' })

    expect(screen.getByText('Recursos Humanos / Jefatura')).toBeInTheDocument()
    expect(screen.getAllByText('Sistemas / Analista')).toHaveLength(2)
    expect(screen.getByText('Ada Admin')).toBeInTheDocument()
    expect(screen.getByText('Sistema')).toBeInTheDocument()
    expect(screen.getAllByText('Antes')).toHaveLength(2)
    expect(screen.getAllByText('Después')).toHaveLength(2)
  })

  it('solo lectura consulta el historial sin formulario de escritura', async () => {
    auth.can.mockImplementation((permission) => permission !== 'admin.users.write')
    api.get.mockImplementation((path) => {
      if (path === '/admin/users/worker-1') {
        return Promise.resolve({
          user: worker,
          drive_connection: null,
          organization_history: [{
            id: 1, area_name: 'Sistemas', position_name: 'Analista',
            previous_area_name: 'Recursos Humanos', previous_position_name: 'Jefatura',
            actor_name: 'Ada Admin', created_at: '2026-11-10T15:30:00Z',
          }],
        })
      }
      if (path === '/admin/areas') return Promise.resolve({ data: [] })
      if (path === '/admin/areas/area-1/positions') return Promise.resolve({ data: [] })
      return Promise.reject(new Error(`ruta inesperada ${path}`))
    })
    renderPage()
    await screen.findByRole('heading', { name: 'María Fernanda' })

    expect(screen.queryByRole('button', { name: /Guardar cambios/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Su rol permite consultar este trabajador/)).toBeInTheDocument()
    expect(screen.getByText('Recursos Humanos / Jefatura')).toBeInTheDocument()
    expect(screen.getByText('Sistemas / Analista')).toBeInTheDocument()
  })

  it('muestra los errores del servidor junto a la asignación y conserva el formulario', async () => {
    api.patch.mockRejectedValue({
      message: 'Revise los datos del trabajador.',
      fields: {
        area_id: 'Seleccione un área activa.',
        status: 'Asigne área y cargo antes de activar.',
      },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'María Fernanda' })

    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/i }))

    expect(await screen.findByText('Seleccione un área activa.')).toBeInTheDocument()
    expect(screen.getByText('Asigne área y cargo antes de activar.')).toBeInTheDocument()
    expect(screen.getByLabelText('Área')).toHaveTextContent('Sistemas')
    expect(screen.getByLabelText('Estado de la cuenta')).toHaveTextContent('Activo')
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/users/worker-1', {
      area_id: 'area-1',
      position_id: 'pos-1',
      status: 'active',
    }))
  })
})
