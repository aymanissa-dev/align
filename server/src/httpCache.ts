import type { RequestHandler } from 'express'

/** Ask private caches to revalidate. Express still emits a weak ETag and answers 304. */
export function privateRevalidate(): RequestHandler {
  return (_req, res, next) => {
    const json = res.json.bind(res)
    res.json = (body) => {
      if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'private, no-cache')
      return json(body)
    }
    next()
  }
}
