import { useIsRestoring } from '@tanstack/react-query'
import { ApiError } from '../api/errors.ts'
import { isUnreachable } from './offline.ts'

type MissQuery = {
  data: unknown
  isLoading: boolean
  isPaused: boolean
  isError: boolean
  error: unknown
}

/** A failed fetch with nothing cached. A 504 from an older worker counts too. */
export function isOfflineMiss(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 404) return false
  if (isUnreachable()) return true
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return error instanceof ApiError && (error.status === 0 || error.status === 504)
}

export function useQueryMiss(query: MissQuery): 'loading' | 'offline' | 'error' | null {
  const restoring = useIsRestoring()
  if (query.data != null) return null
  // Restoring reads the per-user cache. navigator.onLine is not a reason to
  // show the offline empty state before that cache has been applied.
  if (restoring) return 'loading'
  // A paused query has no error yet. onlineManager is offline, so this page
  // will not load until the probe marks the server reachable.
  if (query.isPaused || isOfflineMiss(query.error)) return 'offline'
  if (query.isLoading || !query.isError) return 'loading'
  return 'error'
}
