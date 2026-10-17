import { useEffect, useState } from 'react'
import { useToast } from './toast-context.ts'
import {
  FLUSH_EVENT,
  isUnreachable,
  queuedCount,
  queueFailure,
  QUEUE_EVENT,
  REACH_EVENT,
  startOfflineSync,
  type FlushResult,
} from '../lib/offline.ts'

export function ConnectionStatus() {
  const toast = useToast()
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [unreachable, setUnreachable] = useState(() => isUnreachable())
  const [queued, setQueued] = useState(() => queuedCount())
  const [flushing, setFlushing] = useState(false)
  const [problem, setProblem] = useState<string | null>(() => queueFailure())

  useEffect(() => {
    const refresh = () => {
      setOffline(typeof navigator !== 'undefined' && navigator.onLine === false)
      setUnreachable(isUnreachable())
      setQueued(queuedCount())
      setProblem(queueFailure())
    }
    const onFlush = (event: Event) => {
      const detail = (event as CustomEvent<{ phase: 'start' | 'end'; result?: FlushResult }>).detail
      if (!detail) return
      if (detail.phase === 'start') {
        setFlushing(true)
        return
      }
      setFlushing(false)
      refresh()
      const result = detail.result
      if (!result) return
      if (result.synced > 0) {
        toast(result.synced === 1 ? 'Synced 1 saved change.' : `Synced ${result.synced} saved changes.`)
      }
      for (const message of result.rejected) toast(message)
    }

    startOfflineSync()
    refresh()
    window.addEventListener('offline', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener(QUEUE_EVENT, refresh)
    window.addEventListener(REACH_EVENT, refresh)
    window.addEventListener(FLUSH_EVENT, onFlush)
    return () => {
      window.removeEventListener('offline', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener(QUEUE_EVENT, refresh)
      window.removeEventListener(REACH_EVENT, refresh)
      window.removeEventListener(FLUSH_EVENT, onFlush)
    }
  }, [toast])

  if (!offline && !unreachable && queued === 0) return null

  const headline = offline
    ? "You're offline."
    : unreachable
      ? "Can't reach the server."
      : flushing
        ? 'Syncing saved changes.'
        : 'Saved changes will retry.'
  const detail =
    queued > 0 ? `${queued} ${queued === 1 ? 'change' : 'changes'} queued` : null

  return (
    <div role="status" className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-950 bg-neutral-950 px-4 py-2 text-center text-white">
      <p className="font-pixel text-[11px] tracking-[0.16em] uppercase">{headline}</p>
      {detail ? <p className="mt-1 text-xs text-white">{detail}</p> : null}
      {problem && !flushing ? <p className="mt-1 text-xs text-white opacity-80">{problem}</p> : null}
    </div>
  )
}
