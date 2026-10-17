import { useEffect, useMemo, type ReactNode } from 'react'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import type { Query } from '@tanstack/react-query'
import { queryClient } from '../queryClient.ts'

const MAX_AGE_MS = 24 * 60 * 60 * 1000
const RECENT_LIMIT = 8

let clearUserId: string | null = null
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
  if (query.state.status !== 'success') return false
  const [head, id] = query.queryKey
  if (head === 'projects' || head === 'today' || head === 'labels') return true
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
  removePersisted(userId)
  // The persister throttles writes for a second. Seal rejects them, and this
  // removes anything that landed in the same moment as sign-out.
  window.setTimeout(() => {
    if (!sealed.has(userId)) return
    removePersisted(userId)
  }, 1500)
}

export function QueryCache({ userId, children }: { userId: string; children: ReactNode }) {
  const persister = useMemo(
    () =>
      createSyncStoragePersister({
        storage: {
          getItem: (key) => window.localStorage.getItem(key),
          setItem: (key, value) => {
            if (sealed.has(userId)) return
            window.localStorage.setItem(key, value)
          },
          removeItem: (key) => window.localStorage.removeItem(key),
        },
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
      removePersisted(userId)
    }
  }, [userId])

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  )
}
