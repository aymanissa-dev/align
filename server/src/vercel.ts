import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApp } from './app.ts'
import { resolveRequestUrl } from './requestPath.ts'

const app = createApp()

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  req.url = resolveRequestUrl(req.url, (name) => {
    const value = req.headers[name]
    if (Array.isArray(value)) return value[0]
    return value
  })
  app(req, res)
}
