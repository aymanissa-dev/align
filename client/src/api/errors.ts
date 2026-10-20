export class ApiError extends Error {
  readonly status: number
  readonly queued: boolean
  readonly code?: string

  constructor(status: number, message: string, queued = false, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.queued = queued
    this.code = code
  }
}
