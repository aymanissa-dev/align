import type { CookieOptions, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { HttpError } from './errors.ts'

const COOKIE = 'token'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function secret(): string {
  const value = process.env.JWT_SECRET
  if (!value) throw new HttpError(500, 'Auth is not configured.')
  return value
}

function cookieBase(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  }
}

export function readCookie(header: string | undefined, name = COOKIE): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    const key = part.slice(0, separator).trim()
    if (key !== name) continue
    const raw = part.slice(separator + 1).trim()
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return undefined
}

export function setSession(res: Response, userId: string): void {
  const token = jwt.sign({ sub: userId }, secret(), { expiresIn: '7d' })
  res.cookie(COOKIE, token, { ...cookieBase(), maxAge: WEEK_MS })
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE, cookieBase())
}

export function userIdFromRequest(req: Request): string | null {
  const token = readCookie(req.headers.cookie)
  if (!token) return null
  try {
    const payload = jwt.verify(token, secret())
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return null
    return payload.sub
  } catch {
    return null
  }
}
