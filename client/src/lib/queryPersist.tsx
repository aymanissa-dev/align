import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { dehydrate, IsRestoringProvider } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { persistQueryClient } from '@tanstack/query-persist-client-core'
import type { Query } from '@tanstack/react-query'
import { queryClient } from '../queryClient.ts'

const MAX_AGE_MS = 24 * 60 * 60 * 1000
const RECENT_LIMIT = 8

let clearUserId: string | null = null
let activeUserId: string | null = null
const sealed = new Set<string>()

/** A new sign-in may persist again. A delayed logout wipe no-ops after this. */
export function allowPersistedCache(userId: string): void {
  sealed.delete(userId)
}

function recentKey(userId: string) {
  return `align-recent-projects:${userId}`
}

function cacheKey(userId: string) {
  return `align-rq:${userId}`
}

function readRecent(userId: string): string[] {
  try {
    const raw = localStorage.getItem(recentKey(userId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

export function rememberProject(userId: string, projectId: string) {
  if (!userId || !projectId) return
  const ids = [projectId, ...readRecent(userId).filter((id) => id !== projectId)].slice(0, RECENT_LIMIT)
  try {
    localStorage.setItem(recentKey(userId), JSON.stringify(ids))
  } catch {
    // A full disk skips the recent list. The in-memory cache still renders.
  }
}

function shouldPersistQuery(query: Query, userId: string): boolean {
  if (sealed.has(userId)) return false
  // A failed refetch keeps the last payload. Dropping it here is how a reload
  // offline loses /trash after the request errors.
  if (query.state.data === undefined) return false
  const [head, id] = query.queryKey
  // Dashboard and trash are visited shells. Keep them with the other lists so
  // a reload offline restores what the user already loaded.
  if (head === 'projects' || head === 'today' || head === 'labels' || head === 'dashboard' || head === 'trash') return true
  if ((head === 'tasks' || head === 'project') && typeof id === 'string') {
    return readRecent(userId).includes(id)
  }
  return false
}

function removePersisted(userId: string) {
  try {
    localStorage.removeItem(cacheKey(userId))
    localStorage.removeItem(recentKey(userId))
  } catch {
    // The unmount cleanup retries the removal.
  }
}

/** Drop this user's saved lists. Call before the persist provider unmounts on logout. */
export function clearPersistedCache(userId: string) {
  sealed.add(userId)
  clearUserId = userId
  if (activeUserId === userId) activeUserId = null
  removePersisted(userId)
  // The persister throttles writes for a second. Seal rejects them, and this
  // removes anything that landed in the same moment as sign-out.
  window.setTimeout(() => {
    if (!sealed.has(userId)) return
    removePersisted(userId)
  }, 1500)
}

function persistedSnapshot(userId: string) {
  return {
    buster: userId,
    timestamp: Date.now(),
    clientState: dehydrate(queryClient, {
      shouldDehydrateQuery: (query) => shouldPersistQuery(query, userId),
    }),
  }
}

/**
 * Write the per-user cache now. The sync persister waits up to a second, so a
 * reload in that window would restore the previous trash list.
 */
export function flushPersistedCache(): void {
  const userId = activeUserId
  if (!userId || sealed.has(userId)) return
  try {
    window.localStorage.setItem(cacheKey(userId), JSON.stringify(persistedSnapshot(userId)))
  } catch {
    // A full disk keeps the in-memory list for this tab.
  }
}

function keepNewerWrite(key: string, value: string): void {
  try {
    const next = JSON.parse(value) as { timestamp?: number }
    const current = window.localStorage.getItem(key)
    if (current && typeof next.timestamp === 'number') {
      const previous = JSON.parse(current) as { timestamp?: number }
      if (typeof previous.timestamp === 'number' && next.timestamp < previous.timestamp) return
    }
  } catch {
    // A malformed snapshot is replaced by the incoming write.
  }
  window.localStorage.setItem(key, value)
}

export function QueryCache({ userId, children }: { userId: string | null; children: ReactNode }) {
  const persister = useMemo(
    () =>
      userId
        ? createSyncStoragePersister({
            storage: {
              getItem: (key) => window.localStorage.getItem(key),
              setItem: (key, value) => {
                if (sealed.has(userId)) return
                keepNewerWrite(key, value)
              },
              removeItem: (key) => window.localStorage.removeItem(key),
            },
            key: cacheKey(userId),
            throttleTime: 1000,
          })
        : null,
    [userId],
  )

  const [isRestoring, setIsRestoring] = useState(false)
  const [restoringFor, setRestoringFor] = useState<string | null>(null)
  if (userId !== restoringFor) {
    setRestoringFor(userId)
    const next = Boolean(userId) && queryClient.getQueryData(['dashboard']) === undefined
    if (next !== isRestoring) setIsRestoring(next)
  }

  useEffect(() => {
    if (!userId || !persister) {
      activeUserId = null
      return
    }
    activeUserId = userId
    let cancelled = false
    const [unsubscribe, restored] = persistQueryClient({
      queryClient,
      persister,
      maxAge: MAX_AGE_MS,
      buster: userId,
      dehydrateOptions: {
        shouldDehydrateQuery: (query: Query) => shouldPersistQuery(query, userId),
      },
    })
    void restored.then(() => {
      if (!cancelled) setIsRestoring(false)
    })
    const flush = () => flushPersistedCache()
    window.addEventListener('pagehide', flush)
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      cancelled = true
      unsubscribe()
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
      if (clearUserId !== userId) return
      clearUserId = null
      removePersisted(userId)
    }
  }, [persister, userId])

  return <IsRestoringProvider value={isRestoring}>{children}</IsRestoringProvider>
}
