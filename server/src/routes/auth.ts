import { randomBytes } from 'node:crypto'
import { Router, type Request, type RequestHandler } from 'express'
import { deleteAccount } from '../data/content.ts'
import { dashboardForUser } from './dashboard.ts'
import { ensurePersonalWorkspace, ownerClaims } from '../data/workspaces.ts'
import { users } from '../data/users.ts'
import { recordSecurity } from '../data/securityLog.ts'
import { HttpError } from '../errors.ts'
import { assertPasswordNotBreached, watchBreachedPassword } from '../hibp.ts'
import { signJwt, verifyJwt } from '../keys.ts'
import { deliverMail } from '../mail.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { checkPassword, dummyPasswordHash, hashPassword } from '../password.ts'
import { delayFailedAttempt, enforceAuthLimit } from '../rateLimit.ts'
import { publicUser } from '../serialize.ts'
import {
  IDLE_MS,
  accessFromRequest,
  clearSession,
  deviceLabel,
  listActiveSessions,
  loadSession,
  renameSession,
  requestAudit,
  requireFreshStepUp,
  revokeRefreshCookie,
  revokeSessionById,
  revokeSessions,
  rotateRefresh,
  sessionExpired,
  startSession,
} from '../session.ts'
import { consumeAuthToken, issueAuthToken } from '../tokens.ts'
import {
  emailChangeSchema,
  forgotSchema,
  loginSchema,
  parseBody,
  passwordSchema,
  profileSchema,
  registerSchema,
  resetSchema,
  sessionRenameSchema,
  verifySchema,
} from '../validate.ts'

const LOCK_AFTER = 5

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown'
}

function appOrigin(req: Request): string {
  const configured = process.env.APP_ORIGIN?.replace(/\/$/, '')
  if (configured) return configured
  return `${req.protocol}://${req.get('host')}`
}

function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

async function sendOrReveal(
  email: string,
  subject: string,
  text: string,
): Promise<boolean> {
  return deliverMail({ to: email, subject, text })
}

function lockDelay(failures: number): number {
  const steps = Math.min(6, Math.max(1, failures - LOCK_AFTER + 1))
  return Math.min(60, 2 ** steps) * 60 * 1000
}

