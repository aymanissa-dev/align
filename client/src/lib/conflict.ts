import { CONFLICT_MESSAGE } from '../../../shared/contract.ts'
import { ApiError } from '../api/errors.ts'

export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.message === CONFLICT_MESSAGE
}
