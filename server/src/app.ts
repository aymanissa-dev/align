import express, { type Express } from 'express'
import rateLimit from 'express-rate-limit'
import { connectDb } from './db.ts'
import { errorHandler } from './middleware.ts'
import { authRouter } from './routes/auth.ts'
import { dashboardRouter } from './routes/dashboard.ts'
import { notesRouter } from './routes/notes.ts'
import { projectsRouter } from './routes/projects.ts'
import { searchRouter } from './routes/search.ts'
import { tasksRouter } from './routes/tasks.ts'
import './types.ts'

export type AppOptions = {
  authRateLimitMax?: number
}

export function createApp(options: AppOptions = {}): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(express.json({ limit: '1mb' }))
  app.use((req, _res, next) => {
    if (req.method === 'POST' && req.path === '/api/auth/logout') {
      next()
      return
    }
    connectDb().then(() => next(), next)
  })

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: options.authRateLimitMax ?? (process.env.NODE_ENV === 'production' ? 20 : 1000),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Try again later.' },
  })

  app.use('/api/auth', authRouter(authLimiter))
  app.use('/api/projects', projectsRouter())
  app.use('/api/tasks', tasksRouter())
  app.use('/api/notes', notesRouter())
  app.use('/api/dashboard', dashboardRouter())
  app.use('/api/search', searchRouter())

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' })
  })
  app.use(errorHandler)
  return app
}
