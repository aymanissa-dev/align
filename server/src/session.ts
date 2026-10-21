import { createHash, randomBytes } from 'node:crypto'
import type { CookieOptions, Request, Response } from 'express'
import { Types } from 'mongoose'
import { isRole, type Role } from './authz.ts'
import { recordSecurity } from './data/securityLog.ts'
import { ensurePersonalWorkspace, ownerClaims, type AccessClaims } from './data/workspaces.ts'
import { HttpError } from './errors.ts'
import { signJwt, verifyJwt } from './keys.ts'
import { Notification, Session, User } from './models.ts'

const ACCESS_COOKIE = 'token'
const REFRESH_COOKIE = 'refresh'
const ACCESS_MS = 15 * 60 * 1000
export const IDLE_MS = 14 * 24 * 60 * 60 * 1000
export const ABSOLUTE_MS = 60 * 24 * 60 * 60 * 1000
const REFRESH_MS = ABSOLUTE_MS
const REUSE_GRACE_MS = process.env.NODE_ENV === 'test' ? 0 : 15_000
const STEP_UP_MS = 10 * 60 * 1000

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

function writeCookies(res: Response, userId: string, sessionId: string, refresh: string, claims: AccessClaims): void {
  const access = signJwt(
    { sub: userId, sid: sessionId, typ: 'access', wid: claims.workspaceId, role: claims.role, mv: claims.membershipVersion },
    '15m',
  )
  res.cookie(ACCESS_COOKIE, access, { ...cookieBase(), maxAge: ACCESS_MS })
  res.cookie(REFRESH_COOKIE, refresh, { ...cookieBase(), maxAge: REFRESH_MS })
}

