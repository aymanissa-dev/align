import { useEffect, useState } from 'react'
import { flushOfflineQueue, queuedCount, QUEUE_EVENT } from '../lib/offline.ts'
import { queryClient } from '../queryClient.ts'
import { useToast } from './toast-context.ts'

export function OfflineBanner() {
  const toast = useToast()
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [queued, setQueued] = useState(() => queuedCount())

  useEffect(() => {
    const syncCount = () => setQueued(queuedCount())
    const onOffline = () => setOffline(true)
    const onOnline = () => {
      setOffline(false)
      void flushOfflineQueue().then((synced) => {
        syncCount()
        if (synced > 0) {
          toast(synced === 1 ? 'Synced 1 saved change.' : `Synced ${synced} saved changes.`)
          void queryClient.invalidateQueries()
        }
      })
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    window.addEventListener(QUEUE_EVENT, syncCount)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      window.removeEventListener(QUEUE_EVENT, syncCount)
    }
  }, [toast])

  if (!offline && queued === 0) return null

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[80] border-b border-neutral-950 bg-neutral-950 px-4 py-2 text-center text-sm text-white"
    >
      {offline
        ? queued > 0
          ? `You’re offline. ${queued} ${queued === 1 ? 'change is' : 'changes are'} saved on this device and will sync when you reconnect.`
          : 'You’re offline. Changes you make are saved on this device and sync when you reconnect.'
        : `Syncing ${queued} saved ${queued === 1 ? 'change' : 'changes'}…`}
    </div>
  )
}
