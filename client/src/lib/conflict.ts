import { CONFLICT_MESSAGE } from '../../../shared/contract.ts'
import { ApiError } from '../api/errors.ts'

export function isConflict(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.status === 412) return true
  return error.status === 409 && error.message === CONFLICT_MESSAGE
}
