import type { RequestHandler } from 'express'

const EXTRA_ORIGINS = new Set([
  'https://align-hazel-kappa.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

function originOf(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function allowed(origin: string, host: string | undefined): boolean {
  if (EXTRA_ORIGINS.has(origin)) return true
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Same-origin and known app origins may call the API. Requests without an Origin still pass. */
export const guardOrigin: RequestHandler = (req, res, next) => {
  const header = req.headers.origin
  const origin = typeof header === 'string' && header !== 'null' ? header : ''
  res.setHeader('Access-Control-Expose-Headers', 'X-Next-Cursor')
  if (origin) {
    if (!allowed(origin, req.get('host'))) {
      res.status(403).json({ error: 'Origin is not allowed.' })
      return
    }
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type')
    res.status(204).end()
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const referer = req.get('referer')
    const source = origin || (referer ? originOf(referer) : '')
    if (source && !allowed(source, req.get('host'))) {
      res.status(403).json({ error: 'Origin is not allowed.' })
      return
    }
  }
  next()
}
