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
  if (restoring || query.isLoading || !query.isError) return 'loading'
  if (query.isPaused || isOfflineMiss(query.error)) return 'offline'
  return 'error'
}
