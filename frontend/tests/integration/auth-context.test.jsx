import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { AuthProvider, useAuth } from '../../src/app/AuthContext'
import { api } from '../../src/services/api'
import { meResponse } from '../fixtures/users'

vi.mock('../../src/services/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

function AuthProbe() {
  const auth = useAuth()
  if (auth.loading) return <p>cargando</p>
  if (!auth.user) {
    return (
      <div>
        <p>sin sesión</p>
        <p>{auth.error ? `error:${auth.error.message}` : 'sin error'}</p>
      </div>
    )
  }
  return (
    <div>
      <p>{auth.user.display_name}</p>
      <p>{auth.isAdmin ? 'admin' : 'worker'}</p>
      <p>{auth.isAdministrative ? 'administrativa' : 'no administrativa'}</p>
      <p>{auth.isWorker ? 'trabajador' : 'no trabajador'}</p>
      <p>{auth.hasLocalCredentials ? 'credenciales locales' : 'sin credenciales locales'}</p>
      <p>{auth.can('admin.dashboard.read') ? 'puede dashboard' : 'sin permiso'}</p>
      <p>{auth.error ? `error:${auth.error.message}` : 'sin error'}</p>
      <button type="button" onClick={auth.refresh}>refrescar</button>
      <button type="button" onClick={auth.logout}>salir</button>
    </div>
  )
}

describe('AuthProvider', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
  })

  it('carga la sesión, permisos y rol administrativo', async () => {
    api.get.mockResolvedValue(meResponse)
    render(<AuthProvider><AuthProbe /></AuthProvider>)
    expect(await screen.findByText('Ada Admin')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('administrativa')).toBeInTheDocument()
    expect(screen.getByText('no trabajador')).toBeInTheDocument()
    expect(screen.getByText('credenciales locales')).toBeInTheDocument()
    expect(screen.getByText('puede dashboard')).toBeInTheDocument()
  })

  it('cierra sesión y limpia el estado', async () => {
    api.get.mockResolvedValue(meResponse)
    api.post.mockResolvedValue({ status: 'logged_out' })
    render(<AuthProvider><AuthProbe /></AuthProvider>)
    await screen.findByText('Ada Admin')
    fireEvent.click(screen.getByText('salir'))
    await waitFor(() => expect(screen.getByText('sin sesión')).toBeInTheDocument())
    expect(api.post).toHaveBeenCalledWith('/auth/logout')
  })

  it('limpia la sesión ante 401', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('no'), { status: 401 }))
    render(<AuthProvider><AuthProbe /></AuthProvider>)
    expect(await screen.findByText('sin sesión')).toBeInTheDocument()
  })

  it('deduplica /auth/me bajo StrictMode y permite un refresh posterior', async () => {
    const pending = []
    api.get.mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    render(<StrictMode><AuthProvider><AuthProbe /></AuthProvider></StrictMode>)

    expect(api.get).toHaveBeenCalledTimes(1)
    expect(screen.getByText('cargando')).toBeInTheDocument()

    await act(async () => {
      pending[0](meResponse)
    })

    expect(await screen.findByText('Ada Admin')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('puede dashboard')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'refrescar' }))
    expect(api.get).toHaveBeenCalledTimes(2)

    await act(async () => {
      pending[1]({ ...meResponse, user: { ...meResponse.user } })
    })
    expect(screen.getByText('Ada Admin')).toBeInTheDocument()
  })

  it('mantiene 401 y 403 como sesión inexistente bajo StrictMode', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }))
    render(<StrictMode><AuthProvider><AuthProbe /></AuthProvider></StrictMode>)
    expect(await screen.findByText('sin sesión')).toBeInTheDocument()
    expect(screen.getByText('sin error')).toBeInTheDocument()
  })

  it('no convierte un error de servidor en una sesión válida', async () => {
    api.get.mockRejectedValue(new Error('servicio no disponible'))
    render(<StrictMode><AuthProvider><AuthProbe /></AuthProvider></StrictMode>)
    expect(await screen.findByText('sin sesión')).toBeInTheDocument()
    expect(screen.getByText('error:servicio no disponible')).toBeInTheDocument()
  })
})
