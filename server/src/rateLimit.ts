import { HttpError } from './errors.ts'
import { RateLimit } from './models.ts'

const WINDOW_MS = 15 * 60 * 1000

const PRODUCTION_MAX: Record<'login' | 'register' | 'forgot' | 'reset', number> = {
  login: 10,
  register: 5,
  forgot: 5,
  reset: 10,
}

function duplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
}

async function hit(key: string): Promise<number> {
  const now = Date.now()
  const expiresAt = new Date(now + WINDOW_MS)
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
  return doc?.count ?? 1
}

/** Back off a failed attempt. Successful sign-in does not wait. */
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
  const counts = await Promise.all(keys.map((key) => hit(key)))
  const count = Math.max(0, ...counts)
  if (count > max) {
    throw new HttpError(429, 'Too many attempts. Try again later.', { headers: { 'Retry-After': '60' } })
  }
  return count
}
