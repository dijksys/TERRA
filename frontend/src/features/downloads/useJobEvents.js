import { useCallback, useRef } from 'react'
import { useRealtimeChannel } from '../realtime/RealtimeContext'

const ITEM_TRANSITIONS = new Set([
  'job.item.started',
  'job.item.completed',
  'job.item.skipped',
  'job.item.failed',
  'job.item.retrying',
])

// Mantiene el detalle del trabajo suscrito al canal central de WebSockets.
// PostgreSQL sigue siendo la fuente de verdad y el snapshot permite reconectar.
export function useJobEvents(jobId, onSnapshot, onItemEvent) {
  const lastRevision = useRef(0)

  const handleMessage = useCallback((message) => {
    const data = message.data || {}
    const revision = Number(message.revision || 0)
    if (revision > 0 && revision < lastRevision.current) return
    if (revision > 0) lastRevision.current = revision

    if (message.type === 'job.snapshot') {
      onSnapshot?.({ ...(data.job || {}), progress: data.progress, progress_revision: revision })
      return
    }
    if (message.type === 'job.progress') {
      onSnapshot?.({ progress: data.progress, progress_revision: revision })
      return
    }
    if (message.type === 'job.done') {
      onSnapshot?.({ ...(data.payload || {}), progress: data.progress, progress_revision: revision })
      onItemEvent?.(message)
      return
    }
    if (ITEM_TRANSITIONS.has(message.type)) {
      onItemEvent?.(message)
      return
    }
    if (message.type === 'job.stage') {
      onItemEvent?.(message)
    }
  }, [onSnapshot, onItemEvent])

  const status = useRealtimeChannel(jobId ? `job:${jobId}` : null, handleMessage)
  return status === 'connected'
}
