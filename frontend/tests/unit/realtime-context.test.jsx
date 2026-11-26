import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeProvider, useRealtimeChannel } from '../../src/features/realtime/RealtimeContext'

const auth = vi.hoisted(() => ({ user: { id: 'user-1' }, loading: false }))
vi.mock('../../src/app/AuthContext', () => ({ useAuth: () => auth }))

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
    this.closeCount = (this.closeCount || 0) + 1
    this.onclose?.()
  }

  error() {
    this.onerror?.()
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  message(value) {
    this.onmessage?.({ data: JSON.stringify(value) })
  }
}

function Probe({ onMessage, channel = 'job:job-1' }) {
  const status = useRealtimeChannel(channel, onMessage)
  return <span>{status}</span>
}

describe('RealtimeProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    auth.user = { id: 'user-1' }
    auth.loading = false
    globalThis.WebSocket = FakeWebSocket
  })

  it('enruta los mensajes de worker.dashboard al manejador del canal', () => {
    const onMessage = vi.fn()
    render(<RealtimeProvider><Probe channel="worker.dashboard" onMessage={onMessage} /></RealtimeProvider>)
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    expect(socket.sent).toContainEqual({ type: 'subscribe', channel: 'worker.dashboard', last_event_id: 0 })

    act(() => socket.message({
      type: 'worker.dashboard.metrics',
      data: { generated_at: '2026-11-16T10:00:00Z', summary: { active_jobs: 2 }, recent: [] },
    }))
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage.mock.calls[0][0].type).toBe('worker.dashboard.metrics')
  })

  it('mantiene una conexión, suscribe, descarta revisiones viejas y resuscribe al reconectar', () => {
    const onMessage = vi.fn()
    render(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)

    expect(FakeWebSocket.instances).toHaveLength(1)
    const first = FakeWebSocket.instances[0]
    expect(first.url).toMatch(/\/api\/v1\/realtime$/)
    act(() => first.open())
    expect(first.sent).toContainEqual({ type: 'subscribe', channel: 'job:job-1', last_event_id: 0 })
    expect(screen.getByText('connected')).toBeInTheDocument()

    act(() => first.message({ type: 'job.progress', revision: 5, event_id: 12, data: { job_id: 'job-1' } }))
    expect(onMessage).toHaveBeenCalledTimes(1)
    act(() => first.message({ type: 'job.progress', revision: 4, data: { job_id: 'job-1' } }))
    expect(onMessage).toHaveBeenCalledTimes(1)

    act(() => first.close())
    act(() => vi.advanceTimersByTime(5000))
    expect(FakeWebSocket.instances).toHaveLength(2)
    const second = FakeWebSocket.instances[1]
    act(() => second.open())
    expect(second.sent).toContainEqual({ type: 'subscribe', channel: 'job:job-1', last_event_id: 12 })
  })

  it('no duplica la conexión al rerenderizar con la misma sesión', () => {
    const onMessage = vi.fn()
    const { rerender } = render(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)
    act(() => FakeWebSocket.instances[0].open())

    rerender(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(screen.getByText('connected')).toBeInTheDocument()
  })

  it('refleja connecting y disconnected y limpia el temporizador al desmontar', () => {
    const onMessage = vi.fn()
    const { unmount } = render(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)
    expect(screen.getByText('connecting')).toBeInTheDocument()

    act(() => FakeWebSocket.instances[0].open())
    expect(screen.getByText('connected')).toBeInTheDocument()

    act(() => FakeWebSocket.instances[0].close())
    expect(screen.getByText('disconnected')).toBeInTheDocument()

    unmount()
    act(() => vi.advanceTimersByTime(60000))
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('cierra la conexión y no reconecta al cerrar sesión', () => {
    const onMessage = vi.fn()
    const { rerender } = render(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())

    auth.user = null
    rerender(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)

    expect(screen.getByText('idle')).toBeInTheDocument()
    expect(socket.readyState).toBe(3)
    act(() => vi.advanceTimersByTime(60000))
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('espera la restauración de autenticación antes de abrir el WebSocket', () => {
    auth.loading = true
    const onMessage = vi.fn()
    const { rerender } = render(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)

    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(screen.getByText('idle')).toBeInTheDocument()

    auth.loading = false
    rerender(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(screen.getByText('connecting')).toBeInTheDocument()
  })

  it('no reinicia la conexión si el usuario cambia de referencia con el mismo id', () => {
    const onMessage = vi.fn()
    const { rerender } = render(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    const sentBefore = socket.sent.length

    auth.user = { id: 'user-1', display_name: 'Mismo usuario' }
    rerender(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(socket.readyState).toBe(1)
    expect(socket.sent).toHaveLength(sentBefore)
    expect(screen.getByText('connected')).toBeInTheDocument()
  })

  it('cambia de conexión solo cuando cambia el id del usuario', () => {
    const onMessage = vi.fn()
    const { rerender } = render(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)
    const first = FakeWebSocket.instances[0]
    act(() => first.open())

    auth.user = { id: 'user-2' }
    rerender(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)

    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(first.readyState).toBe(3)
    expect(screen.getByText('connecting')).toBeInTheDocument()

    const second = FakeWebSocket.instances[1]
    act(() => second.open())
    expect(screen.getByText('connected')).toBeInTheDocument()
  })

  it('ignora onopen, onmessage y onclose de sockets obsoletos', () => {
    const onMessage = vi.fn()
    const { rerender } = render(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)
    const first = FakeWebSocket.instances[0]
    act(() => first.open())

    auth.user = { id: 'user-2' }
    rerender(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)
    const second = FakeWebSocket.instances[1]

    act(() => {
      first.onopen?.()
      first.onmessage?.({ data: JSON.stringify({ type: 'job.progress', revision: 99, data: { job_id: 'job-1' } }) })
      first.onclose?.()
    })

    expect(onMessage).not.toHaveBeenCalled()
    expect(screen.getByText('connecting')).toBeInTheDocument()
    expect(FakeWebSocket.instances).toHaveLength(2)

    act(() => vi.advanceTimersByTime(12000))
    expect(FakeWebSocket.instances).toHaveLength(2)

    act(() => second.open())
    expect(screen.getByText('connected')).toBeInTheDocument()
  })

  it('centraliza el error vigente en un único cierre y una única reconexión', () => {
    const onMessage = vi.fn()
    render(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)
    const first = FakeWebSocket.instances[0]
    act(() => first.open())

    act(() => first.error())

    expect(first.closeCount).toBe(1)
    expect(screen.getByText('disconnected')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(5000))
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('envía unsubscribe al desmontar el último manejador del canal', () => {
    const onMessage = vi.fn()
    const { rerender } = render(<RealtimeProvider><Probe onMessage={onMessage} /></RealtimeProvider>)
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    expect(socket.sent).toContainEqual({ type: 'subscribe', channel: 'job:job-1', last_event_id: 0 })

    rerender(<RealtimeProvider><Probe channel={null} onMessage={onMessage} /></RealtimeProvider>)

    expect(socket.sent.at(-1)).toEqual({ type: 'unsubscribe', channel: 'job:job-1' })
  })
})
