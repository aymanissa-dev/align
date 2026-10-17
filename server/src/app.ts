import compression from 'compression'
import express, { type Express } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import mongoose from 'mongoose'
import type { HealthReport } from '../../shared/contract.ts'
import { connectDb } from './db.ts'
import { privateRevalidate } from './httpCache.ts'
import { errorHandler } from './middleware.ts'
import { guardOrigin } from './security.ts'
import { APP_VERSION, MINIMUM_CLIENT_VERSION } from './version.ts'
import { authRouter } from './routes/auth.ts'
import { dashboardRouter } from './routes/dashboard.ts'
import { labelsRouter } from './routes/labels.ts'
import { notesRouter } from './routes/notes.ts'
import { notificationsRouter } from './routes/notifications.ts'
import { projectsRouter } from './routes/projects.ts'
import { searchRouter } from './routes/search.ts'
import { tasksRouter } from './routes/tasks.ts'
import { todayRouter } from './routes/today.ts'
import './types.ts'

export type AppOptions = {
  authRateLimitMax?: number
}

export function createApp(options: AppOptions = {}): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  )
  app.use(compression())
  app.use(privateRevalidate())
  app.use(express.json({ limit: '1mb' }))
  app.use(guardOrigin)
  app.use((_req, res, next) => {
    res.setHeader('X-Align-Minimum', String(MINIMUM_CLIENT_VERSION))
    next()
  })
  app.get('/api/version', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ version: APP_VERSION, minimum: MINIMUM_CLIENT_VERSION })
  })
  app.get('/api/health', (_req, res) => {
    const started = Date.now()
    connectDb()
      .then(async () => {
        const db = mongoose.connection.db
        if (!db) throw new Error('Database is not connected.')
        await db.command({ ping: 1 })
      })
      .then(() => {
        const body: HealthReport = { ok: true, db: 'up', latencyMs: Date.now() - started }
        res.json(body)
      })
      .catch(() => {
        const body: HealthReport = { ok: false, db: 'down', latencyMs: Date.now() - started }
        res.status(503).json(body)
      })
  })
  app.use((req, _res, next) => {
    const logout = req.method === 'POST' && req.path === '/api/auth/logout'
    connectDb().then(
      () => next(),
      (error: unknown) => {
        if (logout) next()
        else next(error)
      },
    )
  })

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: options.authRateLimitMax ?? 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Try again later.' },
  })

  app.use('/api/auth', authRouter(authLimiter))
  app.use('/api/labels', labelsRouter())
  app.use('/api/projects', projectsRouter())
  app.use('/api/tasks', tasksRouter())
  app.use('/api/notes', notesRouter())
  app.use('/api/notifications', notificationsRouter())
  app.use('/api/dashboard', dashboardRouter())
  app.use('/api/today', todayRouter())
  app.use('/api/search', searchRouter())

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' })
  })
  app.use(errorHandler)
  return app
}
