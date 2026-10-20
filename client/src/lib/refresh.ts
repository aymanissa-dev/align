import { csrfHeaders } from './csrf.ts'

let inflight: Promise<boolean> | null = null

/** One silent refresh at a time. Parallel 401s share the same cookie rotation. */
export function refreshSession(): Promise<boolean> {
  inflight ??= fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json', ...csrfHeaders() },
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      inflight = null
    })
  return inflight
}
