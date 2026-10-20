import { createHash } from 'node:crypto'
import { recordSecurity } from './data/securityLog.ts'
import { HttpError } from './errors.ts'
import { SecurityEvent } from './models.ts'

const RANGE = 'https://api.pwnedpasswords.com/range/'
export const HIBP_TIMEOUT_MS = 1_500

/** True when HIBP lists the password. Unreachable, slow, or non-OK responses fail open. */
export async function passwordIsBreached(
  password: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = HIBP_TIMEOUT_MS,
): Promise<boolean> {
  if (process.env.NODE_ENV === 'test' && fetchImpl === fetch) return false
  const digest = createHash('sha1').update(password).digest('hex').toUpperCase()
  const prefix = digest.slice(0, 5)
  const suffix = digest.slice(5)
  try {
    const response = await fetchImpl(`${RANGE}${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'align-password-check' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return false
    const body = await response.text()
    for (const line of body.split('\n')) {
      const [hash, count] = line.trim().split(':')
      if (hash === suffix && Number(count) > 0) return true
    }
    return false
  } catch {
    return false
  }
}

export async function assertPasswordNotBreached(password: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (await passwordIsBreached(password, fetchImpl)) {
    throw new HttpError(400, 'This password has appeared in a data breach. Choose a different one.')
  }
}

/** After a successful sign-in. Never awaited by the login response. */
export async function noteBreachedPassword(userId: string, password: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!(await passwordIsBreached(password, fetchImpl))) return
  const existing = await SecurityEvent.exists({ userId, type: 'password-breached' })
  if (existing) return
  await recordSecurity({
    userId,
    type: 'password-breached',
    summary: 'This password has appeared in a data breach. Change your password.',
  })
}

export function watchBreachedPassword(userId: string, password: string, fetchImpl: typeof fetch = fetch): void {
  void noteBreachedPassword(userId, password, fetchImpl).catch(() => undefined)
}
