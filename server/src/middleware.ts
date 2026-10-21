import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express'
import { ZodError } from 'zod'
import { CONFLICT_MESSAGE } from '../../shared/contract.ts'
import { roleAtLeast } from './authz.ts'
import { resolveTenant } from './data/workspaces.ts'
import { HttpError } from './errors.ts'
import { Session, User } from './models.ts'
import { accessFromRequest, sessionExpired } from './session.ts'

const LAST_SEEN_MS = 5 * 60 * 1000
const recentSeen = new Map<string, number>()

function touchLastSeen(session: { _id: { toString(): string }; lastSeenAt: Date }): void {
  const now = Date.now()
  if (now - session.lastSeenAt.getTime() < LAST_SEEN_MS) return
  const id = session._id.toString()
  const stamped = recentSeen.get(id)
  if (stamped !== undefined && now - stamped < LAST_SEEN_MS) return
  recentSeen.set(id, now)
  if (recentSeen.size > 2_000) {
    const oldest = recentSeen.keys().next().value
    if (oldest) recentSeen.delete(oldest)
  }
  void Session.updateOne({ _id: session._id }, { lastSeenAt: new Date() }).catch(() => undefined)
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const access = accessFromRequest(req)
  if (!access) {
    next(new HttpError(401, 'Sign in to continue.'))
    return
  }
  Promise.all([User.findById(access.userId), Session.findById(access.sid)])
    .then(([user, session]) => {
      if (!user || !session || session.revokedAt || session.replacedBy || session.userId.toString() !== user.id) {
        next(new HttpError(401, 'Sign in to continue.'))
        return
      }
      if (sessionExpired(session)) {
        void Session.updateOne({ _id: session._id, revokedAt: null }, { revokedAt: new Date() }).catch(() => undefined)
        next(new HttpError(401, 'Sign in to continue.'))
        return
      }
      req.userId = user.id
      req.sessionId = session.id
      touchLastSeen(session)
      const version = user.membershipVersion ?? 0
      const requested = req.get('x-workspace-id') || undefined
      const claimed =
        access.workspaceId && access.role && access.membershipVersion === version
          ? { userId: user.id, workspaceId: access.workspaceId, role: access.role }
          : null
      if (requested && requested !== claimed?.workspaceId) {
        resolveTenant(user.id, requested, version)
          .then((tenant) => {
            req.tenant = tenant
            next()
          })
          .catch(next)
        return
      }
      if (!claimed) {
        next(new HttpError(401, 'Sign in to continue.'))
        return
      }
      req.tenant = claimed
      next()
    })
    .catch(next)
}

export function currentUserId(req: Request): string {
  if (!req.userId) throw new HttpError(401, 'Sign in to continue.')
  return req.userId
}

export const requireWriter: RequestHandler = (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next()
    return
  }
  if (!req.tenant || !roleAtLeast(req.tenant.role, 'member')) {
    next(new HttpError(403, 'You do not have permission to change this workspace.'))
    return
  }
  next()
}

function isRecord(error: unknown): error is Record<string, unknown> {
  return typeof error === 'object' && error !== null
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) return

  if (error instanceof HttpError) {
    for (const [key, value] of Object.entries(error.headers)) res.setHeader(key, value)
    res.status(error.status).json(error.code ? { error: error.message, code: error.code } : { error: error.message })
    return
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid input.' })
    return
  }
  if (isRecord(error) && error.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request is too large.' })
    return
  }
  if (error instanceof SyntaxError && isRecord(error) && error.status === 400) {
    res.status(400).json({ error: 'Invalid JSON.' })
    return
  }
  if (isRecord(error) && error.code === 11000) {
    const pattern = isRecord(error.keyPattern) ? error.keyPattern : null
    if (!pattern || ('email' in pattern && !('workspaceId' in pattern))) {
      res.status(409).json({ error: "We couldn't create an account with those details." })
      return
    }
    res.status(409).json({ error: 'That record already exists.' })
    return
  }
  if (isRecord(error) && error.name === 'VersionError') {
    res.status(409).json({ error: CONFLICT_MESSAGE })
    return
  }
  if (isRecord(error) && error.name === 'CastError') {
    res.status(404).json({ error: 'Not found.' })
    return
  }

  console.error(error)
  res.status(500).json({ error: 'Something went wrong. Try again.' })
}
