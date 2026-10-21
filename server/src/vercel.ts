import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApp } from './app.ts'
import { connectDb } from './db.ts'
import { resolveRequestUrl } from './requestPath.ts'

const app = createApp()
// Connect immediately, but wait to sync indexes until the first request has the pool.
void connectDb()
  .then(() => {
    const timer = setTimeout(() => {
      void connectDb({ indexes: true }).catch((error: unknown) => {
        console.error(error)
      })
    }, 15_000)
    timer.unref()
  })
  .catch((error: unknown) => {
    console.error(error)
  })

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  req.url = resolveRequestUrl(req.url, (name) => {
    const value = req.headers[name]
    if (Array.isArray(value)) return value[0]
    return value
  })
  app(req, res)
}
