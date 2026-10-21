import { ApiError } from '../api/errors.ts'

export function stepUpRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'step_up_required'
}