export function coarseIp(ip: string | undefined): string {
  if (!ip) return ''
  const cleaned = ip.replace(/^::ffff:/, '')
  if (cleaned.includes(':')) {
    const parts = cleaned.split(':').filter(Boolean)
    return `${parts.slice(0, 4).join(':')}::/64`
  }
  const octets = cleaned.split('.')
  if (octets.length !== 4) return ''
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`
}

export function coarseLocation(req: Request): string {
  const country = req.get('x-vercel-ip-country')
  if (!country || country === 'unknown') return ''
  return country.slice(0, 8)
}

async function claimsFor(userId: string, known?: AccessClaims | null): Promise<AccessClaims> {
  if (known) return known
  const user = await User.findById(userId).select('personalWorkspaceId membershipVersion')
  const claims = user ? ownerClaims(user) : null
  if (claims) return claims
  const tenant = await ensurePersonalWorkspace(userId)
  return { workspaceId: tenant.workspaceId, role: tenant.role, membershipVersion: user?.membershipVersion ?? 0 }
}

export function prepareNewDevice(req: Request, userId: string): Promise<boolean> {
  return noticeNewDevice(req, userId, new Date())
}

function noticeNewDevice(req: Request, userId: string, before: Date): Promise<boolean> {
  const userAgent = (req.get('user-agent') ?? '').slice(0, 300)
  const deviceName = deviceLabel(userAgent)
  const ip = coarseIp(req.ip)
  return Promise.all([
    Session.exists({ userId, deviceName, ipCoarse: ip, createdAt: { $lt: before } }),
    Session.exists({ userId, createdAt: { $lt: before } }),
  ]).then(([seen, any]) => Boolean(any && !seen))
}

export async function startSession(
  req: Request,
  res: Response,
  userId: string,
  knownClaims?: AccessClaims | null,
  noticed?: Promise<boolean>,
): Promise<{ newDevice: boolean; sessionMs: number; signMs: number }> {
  const pendingNotice = noticed ?? noticeNewDevice(req, userId, new Date())
  const claims = await claimsFor(userId, knownClaims)
  const issued = await issueSession(req, res, userId, randomBytes(16).toString('hex'), claims)
  const newDevice = await pendingNotice
  if (newDevice) {
    const audit = requestAudit(req)
    const followUp = Promise.all([
      recordSecurity({
        userId,
        type: 'new-device',
        summary: `New sign-in from ${audit.device}.`,
        ...audit,
      }),
      Notification.create({
        userId,
        kind: 'new-device',
        title: `New sign-in from ${audit.device}`,
        projectName: [audit.deviceType, audit.location].filter(Boolean).join(' · '),
        dueDate: '',
        key: `new-device:${issued.id}`,
        read: false,
      }),
    ])
    if (process.env.NODE_ENV === 'test') await followUp
    else void followUp.catch(() => undefined)
  }
  return { newDevice, sessionMs: issued.sessionMs, signMs: issued.signMs }
}

type PreviousSession = {
  _id: Types.ObjectId
  userAgent?: string | null
  stepUpAt?: Date | null
}

async function issueSession(
  req: Request,
  res: Response,
  userId: string,
  familyId: string,
  claims: AccessClaims,
  previous?: PreviousSession,
): Promise<{ id: string; sessionMs: number; signMs: number }> {
  const refresh = randomBytes(32).toString('hex')
  const userAgent = previous ? (previous.userAgent ?? '') : (req.get('user-agent') ?? '')
  const now = new Date()
  const sessionStarted = performance.now()
  const session = await Session.create({
    userId,
    familyId,
    tokenHash: hashToken(refresh),
    expiresAt: new Date(now.getTime() + REFRESH_MS),
    userAgent: userAgent.slice(0, 300),
    deviceName: deviceLabel(userAgent),
    ipCoarse: coarseIp(req.ip),
    location: coarseLocation(req),
    lastSeenAt: now,
    stepUpAt: previous?.stepUpAt ?? now,
  })
  if (previous) {
    await Session.updateOne({ _id: previous._id }, { replacedBy: session._id, rotatedAt: now })
  }
  const sessionMs = performance.now() - sessionStarted
  const signStarted = performance.now()
  writeCookies(res, userId, session.id, refresh, claims)
  return { id: session.id, sessionMs, signMs: performance.now() - signStarted }
}

export type Access = {
  userId: string
  sid: string
  workspaceId?: string
  role?: Role
  membershipVersion?: number
}

export function accessFromRequest(req: Request): Access | null {
  const token = readCookie(req.headers.cookie)
  if (!token) return null
  const payload = verifyJwt(token)
  if (!payload || payload.typ !== 'access') return null
  if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null
  const role = typeof payload.role === 'string' && isRole(payload.role) ? payload.role : undefined
  return {
    userId: payload.sub,
    sid: payload.sid,
    workspaceId: typeof payload.wid === 'string' ? payload.wid : undefined,
    role,
    membershipVersion: typeof payload.mv === 'number' ? payload.mv : undefined,
  }
}

export function sessionExpired(session: { expiresAt: Date; lastSeenAt: Date }): boolean {
  if (session.expiresAt.getTime() <= Date.now()) return true
  return Date.now() - session.lastSeenAt.getTime() > IDLE_MS
}

export function stepUpFresh(stepUpAt: Date | null | undefined, now = Date.now()): boolean {
  if (!stepUpAt) return false
  return now - stepUpAt.getTime() <= STEP_UP_MS
}

/** Presents a refresh cookie, rotates it, and returns the user. Reuse revokes the family. */
export async function rotateRefresh(req: Request, res: Response) {
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
      await recordSecurity({
        userId: current.userId.toString(),
        type: 'refresh-reuse',
        summary: 'A refresh token was reused. That session family was signed out.',
        ...requestAudit(req),
      })
      clearSession(res)
    }
    return null
  }
  if (sessionExpired(current)) {
    await Session.updateOne({ _id: current._id, revokedAt: null }, { revokedAt: new Date() })
    clearSession(res)
    return null
  }
  const user = await User.findById(current.userId)
  if (!user) {
    clearSession(res)
    return null
  }
  const claims = await claimsFor(user.id, ownerClaims(user))
  await issueSession(req, res, user.id, current.familyId, claims, current)
  return user
}

export async function loadSession(id: string) {
  return Session.findById(id)
}

export async function listActiveSessions(userId: string) {
  return Session.find({
    userId,
    revokedAt: null,
    replacedBy: null,
    expiresAt: { $gt: new Date() },
  })
    .select('userAgent deviceName ipCoarse location lastSeenAt createdAt expiresAt stepUpAt')
    .sort({ lastSeenAt: -1 })
    .lean()
}

export async function revokeSessionById(userId: string, id: string) {
  return Session.findOne({ _id: id, userId, revokedAt: null, replacedBy: null })
}

export async function renameSession(userId: string, id: string, name: string) {
  return Session.findOneAndUpdate(
    { _id: id, userId, revokedAt: null, replacedBy: null },
    { deviceName: name },
    { new: true },
  )
}

export async function revokeSessions(userId: string, exceptId?: string): Promise<void> {
  await Session.updateMany(
    { userId, revokedAt: null, ...(exceptId ? { _id: { $ne: exceptId } } : {}) },
    { revokedAt: new Date() },
  )
}

export async function markStepUp(sessionId: string): Promise<void> {
  await Session.updateOne({ _id: sessionId }, { stepUpAt: new Date() })
}

/** A sensitive change needs a re-auth recorded on this session within the last 10 minutes. */
export async function requireFreshStepUp(sessionId: string | undefined): Promise<void> {
  if (!sessionId) throw new HttpError(401, 'Sign in to continue.')
  const session = await loadSession(sessionId)
  if (session && stepUpFresh(session.stepUpAt)) return
  throw new HttpError(403, 'Confirm it is you to continue.', { code: 'step_up_required' })
}

export function requestAudit(req: Request): { ipCoarse: string; device: string; deviceType: string; location: string } {
  const userAgent = req.get('user-agent') ?? ''
  return {
    ipCoarse: coarseIp(req.ip),
    device: deviceLabel(userAgent),
    deviceType: deviceKind(userAgent),
    location: coarseLocation(req),
  }
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
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Mac OS|Macintosh/.test(userAgent)
        ? 'macOS'
        : /Android/.test(userAgent)
          ? 'Android'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Unknown device'
  return `${browser} on ${os}`
}

export function deviceKind(userAgent: string): 'phone' | 'tablet' | 'desktop' {
  if (/iPad|Tablet/i.test(userAgent)) return 'tablet'
  if (/Mobile|iPhone|Android/i.test(userAgent)) return 'phone'
  return 'desktop'
}
