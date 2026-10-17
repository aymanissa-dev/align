import { useEffect, useMemo, type ReactNode } from 'react'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import type { Query } from '@tanstack/react-query'
import { queryClient } from '../queryClient.ts'

const MAX_AGE_MS = 24 * 60 * 60 * 1000
const RECENT_LIMIT = 8

let clearUserId: string | null = null

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
  if (query.state.status !== 'success') return false
  const [head, id] = query.queryKey
  if (head === 'projects' || head === 'today') return true
  if ((head === 'tasks' || head === 'project') && typeof id === 'string') {
    return readRecent(userId).includes(id)
  }
  return false
}

/** Drop this user's saved lists. Call before the persist provider unmounts on logout. */
export function clearPersistedCache(userId: string) {
  clearUserId = userId
  try {
    localStorage.removeItem(cacheKey(userId))
    localStorage.removeItem(recentKey(userId))
  } catch {
    // The unmount cleanup retries the removal.
  }
}

export function QueryCache({ userId, children }: { userId: string; children: ReactNode }) {
  const persister = useMemo(
    () =>
      createSyncStoragePersister({
        storage: window.localStorage,
        key: cacheKey(userId),
        throttleTime: 1000,
      }),
    [userId],
  )
  const persistOptions = useMemo(
    () => ({
      persister,
      maxAge: MAX_AGE_MS,
      buster: userId,
      dehydrateOptions: {
        shouldDehydrateQuery: (query: Query) => shouldPersistQuery(query, userId),
      },
    }),
    [persister, userId],
  )

  useEffect(() => {
    return () => {
      if (clearUserId !== userId) return
      clearUserId = null
      try {
        localStorage.removeItem(cacheKey(userId))
        localStorage.removeItem(recentKey(userId))
      } catch {
        // Already gone.
      }
    }
  }, [userId])

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  )
}
