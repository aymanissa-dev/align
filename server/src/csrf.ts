import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import { readCookie } from './session.ts'

export const CSRF_COOKIE = 'csrf'
const HEADER = 'x-csrf-token'

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 24 * 60 * 60 * 1000,
  }
}

/** Double-submit cookie. A missing cookie is issued and the request continues; a present cookie must be echoed. */
export const csrfProtection: RequestHandler = (req, res, next) => {
  const existing = readCookie(req.headers.cookie, CSRF_COOKIE)
  const token = existing ?? randomBytes(32).toString('hex')
  if (!existing) res.cookie(CSRF_COOKIE, token, csrfCookieOptions())
  const method = req.method.toUpperCase()
  const unsafe = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
  if (unsafe && req.path.startsWith('/api/') && existing) {
    const header = req.get(HEADER) ?? ''
    if (!header || !safeEqual(header, existing)) {
      res.status(403).json({ error: 'CSRF token missing or invalid.', code: 'csrf' })
      return
    }
  }
  next()
}