export function authRouter(limiter: RequestHandler): Router {
  const router = Router()

  router.get('/providers', (_req, res) => {
    res.json({ google: googleConfigured() })
  })

  router.post(
    '/register',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(registerSchema, req.body)
      await enforceAuthLimit('register', clientIp(req), input.email)
      await assertPasswordNotBreached(input.password)
      const existing = await users.byEmail(input.email)
      if (existing) throw new HttpError(409, 'An account with this email already exists.')
      const user = await users.create({
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        emailVerifiedAt: null,
      })
      await ensurePersonalWorkspace(user.id)
      const verifyToken = await issueAuthToken(user.id, 'verify')
      const link = `${appOrigin(req)}/verify?token=${encodeURIComponent(verifyToken)}`
      const mailed = await sendOrReveal(
        user.email,
        'Verify your Align email',
        `Confirm your email by opening this link within 24 hours:\n${link}`,
      )
      const started = await startSession(req, res, user.id)
      res.status(201).json(mailed ? { ...publicUser(user), newDevice: started.newDevice } : { ...publicUser(user), verifyToken, newDevice: started.newDevice })
    }),
  )

  router.post(
    '/login',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(loginSchema, req.body)
      const [attempts, user] = await Promise.all([
        enforceAuthLimit('login', clientIp(req), input.email),
        users.byEmailSecret(input.email),
      ])
      if (user?.lockUntil && user.lockUntil.getTime() > Date.now()) {
        throw new HttpError(429, 'Too many attempts. Try again later.')
      }
      const hash = user?.passwordHash ?? (await dummyPasswordHash())
      const matches = await checkPassword(input.password, hash)
      if (!user || !matches) {
        if (user) {
          user.failedLogins = (user.failedLogins ?? 0) + 1
          if (user.failedLogins >= LOCK_AFTER) user.lockUntil = new Date(Date.now() + lockDelay(user.failedLogins))
          await user.save()
          await recordSecurity({
            userId: user.id,
            type: 'sign-in-failed',
            summary: 'A sign-in attempt used the wrong password.',
            ...requestAudit(req),
          }).catch(() => undefined)
        }
        await delayFailedAttempt(attempts)
        throw new HttpError(401, 'Email or password is incorrect.')
      }
      if (user.totpEnabledAt) {
        const pending = signJwt({ sub: user.id, typ: 'pending' }, '5m')
        res.cookie('pending', pending, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 5 * 60 * 1000,
        })
        res.json({ mfaRequired: true, methods: ['totp', 'recovery', 'passkey'] })
        void watchBreachedPassword(user.id, input.password)
        return
      }
      if (user.failedLogins || user.lockUntil) {
        user.failedLogins = 0
        user.lockUntil = null
        await user.save()
      }
      const [started, dashboard] = await Promise.all([
        startSession(req, res, user.id, ownerClaims(user)),
        dashboardForUser(user),
      ])
      res.json({
        ...publicUser(user),
        newDevice: started.newDevice,
        ...(dashboard ? { dashboard } : {}),
      })
      void recordSecurity({
        userId: user.id,
        type: 'sign-in',
        summary: 'Signed in with a password.',
        ...requestAudit(req),
      })
      void watchBreachedPassword(user.id, input.password)
    }),
  )

  router.get(
    '/session',
    asyncHandler(async (req, res) => {
      const access = accessFromRequest(req)
      if (access) {
        const session = await loadSession(access.sid)
        const current =
          session &&
          !session.revokedAt &&
          !session.replacedBy &&
          !sessionExpired(session) &&
          session.userId.toString() === access.userId
        if (current) {
          const user = await users.byId(access.userId)
          res.json({ user: user ? publicUser(user) : null })
          return
        }
      }
      const user = await rotateRefresh(req, res)
      res.json({ user: user ? publicUser(user) : null })
    }),
  )

  router.post(
    '/refresh',
    asyncHandler(async (req, res) => {
      const user = await rotateRefresh(req, res)
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      res.json(publicUser(user))
    }),
  )

  router.post(
    '/forgot',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(forgotSchema, req.body)
      await enforceAuthLimit('forgot', clientIp(req), input.email)
      const user = await users.byEmail(input.email)
      const body: { message: string; resetToken?: string } = {
        message: 'If an account exists for that email, a reset link is ready.',
      }
      if (user) {
        const resetToken = await issueAuthToken(user.id, 'reset')
        const link = `${appOrigin(req)}/reset?token=${encodeURIComponent(resetToken)}`
        const mailed = await sendOrReveal(
          user.email,
          'Reset your Align password',
          `Reset your password by opening this link within one hour:\n${link}`,
        )
        if (!mailed) body.resetToken = resetToken
      }
      res.json(body)
    }),
  )

  router.post(
    '/reset',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(resetSchema, req.body)
      await enforceAuthLimit('reset', clientIp(req))
      const userId = await consumeAuthToken(input.token, 'reset')
      await assertPasswordNotBreached(input.password)
      const user = userId ? await users.byIdSecret(userId) : null
      if (!user) throw new HttpError(400, 'This reset link is invalid or has expired.')
      user.passwordHash = await hashPassword(input.password)
      user.failedLogins = 0
      user.lockUntil = null
      await user.save()
      await revokeSessions(user.id)
      await ensurePersonalWorkspace(user.id)
      await startSession(req, res, user.id)
      await recordSecurity({ userId: user.id, type: 'password-reset', summary: 'Password was reset.', ...requestAudit(req) })
      res.json(publicUser(user))
    }),
  )

  router.post(
    '/verify',
    asyncHandler(async (req, res) => {
      const input = parseBody(verifySchema, req.body)
      const userId = await consumeAuthToken(input.token, 'verify')
      const user = userId ? await users.byId(userId) : null
      if (!user) throw new HttpError(400, 'This verification link is invalid or has expired.')
      if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date()
      await user.save()
      res.json(publicUser(user))
    }),
  )

  router.post(
    '/verify/send',
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await users.byId(currentUserId(req))
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      if (user.emailVerifiedAt) {
        res.json({ message: 'This email is already verified.' })
        return
      }
      const verifyToken = await issueAuthToken(user.id, 'verify')
      const link = `${appOrigin(req)}/verify?token=${encodeURIComponent(verifyToken)}`
      const mailed = await sendOrReveal(
        user.email,
        'Verify your Align email',
        `Confirm your email by opening this link within 24 hours:\n${link}`,
      )
      res.json(mailed ? { message: 'Verification link sent.' } : { message: 'Verification link ready.', verifyToken })
    }),
  )

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      try {
        await revokeRefreshCookie(req)
      } catch {
        // Clearing the cookies still signs this browser out.
      }
      clearSession(res)
      res.status(204).send()
    }),
  )

  router.get(
    '/sessions',
    requireAuth,
    asyncHandler(async (req, res) => {
      const sessions = await listActiveSessions(currentUserId(req))
      res.json(
        sessions.map((session) => ({
          id: session._id.toString(),
          current: session._id.toString() === req.sessionId,
          device: session.deviceName || deviceLabel(session.userAgent || ''),
          ip: session.ipCoarse || '',
          location: session.location || '',
          lastSeenAt: session.lastSeenAt.toISOString(),
          createdAt: session.createdAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          idleExpiresAt: new Date(session.lastSeenAt.getTime() + IDLE_MS).toISOString(),
        })),
      )
    }),
  )

  router.delete(
    '/sessions/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const session = await revokeSessionById(currentUserId(req), req.params.id)
      if (!session) throw new HttpError(404, 'Session not found.')
      session.revokedAt = new Date()
      await session.save()
      await recordSecurity({
        userId: currentUserId(req),
        type: 'session-revoked',
        summary: 'A session was revoked.',
        ...requestAudit(req),
      })
      if (session.id === req.sessionId) clearSession(res)
      res.status(204).send()
    }),
  )

  router.post(
    '/sessions/revoke-all',
    requireAuth,
    asyncHandler(async (req, res) => {
      await requireFreshStepUp(req.sessionId)
      await revokeSessions(currentUserId(req))
      await recordSecurity({
        userId: currentUserId(req),
        type: 'sessions-revoked',
        summary: 'Every session was revoked.',
        ...requestAudit(req),
      })
      clearSession(res)
      res.status(204).send()
    }),
  )

  router.get(
    '/google',
    asyncHandler(async (req, res) => {
      if (!googleConfigured()) throw new HttpError(404, 'Google sign-in is not configured.')
      const state = signJwt({ typ: 'google' }, '10m')
      const redirect = `${appOrigin(req)}/api/auth/google/callback`
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID ?? '')
      url.searchParams.set('redirect_uri', redirect)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', 'openid email profile')
      url.searchParams.set('state', state)
      url.searchParams.set('prompt', 'select_account')
      res.redirect(url.toString())
    }),
  )

  router.get(
    '/google/callback',
    asyncHandler(async (req, res) => {
      if (!googleConfigured()) throw new HttpError(404, 'Google sign-in is not configured.')
      const code = typeof req.query.code === 'string' ? req.query.code : ''
      const state = typeof req.query.state === 'string' ? req.query.state : ''
      const fail = () => {
        res.redirect('/login?error=google')
      }
      try {
        const payload = verifyJwt(state)
        if (!payload || payload.typ !== 'google' || !code) {
          fail()
          return
        }
      } catch {
        fail()
        return
      }
      const redirect = `${appOrigin(req)}/api/auth/google/callback`
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID ?? '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
          redirect_uri: redirect,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(8_000),
      })
      if (!tokenResponse.ok) {
        fail()
        return
      }
      const tokenBody = (await tokenResponse.json()) as { access_token?: string }
      if (!tokenBody.access_token) {
        fail()
        return
      }
      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
        signal: AbortSignal.timeout(8_000),
      })
      if (!profileResponse.ok) {
        fail()
        return
      }
      const profile = (await profileResponse.json()) as {
        sub?: string
        email?: string
        email_verified?: boolean
        name?: string
      }
      const email = profile.email?.trim().toLowerCase()
      if (!profile.sub || !email || profile.email_verified !== true) {
        fail()
        return
      }
      let user = await users.byGoogle(profile.sub)
      if (!user) user = await users.byEmail(email)
      if (user) {
        if (!user.googleId) user.googleId = profile.sub
        if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date()
        await user.save()
      } else {
        user = await users.create({
          name: (profile.name || email.split('@')[0] || 'Align').slice(0, 80),
          email,
          passwordHash: await hashPassword(randomBytes(32).toString('hex')),
          emailVerifiedAt: new Date(),
          googleId: profile.sub,
        })
      }
      await ensurePersonalWorkspace(user.id)
      await startSession(req, res, user.id)
      res.redirect('/')
    }),
  )

  router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await users.byId(currentUserId(req))
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      res.json({ ...publicUser(user), totpEnabled: Boolean(user.totpEnabledAt) })
    }),
  )

  router.patch(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = parseBody(profileSchema, req.body)
      const update: { name?: string; accent?: string } = {}
      if (input.name !== undefined) update.name = input.name
      if (input.accent !== undefined) update.accent = input.accent.toLowerCase()
      const user = await users.update(currentUserId(req), update)
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      res.json(publicUser(user))
    }),
  )

  router.post(
    '/email',
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = parseBody(emailChangeSchema, req.body)
      const userId = currentUserId(req)
      await requireFreshStepUp(req.sessionId)
      const secret = await users.byIdSecret(userId)
      if (!secret?.passwordHash || !(await checkPassword(input.password, secret.passwordHash))) {
        throw new HttpError(400, 'Current password is incorrect.')
      }
      const next = input.email.trim().toLowerCase()
      const taken = await users.byEmail(next)
      if (taken && taken.id !== userId) throw new HttpError(409, 'An account already uses that email.')
      const user = await users.update(userId, { email: next, emailVerifiedAt: null })
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      await recordSecurity({
        userId,
        type: 'email-changed',
        summary: 'The account email was changed.',
        ...requestAudit(req),
      })
      const token = await issueAuthToken(user.id, 'verify')
      const link = `${appOrigin(req)}/verify?token=${encodeURIComponent(token)}`
      const mailed = await sendOrReveal(
        user.email,
        'Verify your new Align email',
        `Confirm this email by opening this link within one hour:\n${link}`,
      )
      res.json({ ...publicUser(user), ...(mailed ? {} : { verifyToken: token }) })
    }),
  )

  router.post(
    '/password',
    limiter,
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = parseBody(passwordSchema, req.body)
      await requireFreshStepUp(req.sessionId)
      const user = await users.byIdSecret(currentUserId(req))
      if (!user?.passwordHash) throw new HttpError(401, 'Sign in to continue.')
      const matches = await checkPassword(input.currentPassword, user.passwordHash)
      if (!matches) throw new HttpError(400, 'Current password is incorrect.')
      await assertPasswordNotBreached(input.newPassword)
      user.passwordHash = await hashPassword(input.newPassword)
      await user.save()
      await revokeSessions(user.id, req.sessionId)
      await recordSecurity({
        userId: user.id,
        type: 'password-changed',
        summary: 'Password was changed.',
        ...requestAudit(req),
      })
      await rotateRefresh(req, res)
      res.status(204).send()
    }),
  )

  router.delete(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      await requireFreshStepUp(req.sessionId)
      await deleteAccount(userId)
      clearSession(res)
      res.status(204).send()
    }),
  )

  router.patch(
    '/sessions/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = parseBody(sessionRenameSchema, req.body)
      const session = await renameSession(currentUserId(req), req.params.id, input.name)
      if (!session) throw new HttpError(404, 'Session not found.')
      await recordSecurity({
        userId: currentUserId(req),
        type: 'session-renamed',
        summary: `A session was renamed to ${input.name}.`,
        ...requestAudit(req),
      })
      res.json({ id: session.id, device: session.deviceName })
    }),
  )

  return router
}
