import { HttpError } from './errors.ts'
import { RateLimit } from './models.ts'

const WINDOW_MS = 15 * 60 * 1000
const SUCCESS_WINDOW_MS = 60 * 1000
const SUCCESS_MAX = 30

/**
 * Sign-in has one failure policy. A wrong password increments per-email and
 * per-IP counters for 15 minutes. Counts of 3 through 10 only delay the 401.
 * The 11th attempt in that window is the 429. A correct password clears the
 * per-email counter. There is no second lock at five failures.
 */
const PRODUCTION_MAX: Record<'login' | 'register' | 'forgot' | 'reset', number> = {
  login: 10,
  register: 5,
  forgot: 5,
  reset: 10,
}

type Bucket = { count: number; expiresAt: Date }

function duplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
}

function loginFailureMax(): number {
  return process.env.NODE_ENV === 'production' ? PRODUCTION_MAX.login : 1000
}

function loginSuccessMax(): number {
  return process.env.NODE_ENV === 'production' ? SUCCESS_MAX : 1000
}

function failureKeys(ip: string, email: string): string[] {
  return [`login:fail:ip:${ip || 'unknown'}`, `login:fail:email:${email}`]
}

function successKeys(ip: string, email: string): string[] {
  return [`login:ok:ip:${ip || 'unknown'}`, `login:ok:email:${email}`]
}

async function hit(key: string, windowMs = WINDOW_MS): Promise<Bucket> {
  const now = Date.now()
  const expiresAt = new Date(now + windowMs)
  let doc
  try {
    doc = await RateLimit.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, new: true },
    )
  } catch (error) {
    if (!duplicateKey(error)) throw error
    doc = await RateLimit.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { new: true })
  }
  if (doc && doc.expiresAt.getTime() <= now) {
    doc = await RateLimit.findOneAndUpdate({ key }, { $set: { count: 1, expiresAt } }, { new: true })
  }
  return { count: doc?.count ?? 1, expiresAt: doc?.expiresAt ?? expiresAt }
}

async function readActive(key: string): Promise<Bucket | null> {
  const doc = await RateLimit.findOne({ key }).lean<{ count: number; expiresAt: Date } | null>()
  if (!doc || doc.expiresAt.getTime() <= Date.now()) return null
  return { count: doc.count, expiresAt: doc.expiresAt }
}

function rejectIfAtLeast(hits: Array<Bucket | null>, max: number): void {
  const now = Date.now()
  const blocked = hits.filter((entry): entry is Bucket => entry !== null && entry.count >= max)
  if (blocked.length === 0) return
  const remainingMs = Math.max(...blocked.map((entry) => entry.expiresAt.getTime() - now))
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000))
  throw new HttpError(429, 'Too many attempts. Try again later.', { headers: { 'Retry-After': String(seconds) } })
}

/**
 * Refuse a sign-in that already used its failure budget or the generous success budget.
 * Reading does not increment either counter.
 */
export async function guardLogin(ip: string, email: string): Promise<void> {
  const keys = [...failureKeys(ip, email), ...successKeys(ip, email)]
  const [failIp, failEmail, okIp, okEmail] = await Promise.all(keys.map((key) => readActive(key)))
  rejectIfAtLeast([failIp ?? null, failEmail ?? null], loginFailureMax())
  rejectIfAtLeast([okIp ?? null, okEmail ?? null], loginSuccessMax())
}

/** Count one wrong password toward the per-email and per-IP failure windows. */
export async function recordLoginFailure(ip: string, email: string): Promise<number> {
  const [, emailHit] = await Promise.all(failureKeys(ip, email).map((key) => hit(key)))
  return emailHit?.count ?? 1
}

/** A correct password clears the per-email failure window. The shared IP counter stays. */
export async function clearLoginFailures(email: string): Promise<void> {
  await RateLimit.deleteOne({ key: `login:fail:email:${email}` })
}

/** Count a correct password against the separate per-minute success budget. */
export async function recordLoginSuccess(ip: string, email: string): Promise<void> {
  await Promise.all(successKeys(ip, email).map((key) => hit(key, SUCCESS_WINDOW_MS)))
}

/**
 * Progressive delay for a wrong password, before the 15-minute window locks.
 * The third failure waits 250ms and each later one adds another 250ms, up to 5s.
 * Successful sign-in does not wait.
 */
export async function delayFailedAttempt(count: number): Promise<void> {
  if (process.env.NODE_ENV === 'test' || count <= 2) return
  const delay = Math.min(5_000, (count - 2) * 250)
  await new Promise((resolve) => setTimeout(resolve, delay))
}

export async function enforceAuthLimit(
  route: 'login' | 'register' | 'forgot' | 'reset',
  ip: string,
  email?: string,
): Promise<number> {
  const max = process.env.NODE_ENV === 'production' ? PRODUCTION_MAX[route] : 1000
  const keys = [`${route}:ip:${ip || 'unknown'}`]
  if (email) keys.push(`${route}:email:${email}`)
  const hits = await Promise.all(keys.map((key) => hit(key)))
  const count = Math.max(0, ...hits.map((entry) => entry.count))
  if (count > max) {
    const now = Date.now()
    const remainingMs = Math.max(
      ...hits.filter((entry) => entry.count > max).map((entry) => entry.expiresAt.getTime() - now),
    )
    const seconds = Math.max(1, Math.ceil(remainingMs / 1000))
    throw new HttpError(429, 'Too many attempts. Try again later.', { headers: { 'Retry-After': String(seconds) } })
  }
  return count
}
