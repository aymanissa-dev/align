import { useEffect, useState } from 'react'
import {
  flushOfflineQueue,
  isUnreachable,
  queuedCount,
  queueFailure,
  QUEUE_EVENT,
  REACH_EVENT,
} from '../lib/offline.ts'
import { queryClient } from '../queryClient.ts'
import { useToast } from './toast-context.ts'

const RETRY_MS = 4000

export function OfflineBanner() {
  const toast = useToast()
  const [offline, setOffline] = useState(() => isUnreachable())
  const [queued, setQueued] = useState(() => queuedCount())
  const [flushing, setFlushing] = useState(false)
  const [problem, setProblem] = useState<string | null>(() => queueFailure())

  useEffect(() => {
    let stopped = false
    let running = false

    const refresh = () => {
      setOffline(isUnreachable())
      setQueued(queuedCount())
      setProblem(queueFailure())
    }

    const run = () => {
      if (stopped || running) return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      if (queuedCount() === 0) return
      running = true
      setFlushing(true)
      void flushOfflineQueue()
        .then((result) => {
          if (stopped) return
          refresh()
          if (result.synced > 0) {
            toast(result.synced === 1 ? 'Synced 1 saved change.' : `Synced ${result.synced} saved changes.`)
            void queryClient.invalidateQueries()
          }
          for (const message of result.rejected) toast(message)
        })
        .finally(() => {
          running = false
          if (!stopped) {
            setFlushing(false)
            refresh()
          }
        })
    }

    const onOffline = () => {
      setOffline(true)
    }
    const onOnline = () => {
      setOffline(isUnreachable())
      run()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }

    refresh()
    run()
    const timer = window.setInterval(run, RETRY_MS)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    window.addEventListener(QUEUE_EVENT, refresh)
    window.addEventListener(REACH_EVENT, refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      window.removeEventListener(QUEUE_EVENT, refresh)
      window.removeEventListener(REACH_EVENT, refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [toast])

  if (!offline && queued === 0) return null

  const message = offline
    ? queued > 0
      ? `Offline, ${queued} ${queued === 1 ? 'change' : 'changes'} queued`
      : 'You’re offline.'
    : flushing
      ? `Syncing ${queued} saved ${queued === 1 ? 'change' : 'changes'}…`
      : `Couldn’t sync ${queued} ${queued === 1 ? 'change' : 'changes'}. Will retry.`

  return (
    <div role="status" className="border-b border-neutral-950 bg-neutral-950 px-4 py-2 text-center text-sm text-white">
      <p>{message}</p>
      {problem && !flushing ? <p className="mt-1 text-xs text-white opacity-80">{problem}</p> : null}
    </div>
  )
}
