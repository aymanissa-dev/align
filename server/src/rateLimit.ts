import type { RequestHandler } from 'express'
import { clientIp } from './clientIp.ts'
import { HttpError } from './errors.ts'
import { RateLimit } from './models.ts'

export const WINDOW_MS = 15 * 60 * 1000
export const REGISTER_WINDOW_MS = 60 * 60 * 1000
export const REGISTER_DAY_MS = 24 * 60 * 60 * 1000
const REGISTER_HOUR_MAX = 5
const REGISTER_DAY_MAX = 20
const SUCCESS_WINDOW_MS = 60 * 1000
const SUCCESS_MAX = 30
const MFA_MAX = 5

/** Production cap for the shared limiter around every /api/auth route. */
export const AUTH_ROUTE_LIMIT = 60

/**
 * Sign-in has one failure policy. A wrong password increments per-email and
 * per-IP counters for 15 minutes. Counts of 3 through 10 only delay the 401.
 * The 11th attempt in that window is the 429. A correct password clears the
 * per-email counter. There is no second lock at five failures.
 */
const PRODUCTION_MAX: Record<'login' | 'reset', number> = {
  login: 10,
  reset: 10,
}

type Bucket = { count: number; expiresAt: Date }

/** Start of the fixed window that contains `now`, aligned to the epoch. */
export function bucketStart(windowMs: number, now = Date.now()): number {
  return Math.floor(now / windowMs) * windowMs
}

let indexesReady: Promise<void> | null = null

/** Unique key+window and a TTL on expiry, created before the first increment. */
export function ensureRateLimitIndexes(): Promise<void> {
  indexesReady ??= (async () => {
    const collection = RateLimit.collection
    const indexes = await collection.indexes()
    if (indexes.some((index) => index.name === 'RateLimitKey')) await collection.dropIndex('RateLimitKey')
    if (!indexes.some((index) => index.name === 'RateLimitWindow')) {
      await collection.createIndex({ key: 1, windowStart: 1 }, { unique: true, name: 'RateLimitWindow' })
    }
    if (!indexes.some((index) => index.expireAfterSeconds === 0 && index.key?.expiresAt === 1)) {
      await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'RateLimitExpire' })
    }
  })().catch((error: unknown) => {
    indexesReady = null
    throw error
  })
  return indexesReady
}

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

/**
 * Shared counter for the limiter in front of every /api/auth route.
 * Counts live in Mongo, so a second instance sees the same total.
 */
export function authRouteStore() {
  let windowMs = WINDOW_MS
  const storageKey = (key: string) => `auth-route:${key}`
  return {
    localKeys: false as const,
    init(options: { windowMs: number }) {
      windowMs = options.windowMs
    },
    async increment(key: string) {
      const bucket = await hit(storageKey(key), windowMs)
      return { totalHits: bucket.count, resetTime: bucket.expiresAt }
    },
    async decrement(key: string) {
      await RateLimit.updateOne(
        { key: storageKey(key), windowStart: bucketStart(windowMs), count: { $gt: 0 } },
        { $inc: { count: -1 } },
      )
    },
    async resetKey(key: string) {
      await RateLimit.deleteOne({ key: storageKey(key), windowStart: bucketStart(windowMs) })
    },
  }
}

/**
 * One Mongo document per key and window. The increment is a single upsert, so
 * two processes cannot keep separate counts.
 */
async function hit(key: string, windowMs = WINDOW_MS): Promise<Bucket> {
  await ensureRateLimitIndexes()
  const start = bucketStart(windowMs)
  const expiresAt = new Date(start + windowMs)
  try {
    const doc = await RateLimit.findOneAndUpdate(
      { key, windowStart: start },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, new: true },
    )
    return { count: doc?.count ?? 1, expiresAt: doc?.expiresAt ?? expiresAt }
  } catch (error) {
    if (!duplicateKey(error)) throw error
    const doc = await RateLimit.findOneAndUpdate({ key, windowStart: start }, { $inc: { count: 1 } }, { new: true })
    return { count: doc?.count ?? 1, expiresAt: doc?.expiresAt ?? expiresAt }
  }
}

async function readActive(key: string, windowMs: number): Promise<Bucket | null> {
  const doc = await RateLimit.findOne({ key, windowStart: bucketStart(windowMs) }).lean<{
    count: number
    expiresAt: Date
  } | null>()
  if (!doc || doc.expiresAt.getTime() <= Date.now()) return null
  return { count: doc.count, expiresAt: doc.expiresAt }
}

