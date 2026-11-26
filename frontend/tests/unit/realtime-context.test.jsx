import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeProvider, useRealtimeChannel } from '../../src/features/realtime/RealtimeContext'

const auth = vi.hoisted(() => ({ user: { id: 'user-1' } }))
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

function Probe({ onMessage, channel = 'job:job-1' }) {
  const status = useRealtimeChannel(channel, onMessage)
  return <span>{status}</span>
}

describe('RealtimeProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    auth.user = { id: 'user-1' }
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
})
