import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express'
import { ZodError } from 'zod'
import { HttpError } from './errors.ts'
import { User } from './models.ts'
import { userIdFromRequest } from './session.ts'

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const userId = userIdFromRequest(req)
  if (!userId) {
    next(new HttpError(401, 'Sign in to continue.'))
    return
  }
  User.findById(userId)
    .then((user) => {
      if (!user) {
        next(new HttpError(401, 'Sign in to continue.'))
        return
      }
      req.userId = user.id
      next()
    })
    .catch(next)
}

export function currentUserId(req: Request): string {
  if (!req.userId) throw new HttpError(401, 'Sign in to continue.')
  return req.userId
}

function isRecord(error: unknown): error is Record<string, unknown> {
  return typeof error === 'object' && error !== null
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) return

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message })
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
    res.status(409).json({ error: 'An account with this email already exists.' })
    return
  }
  if (isRecord(error) && error.name === 'CastError') {
    res.status(404).json({ error: 'Not found.' })
    return
  }

  console.error(error)
  res.status(500).json({ error: 'Something went wrong. Try again.' })
}
