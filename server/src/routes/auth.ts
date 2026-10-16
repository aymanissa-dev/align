import { randomBytes } from 'node:crypto'
import { Router, type Request, type RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import { HttpError } from '../errors.ts'
import { deliverMail } from '../mail.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Activity, AuthToken, Label, Note, Notification, Project, Session, Task, User, Whiteboard } from '../models.ts'
import { checkPassword, dummyPasswordHash, hashPassword } from '../password.ts'
import { enforceAuthLimit } from '../rateLimit.ts'
import { publicUser } from '../serialize.ts'
import {
  accessFromRequest,
  clearSession,
  deviceLabel,
  revokeRefreshCookie,
  rotateRefresh,
  startSession,
} from '../session.ts'
import { consumeAuthToken, issueAuthToken } from '../tokens.ts'
import {
  forgotSchema,
  loginSchema,
  parseBody,
  passwordSchema,
  profileSchema,
  registerSchema,
  resetSchema,
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
      const existing = await User.findOne({ email: input.email })
      if (existing) throw new HttpError(409, 'An account with this email already exists.')
      const user = await User.create({
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        emailVerifiedAt: null,
      })
      const verifyToken = await issueAuthToken(user.id, 'verify')
      const link = `${appOrigin(req)}/verify?token=${encodeURIComponent(verifyToken)}`
      const mailed = await sendOrReveal(
        user.email,
        'Verify your Align email',
        `Confirm your email by opening this link within 24 hours:\n${link}`,
      )
      await startSession(res, user.id, req.get('user-agent'))
      res.status(201).json(mailed ? publicUser(user) : { ...publicUser(user), verifyToken })
    }),
  )

  router.post(
    '/login',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(loginSchema, req.body)
      await enforceAuthLimit('login', clientIp(req), input.email)
      const user = await User.findOne({ email: input.email }).select('+passwordHash')
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
        }
        throw new HttpError(401, 'Email or password is incorrect.')
      }
      if (user.failedLogins || user.lockUntil) {
        user.failedLogins = 0
        user.lockUntil = null
        await user.save()
      }
      await startSession(res, user.id, req.get('user-agent'))
      res.json(publicUser(user))
    }),
  )

  router.get(
    '/session',
    asyncHandler(async (req, res) => {
      const access = accessFromRequest(req)
      if (access) {
        const session = await Session.findById(access.sid)
        const current =
          session &&
          !session.revokedAt &&
          !session.replacedBy &&
          session.expiresAt.getTime() > Date.now() &&
          session.userId.toString() === access.userId
        if (current) {
          const user = await User.findById(access.userId)
          res.json({ user: user ? publicUser(user) : null })
          return
        }
      }
      const userId = await rotateRefresh(req, res)
      if (!userId) {
        res.json({ user: null })
        return
      }
      const user = await User.findById(userId)
      res.json({ user: user ? publicUser(user) : null })
    }),
  )

  router.post(
    '/refresh',
    asyncHandler(async (req, res) => {
      const userId = await rotateRefresh(req, res)
      if (!userId) throw new HttpError(401, 'Sign in to continue.')
      const user = await User.findById(userId)
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
      const user = await User.findOne({ email: input.email })
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
      const user = userId ? await User.findById(userId).select('+passwordHash') : null
      if (!user) throw new HttpError(400, 'This reset link is invalid or has expired.')
      user.passwordHash = await hashPassword(input.password)
      user.failedLogins = 0
      user.lockUntil = null
      await user.save()
      await Session.updateMany({ userId: user._id, revokedAt: null }, { revokedAt: new Date() })
      await startSession(res, user.id, req.get('user-agent'))
      res.json(publicUser(user))
    }),
  )

  router.post(
    '/verify',
    asyncHandler(async (req, res) => {
      const input = parseBody(verifySchema, req.body)
      const userId = await consumeAuthToken(input.token, 'verify')
      const user = userId ? await User.findById(userId) : null
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
      const user = await User.findById(currentUserId(req))
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
      const sessions = await Session.find({
        userId: currentUserId(req),
        revokedAt: null,
        replacedBy: null,
        expiresAt: { $gt: new Date() },
      })
        .select('userAgent lastSeenAt createdAt')
        .sort({ lastSeenAt: -1 })
        .lean()
      res.json(
        sessions.map((session) => ({
          id: session._id.toString(),
          current: session._id.toString() === req.sessionId,
          device: deviceLabel(session.userAgent || ''),
          lastSeenAt: session.lastSeenAt.toISOString(),
          createdAt: session.createdAt.toISOString(),
        })),
      )
    }),
  )

  router.delete(
    '/sessions/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const session = await Session.findOne({
        _id: req.params.id,
        userId: currentUserId(req),
        revokedAt: null,
      })
      if (!session || session.replacedBy) throw new HttpError(404, 'Session not found.')
      session.revokedAt = new Date()
      await session.save()
      if (session.id === req.sessionId) clearSession(res)
      res.status(204).send()
    }),
  )

  router.post(
    '/sessions/revoke-all',
    requireAuth,
    asyncHandler(async (req, res) => {
      await Session.updateMany({ userId: currentUserId(req), revokedAt: null }, { revokedAt: new Date() })
      clearSession(res)
      res.status(204).send()
    }),
  )

  router.get(
    '/google',
    asyncHandler(async (req, res) => {
      if (!googleConfigured()) throw new HttpError(404, 'Google sign-in is not configured.')
      const state = jwt.sign({ typ: 'google' }, process.env.JWT_SECRET ?? '', { expiresIn: '10m' })
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
        const payload = jwt.verify(state, process.env.JWT_SECRET ?? '')
        if (typeof payload === 'string' || payload.typ !== 'google' || !code) {
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
      let user = await User.findOne({ googleId: profile.sub })
      if (!user) user = await User.findOne({ email })
      if (user) {
        if (!user.googleId) user.googleId = profile.sub
        if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date()
        await user.save()
      } else {
        user = await User.create({
          name: (profile.name || email.split('@')[0] || 'Align').slice(0, 80),
          email,
          passwordHash: await hashPassword(randomBytes(32).toString('hex')),
          emailVerifiedAt: new Date(),
          googleId: profile.sub,
        })
      }
      await startSession(res, user.id, req.get('user-agent'))
      res.redirect('/')
    }),
  )

  router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await User.findById(currentUserId(req))
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      res.json(publicUser(user))
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
      const user = await User.findByIdAndUpdate(currentUserId(req), update, { new: true })
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      res.json(publicUser(user))
    }),
  )

  router.post(
    '/password',
    limiter,
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = parseBody(passwordSchema, req.body)
      const user = await User.findById(currentUserId(req)).select('+passwordHash')
      if (!user?.passwordHash) throw new HttpError(401, 'Sign in to continue.')
      const matches = await checkPassword(input.currentPassword, user.passwordHash)
      if (!matches) throw new HttpError(400, 'Current password is incorrect.')
      user.passwordHash = await hashPassword(input.newPassword)
      await user.save()
      await Session.updateMany(
        { userId: user._id, _id: { $ne: req.sessionId }, revokedAt: null },
        { revokedAt: new Date() },
      )
      await rotateRefresh(req, res)
      res.status(204).send()
    }),
  )

  router.delete(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      await Task.deleteMany({ userId })
      await Note.deleteMany({ userId })
      await Label.deleteMany({ userId })
      await Activity.deleteMany({ userId })
      await Notification.deleteMany({ userId })
      await Whiteboard.deleteMany({ userId })
      await Project.deleteMany({ userId })
      await Session.deleteMany({ userId })
      await AuthToken.deleteMany({ userId })
      await User.deleteOne({ _id: userId })
      clearSession(res)
      res.status(204).send()
    }),
  )

  return router
}
