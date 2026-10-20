export class HttpError extends Error {
  readonly status: number
  readonly headers: Record<string, string>
  readonly code?: string

  constructor(
    status: number,
    message: string,
    options?: { headers?: Record<string, string>; code?: string },
  ) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.headers = options?.headers ?? {}
    this.code = options?.code
  }
}

export function unavailable(message = 'The database is unavailable. Try again shortly.'): HttpError {
  return new HttpError(503, message, { headers: { 'Retry-After': '5' } })
}
