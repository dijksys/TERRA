import { act, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../../src/app/AuthContext'
import { RealtimeProvider, useRealtime, useRealtimeChannel } from '../../src/features/realtime/RealtimeContext'
import { api } from '../../src/services/api'
import { meResponse } from '../fixtures/users'

vi.mock('../../src/services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

class FakeWebSocket {
  static OPEN = 1
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    FakeWebSocket.instances.push(this)
  }

  send(raw) {
    this.sent.push(JSON.parse(raw))
  }

  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.onclose?.()
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  message(value) {
    this.onmessage?.({ data: JSON.stringify(value) })
  }
}

function AppProbe() {
  const { user, loading, logout, refresh } = useAuth()
  const { status } = useRealtime()
  useRealtimeChannel('job:job-1', () => {})
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.id || 'none'}</span>
      <span data-testid="status">{status}</span>
      <button type="button" onClick={refresh}>refrescar</button>
      <button type="button" onClick={logout}>salir</button>
    </div>
  )
}

function renderTree() {
  return render(
    <StrictMode>
      <AuthProvider>
        <RealtimeProvider>
          <AppProbe />
        </RealtimeProvider>
      </AuthProvider>
    </StrictMode>,
  )
}

describe('restauración de AuthProvider y RealtimeProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    globalThis.WebSocket = FakeWebSocket
    api.get.mockReset()
    api.post.mockReset()
  })

  it('deduplica la sesión, abre un socket y lo cierra al salir', async () => {
    const pending = []
    api.get.mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    api.post.mockResolvedValue({ status: 'logged_out' })
    renderTree()

    expect(api.get).toHaveBeenCalledTimes(1)
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(screen.getByTestId('loading')).toHaveTextContent('true')
    expect(screen.getByTestId('status')).toHaveTextContent('idle')

    await act(async () => {
      pending[0](meResponse)
    })
    expect(screen.getByTestId('user')).toHaveTextContent(meResponse.user.id)
    expect(FakeWebSocket.instances).toHaveLength(1)

    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    expect(screen.getByTestId('status')).toHaveTextContent('connected')
    const subscriptions = socket.sent.filter((message) => message.type === 'subscribe')
    expect(subscriptions).toEqual([{ type: 'subscribe', channel: 'job:job-1', last_event_id: 0 }])

    act(() => socket.message({ type: 'connection.ready' }))
    expect(screen.getByTestId('status')).toHaveTextContent('connected')

    fireEvent.click(screen.getByRole('button', { name: 'refrescar' }))
    expect(api.get).toHaveBeenCalledTimes(2)
    await act(async () => {
      pending[1]({ ...meResponse, user: { ...meResponse.user } })
    })

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(socket.readyState).toBe(1)
    expect(socket.sent.filter((message) => message.type === 'subscribe')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'salir' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(screen.getByTestId('status')).toHaveTextContent('idle')
    expect(socket.readyState).toBe(3)

    act(() => vi.advanceTimersByTime(60000))
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