/** Shared cap in front of auth routes. There is no in-memory store. */
export function authRouteLimiter(max: number): RequestHandler {
  const store = authRouteStore()
  store.init({ windowMs: WINDOW_MS })
  return (req, res, next) => {
    store
      .increment(clientIp(req) || 'unknown')
      .then((bucket) => {
        const resetSeconds = Math.max(1, Math.ceil((bucket.resetTime.getTime() - Date.now()) / 1000))
        res.setHeader('RateLimit-Limit', String(max))
        res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.totalHits)))
        res.setHeader('RateLimit-Reset', String(resetSeconds))
        if (bucket.totalHits > max) {
          res.setHeader('Retry-After', String(resetSeconds))
          res.status(429).json({ error: 'Too many attempts. Try again later.' })
          return
        }
        next()
      })
      .catch(next)
  }
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
  const safeIp = ip || 'unknown'
  const [failIp, failEmail, okIp, okEmail] = await Promise.all([
    readActive(`login:fail:ip:${safeIp}`, WINDOW_MS),
    readActive(`login:fail:email:${email}`, WINDOW_MS),
    readActive(`login:ok:ip:${safeIp}`, SUCCESS_WINDOW_MS),
    readActive(`login:ok:email:${email}`, SUCCESS_WINDOW_MS),
  ])
  rejectIfAtLeast([failIp, failEmail], loginFailureMax())
  rejectIfAtLeast([okIp, okEmail], loginSuccessMax())
}

/** Count one wrong password toward the per-email and per-IP failure windows. */
export async function recordLoginFailure(ip: string, email: string): Promise<number> {
  const [, emailHit] = await Promise.all(failureKeys(ip, email).map((key) => hit(key)))
  return emailHit?.count ?? 1
}

/** A correct password clears the per-email failure window. The shared IP counter stays. */
export async function clearLoginFailures(email: string): Promise<void> {
  await RateLimit.deleteOne({ key: `login:fail:email:${email}`, windowStart: bucketStart(WINDOW_MS) })
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

/**
 * Registration is counted per IP only. An email key would 429 one address and
 * still accept another, which reveals which address is being throttled.
 * Production allows 5 an hour and 20 a day. Callers apply the same progressive
 * delay on the new-account and duplicate paths.
 */
async function enforceRegisterLimit(ip: string): Promise<number> {
  const production = process.env.NODE_ENV === 'production'
  const hourMax = production ? REGISTER_HOUR_MAX : 1000
  const dayMax = production ? REGISTER_DAY_MAX : 1000
  const safeIp = ip || 'unknown'
  const [hour, day] = await Promise.all([
    hit(`register:ip:${safeIp}`, REGISTER_WINDOW_MS),
    hit(`register:ip:${safeIp}:day`, REGISTER_DAY_MS),
  ])
  const blocked = [hour.count > hourMax ? hour : null, day.count > dayMax ? day : null].filter(
    (entry): entry is Bucket => entry !== null,
  )
  if (blocked.length > 0) {
    const now = Date.now()
    const remainingMs = Math.max(...blocked.map((entry) => entry.expiresAt.getTime() - now))
    const seconds = Math.max(1, Math.ceil(remainingMs / 1000))
    throw new HttpError(429, 'Too many attempts. Try again later.', { headers: { 'Retry-After': String(seconds) } })
  }
  return hour.count
}

export async function enforceAuthLimit(
  route: 'login' | 'register' | 'reset',
  ip: string,
  email?: string,
): Promise<number> {
  if (route === 'register') return enforceRegisterLimit(ip)
  const production = process.env.NODE_ENV === 'production'
  const max = production ? PRODUCTION_MAX[route] : 1000
  const windowMs = WINDOW_MS
  const keys = [`${route}:ip:${ip || 'unknown'}`]
  if (email) keys.push(`${route}:email:${email}`)
  const hits = await Promise.all(keys.map((key) => hit(key, windowMs)))
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

function mfaKeys(ip: string, userId: string): string[] {
  return [`mfa:fail:ip:${ip || 'unknown'}`, `mfa:fail:user:${userId}`]
}

function mfaMax(): number {
  return process.env.NODE_ENV === 'production' ? MFA_MAX : 1000
}

/** Refuse a two-factor attempt that already used its failure budget. */
export async function guardMfa(ip: string, userId: string): Promise<void> {
  const hits = await Promise.all(mfaKeys(ip, userId).map((key) => readActive(key, WINDOW_MS)))
  rejectIfAtLeast(hits, mfaMax())
}

/** Count one rejected authenticator or recovery code. */
export async function recordMfaFailure(ip: string, userId: string): Promise<number> {
  const [, userHit] = await Promise.all(mfaKeys(ip, userId).map((key) => hit(key)))
  return userHit?.count ?? 1
}

export async function clearMfaFailures(userId: string): Promise<void> {
  await RateLimit.deleteOne({ key: `mfa:fail:user:${userId}`, windowStart: bucketStart(WINDOW_MS) })
}
