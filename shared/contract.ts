/** GET /api/health */
export type HealthReport = {
  ok: boolean
  db: 'up' | 'down'
  latencyMs: number
  migration?: { id: string; counts: Record<string, number> }
}

/** PATCH lost the race with another writer. */
export const CONFLICT_MESSAGE = 'This was changed elsewhere.'
