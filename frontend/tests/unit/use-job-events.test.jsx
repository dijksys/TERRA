import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useJobEvents } from '../../src/features/downloads/useJobEvents'
import { useRealtimeChannel } from '../../src/features/realtime/RealtimeContext'

vi.mock('../../src/features/realtime/RealtimeContext', () => ({
  useRealtimeChannel: vi.fn(() => 'connected'),
}))

describe('useJobEvents', () => {
  it('se suscribe al canal del trabajo y entrega el snapshot persistido', () => {
    const onSnapshot = vi.fn()
    const { result } = renderHook(() => useJobEvents('job-1', onSnapshot))
    expect(result.current).toBe(true)
    expect(useRealtimeChannel).toHaveBeenCalledWith('job:job-1', expect.any(Function))
    const handler = useRealtimeChannel.mock.calls[0][1]

    handler({
      type: 'job.snapshot',
      revision: 4,
      data: { job: { id: 'job-1', status: 'downloading' }, progress: { byte_progress_percent: 30 } },
    })
    expect(onSnapshot).toHaveBeenCalledWith({
      id: 'job-1',
      status: 'downloading',
      progress: { byte_progress_percent: 30 },
      progress_revision: 4,
    })

    handler({
      type: 'job.progress',
      revision: 5,
      data: { job_id: 'job-1', progress: { byte_progress_percent: 42 } },
    })
    expect(onSnapshot).toHaveBeenLastCalledWith({
      progress: { byte_progress_percent: 42 },
      progress_revision: 5,
    })
  })

  it('no abre canal sin trabajo', () => {
    const onSnapshot = vi.fn()
    renderHook(() => useJobEvents(null, onSnapshot))
    expect(useRealtimeChannel).toHaveBeenLastCalledWith(null, expect.any(Function))
  })

  it.each([
    'job.item.started',
    'job.item.completed',
    'job.item.skipped',
    'job.item.failed',
    'job.item.retrying',
  ])('entrega %s al callback de elementos sin inventar snapshots', (type) => {
    const onSnapshot = vi.fn()
    const onItemEvent = vi.fn()
    renderHook(() => useJobEvents('job-1', onSnapshot, onItemEvent))
    const handler = useRealtimeChannel.mock.calls.at(-1)[1]
    const message = {
      type,
      revision: 8,
      event_id: 21,
      data: { job_id: 'job-1', payload: { item_id: 'item-1', name: 'archivo.pdf' }, progress: { completed_items: 1 } },
    }

    handler(message)

    expect(onItemEvent).toHaveBeenCalledWith(message)
    expect(onSnapshot).not.toHaveBeenCalled()
  })

  it('entrega job.done a ambos callbacks y conserva el payload', () => {
    const onSnapshot = vi.fn()
    const onItemEvent = vi.fn()
    renderHook(() => useJobEvents('job-1', onSnapshot, onItemEvent))
    const handler = useRealtimeChannel.mock.calls.at(-1)[1]
    const message = {
      type: 'job.done',
      revision: 9,
      event_id: 22,
      data: { job_id: 'job-1', payload: { status: 'completed', completed_items: 4 }, progress: { status: 'completed' } },
    }

    handler(message)

    expect(onSnapshot).toHaveBeenCalledWith({
      status: 'completed', completed_items: 4, progress: { status: 'completed' }, progress_revision: 9,
    })
    expect(onItemEvent).toHaveBeenCalledWith(message)
  })

  it('ignora revisiones antiguas para no sobrescribir estado más reciente', () => {
    const onSnapshot = vi.fn()
    const onItemEvent = vi.fn()
    renderHook(() => useJobEvents('job-1', onSnapshot, onItemEvent))
    const handler = useRealtimeChannel.mock.calls.at(-1)[1]

    handler({ type: 'job.progress', revision: 10, data: { progress: { completed_items: 5 } } })
    handler({ type: 'job.item.started', revision: 9, event_id: 3, data: { payload: { item_id: 'old' } } })
    handler({ type: 'job.item.started', revision: 10, event_id: 4, data: { payload: { item_id: 'same' } } })

    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(onItemEvent).toHaveBeenCalledTimes(1)
    expect(onItemEvent.mock.calls[0][0].data.payload.item_id).toBe('same')
  })

  it('ignora eventos desconocidos y callbacks opcionales', () => {
    const onSnapshot = vi.fn()
    const onItemEvent = vi.fn()
    renderHook(() => useJobEvents('job-1', onSnapshot, onItemEvent))
    const handler = useRealtimeChannel.mock.calls.at(-1)[1]

    handler({ type: 'realtime.error', revision: 1, data: { message: 'x' } })
    expect(onSnapshot).not.toHaveBeenCalled()
    expect(onItemEvent).not.toHaveBeenCalled()

    expect(() => handler({ type: 'job.item.started', revision: 2, data: {} })).not.toThrow()
    renderHook(() => useJobEvents('job-2'))
    expect(() => useRealtimeChannel.mock.calls.at(-1)[1]({ type: 'job.snapshot', revision: 1, data: {} })).not.toThrow()
  })
})
