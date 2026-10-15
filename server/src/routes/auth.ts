import { Router, type RequestHandler } from 'express'
import { HttpError } from '../errors.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Activity, Label, Note, Notification, Project, Task, User } from '../models.ts'
import { checkPassword, dummyPasswordHash, hashPassword } from '../password.ts'
import { publicUser } from '../serialize.ts'
import { clearSession, setSession } from '../session.ts'
import { loginSchema, parseBody, passwordSchema, profileSchema, registerSchema } from '../validate.ts'

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
      await Project.deleteMany({ userId })
      await User.deleteOne({ _id: userId })
      clearSession(res)
      res.status(204).send()
    }),
  )

  return router
}
