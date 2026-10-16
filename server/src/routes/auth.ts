import { createHash, randomBytes } from 'node:crypto'
import { Router, type RequestHandler } from 'express'
import { HttpError } from '../errors.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Activity, Label, Note, Notification, Project, Task, User, Whiteboard } from '../models.ts'
import { checkPassword, dummyPasswordHash, hashPassword } from '../password.ts'
import { publicUser } from '../serialize.ts'
import { clearSession, setSession, userIdFromRequest } from '../session.ts'
import { forgotSchema, loginSchema, parseBody, passwordSchema, profileSchema, registerSchema, resetSchema } from '../validate.ts'

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function authRouter(limiter: RequestHandler): Router {
  const router = Router()

  router.post(
    '/register',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(registerSchema, req.body)
      const existing = await User.findOne({ email: input.email })
      if (existing) throw new HttpError(409, 'An account with this email already exists.')
      const user = await User.create({
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
      })
      setSession(res, user.id)
      res.status(201).json(publicUser(user))
    }),
  )

  router.post(
    '/login',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(loginSchema, req.body)
      const user = await User.findOne({ email: input.email }).select('+passwordHash')
      const hash = user?.passwordHash ?? (await dummyPasswordHash())
      const matches = await checkPassword(input.password, hash)
      if (!user || !matches) throw new HttpError(401, 'Email or password is incorrect.')
      setSession(res, user.id)
      res.json(publicUser(user))
    }),
  )

  router.get(
    '/session',
    asyncHandler(async (req, res) => {
      const userId = userIdFromRequest(req)
      if (!userId) {
        res.json({ user: null })
        return
      }
      const user = await User.findById(userId)
      res.json({ user: user ? publicUser(user) : null })
    }),
  )

  router.post(
    '/forgot',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(forgotSchema, req.body)
      const user = await User.findOne({ email: input.email }).select('+resetTokenHash +resetTokenExpires')
      const body: { message: string; resetToken?: string } = {
        message: 'If an account exists for that email, a reset link is ready.',
      }
      if (user) {
        const resetToken = randomBytes(32).toString('hex')
        user.resetTokenHash = hashResetToken(resetToken)
        user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000)
        await user.save()
        if (!process.env.SMTP_HOST) body.resetToken = resetToken
      }
      res.json(body)
    }),
  )

  router.post(
    '/reset',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parseBody(resetSchema, req.body)
      const user = await User.findOne({
        resetTokenHash: hashResetToken(input.token),
        resetTokenExpires: { $gt: new Date() },
      }).select('+passwordHash +resetTokenHash +resetTokenExpires')
      if (!user) throw new HttpError(400, 'This reset link is invalid or has expired.')
      user.passwordHash = await hashPassword(input.password)
      user.set('resetTokenHash', undefined)
      user.set('resetTokenExpires', undefined)
      await user.save()
      setSession(res, user.id)
      res.json(publicUser(user))
    }),
  )

  router.post(
    '/logout',
    asyncHandler(async (_req, res) => {
      clearSession(res)
      res.status(204).send()
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
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      const matches = await checkPassword(input.currentPassword, user.passwordHash)
      if (!matches) throw new HttpError(400, 'Current password is incorrect.')
      user.passwordHash = await hashPassword(input.newPassword)
      await user.save()
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
      await User.deleteOne({ _id: userId })
      clearSession(res)
      res.status(204).send()
    }),
  )

  return router
}
