export class ApiError extends Error {
  readonly status: number
  readonly queued: boolean

  constructor(status: number, message: string, queued = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.queued = queued
  }
}
