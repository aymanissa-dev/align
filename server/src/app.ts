import compression from 'compression'
import express, { type Express } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import mongoose from 'mongoose'
import type { HealthReport } from '../../shared/contract.ts'
import { csrfProtection } from './csrf.ts'
import { connectDb } from './db.ts'
import { FULL_WIPE } from './migrate/fullWipe.ts'

export function wipeFailure(error: unknown): { name: string; code: number | null; codeName: string | null; message: string } {
  const name = error instanceof Error ? error.name : 'Error'
  const raw = error instanceof Error ? error.message : 'failed'
  const message = raw
    .replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[redacted]')
    .replace(/\/\/[^/\s:@]+:[^@\s/]+@/g, '//[redacted]@')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .slice(0, 300)
  const record = typeof error === 'object' && error !== null ? error : {}
  const code = 'code' in record && typeof record.code === 'number' ? record.code : null
  const codeName = 'codeName' in record && typeof record.codeName === 'string' ? record.codeName.slice(0, 80) : null
  return { name, code, codeName, message }
}
import { markTiming } from './serverTiming.ts'
import { privateRevalidate } from './httpCache.ts'
import { errorHandler } from './middleware.ts'
import { guardOrigin } from './security.ts'
import { APP_VERSION, MINIMUM_CLIENT_VERSION } from './version.ts'
import { clientIp } from './clientIp.ts'
import { AUTH_ROUTE_LIMIT, authRouteStore } from './rateLimit.ts'
import { authRouter } from './routes/auth.ts'
import { dashboardRouter } from './routes/dashboard.ts'
import { labelsRouter } from './routes/labels.ts'
import { notesRouter } from './routes/notes.ts'
import { notificationsRouter } from './routes/notifications.ts'
import { projectsRouter } from './routes/projects.ts'
import { searchRouter } from './routes/search.ts'
import { tasksRouter } from './routes/tasks.ts'
import { mfaRouter } from './routes/mfa.ts'
import { todayRouter } from './routes/today.ts'
import { trashRouter } from './routes/trash.ts'
import { workspacesRouter } from './routes/workspaces.ts'
import './types.ts'

export type AppOptions = {
  authRateLimitMax?: number
}

export function createApp(options: AppOptions = {}): Express {
  const app = express()
  app.disable('x-powered-by')
  // One trusted hop so Express does not treat every forwarded entry as the
  // client. Per-IP limits use clientIp(), which reads Vercel's x-real-ip.
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
  app.use((req, res, next) => {
    const match = req.get('If-Match')
    if (match) res.set('ETag', match)
    next()
  })
  app.use(guardOrigin)
  app.use(csrfProtection)
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
        markTiming(res, 'db', Date.now() - started)
        const body: HealthReport = { ok: true, db: 'up' }
        res.json(body)
      })
      .catch(() => {
        const body: HealthReport = { ok: false, db: 'down' }
        res.setHeader('Retry-After', '5')
        res.status(503).json(body)
      })
  })
  app.get('/api/maintenance/wipe', (_req, res) => {
    connectDb()
      .then(async () => {
        const db = mongoose.connection.db
        if (!db) throw new Error('Database is not connected.')
        const record = await db.collection('migrations').findOne(
          { id: FULL_WIPE },
          { projection: { _id: 0, id: 1, appliedAt: 1, counts: 1 } },
        )
        const counts = record?.counts && typeof record.counts === 'object' ? record.counts : {}
        const numeric: Record<string, number> = {}
        for (const [key, value] of Object.entries(counts)) {
          if (typeof value === 'number') numeric[key] = value
        }
        res.json({
          id: FULL_WIPE,
          applied: Boolean(record),
          appliedAt: record?.appliedAt instanceof Date ? record.appliedAt.toISOString() : null,
          counts: numeric,
        })
      })
      .catch((error: unknown) => {
        res.status(503).json({
          id: FULL_WIPE,
          applied: false,
          appliedAt: null,
          counts: {},
          failure: wipeFailure(error),
        })
      })
  })
  app.use((req, res, next) => {
    const logout = req.method === 'POST' && req.path === '/api/auth/logout'
    const started = performance.now()
    connectDb().then(
      () => {
        markTiming(res, 'db', performance.now() - started)
        next()
      },
      (error: unknown) => {
        markTiming(res, 'db', performance.now() - started)
        if (logout) next()
        else next(error)
      },
    )
  })

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: options.authRateLimitMax ?? (process.env.NODE_ENV === 'production' ? AUTH_ROUTE_LIMIT : 1000),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => clientIp(req),
    store: authRouteStore(),
    message: { error: 'Too many attempts. Try again later.' },
  })

  const auth = authRouter(authLimiter)
  auth.use(mfaRouter())
  app.use('/api/auth', auth)
  app.use('/api/workspaces', workspacesRouter())
  app.use('/api/trash', trashRouter())
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
