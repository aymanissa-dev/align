import { createHash, randomBytes } from 'node:crypto'
import type { CookieOptions, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { Types } from 'mongoose'
import { HttpError } from './errors.ts'
import { Session } from './models.ts'

const ACCESS_COOKIE = 'token'
const REFRESH_COOKIE = 'refresh'
const ACCESS_MS = 15 * 60 * 1000
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000
const REUSE_GRACE_MS = process.env.NODE_ENV === 'test' ? 0 : 15_000

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

export function readCookie(header: string | undefined, name = ACCESS_COOKIE): string | undefined {
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

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function clearSession(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, cookieBase())
  res.clearCookie(REFRESH_COOKIE, cookieBase())
}

function writeCookies(res: Response, userId: string, sessionId: string, refresh: string): void {
  const access = jwt.sign({ sub: userId, sid: sessionId, typ: 'access' }, secret(), { expiresIn: '15m' })
  res.cookie(ACCESS_COOKIE, access, { ...cookieBase(), maxAge: ACCESS_MS })
  res.cookie(REFRESH_COOKIE, refresh, { ...cookieBase(), maxAge: REFRESH_MS })
}

export async function startSession(res: Response, userId: string, userAgent: string | undefined): Promise<void> {
  await issueSession(res, userId, randomBytes(16).toString('hex'), userAgent)
}

async function issueSession(
  res: Response,
  userId: string,
  familyId: string,
  userAgent: string | undefined,
  previousId?: Types.ObjectId,
): Promise<void> {
  const refresh = randomBytes(32).toString('hex')
  const session = await Session.create({
    userId,
    familyId,
    tokenHash: hashToken(refresh),
    expiresAt: new Date(Date.now() + REFRESH_MS),
    userAgent: (userAgent ?? '').slice(0, 300),
    lastSeenAt: new Date(),
  })
  if (previousId) {
    await Session.updateOne({ _id: previousId }, { replacedBy: session._id, rotatedAt: new Date() })
  }
  writeCookies(res, userId, session.id, refresh)
}

export type Access = { userId: string; sid: string }

export function accessFromRequest(req: Request): Access | null {
  const token = readCookie(req.headers.cookie)
  if (!token) return null
  try {
    const payload = jwt.verify(token, secret())
    if (typeof payload === 'string' || payload.typ !== 'access') return null
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null
    return { userId: payload.sub, sid: payload.sid }
  } catch {
    return null
  }
}

/** Presents a refresh cookie, rotates it, and returns the user id. Reuse revokes the family. */
export async function rotateRefresh(req: Request, res: Response): Promise<string | null> {
  const raw = readCookie(req.headers.cookie, REFRESH_COOKIE)
  if (!raw) return null
  const current = await Session.findOne({ tokenHash: hashToken(raw) })
  if (!current || current.revokedAt || current.expiresAt.getTime() <= Date.now()) {
    clearSession(res)
    return null
  }
  if (current.replacedBy) {
    const rotatedAt = current.rotatedAt?.getTime() ?? 0
    if (Date.now() - rotatedAt > REUSE_GRACE_MS) {
      await Session.updateMany({ familyId: current.familyId, revokedAt: null }, { revokedAt: new Date() })
      clearSession(res)
    }
    return null
  }
  await issueSession(res, current.userId.toString(), current.familyId, current.userAgent, current._id)
  return current.userId.toString()
}

export async function revokeRefreshCookie(req: Request): Promise<void> {
  const raw = readCookie(req.headers.cookie, REFRESH_COOKIE)
  if (!raw) return
  await Session.updateOne({ tokenHash: hashToken(raw), revokedAt: null }, { revokedAt: new Date() })
}

export function deviceLabel(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser'
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Mac OS/.test(userAgent)
      ? 'macOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Unknown device'
  return `${browser} on ${os}`
}
