export class ApiError extends Error {
  readonly status: number
  readonly queued: boolean
  readonly code?: string
  readonly retryAfter?: number

  constructor(status: number, message: string, queued = false, code?: string, retryAfter?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.queued = queued
    this.code = code
    if (retryAfter !== undefined) this.retryAfter = retryAfter
  }
}
