/** GET /api/health */
export type HealthReport = {
  ok: boolean
  db: 'up' | 'down'
  latencyMs: number
}
