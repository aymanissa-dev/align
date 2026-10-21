import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

describe('asset routing', () => {
  it('answers a missing hashed file with a plain 404 instead of the app shell', () => {
    const config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')) as {
      rewrites: { source: string; destination: string; statusCode?: number }[]
      routes: { handle?: string; src?: string; headers?: Record<string, string>; continue?: boolean }[]
    }
    const shell = config.rewrites.findIndex((rewrite) => rewrite.destination === '/index.html')
    const missing = config.rewrites.findIndex((rewrite) => rewrite.destination === '/asset-missing.txt')
    expect(missing).toBeGreaterThanOrEqual(0)
    expect(shell).toBeGreaterThan(missing)
    const assetRewrite = config.rewrites[missing]
    expect(assetRewrite?.source).toBe('/assets/(.*)')
    expect(assetRewrite?.statusCode).toBe(404)
    expect(config.rewrites[shell]?.source).toContain('(?!assets/)')
    const body = readFileSync(resolve(root, 'client/public/asset-missing.txt'), 'utf8')
    expect(body.trim()).toBe('Not found')
    expect(body.toLowerCase()).not.toContain('<html')
    const hit = config.routes.findIndex((route) => route.handle === 'hit')
    expect(hit).toBeGreaterThan(0)
    const immutable = config.routes.findIndex(
      (route) => route.src === '^/assets/(.*)$' && route.headers?.['Cache-Control']?.includes('immutable'),
    )
    expect(immutable).toBeGreaterThan(hit)
    expect(config.routes.slice(0, hit).some((route) => route.headers?.['Cache-Control']?.includes('immutable'))).toBe(false)
    const plain = config.routes.find((route) => route.src === '^/asset-missing\\.txt$')
    expect(plain?.headers?.['Cache-Control']).toBe('no-store')
    expect(plain?.headers?.['Content-Type']).toContain('text/plain')
    expect(config.routes.indexOf(plain!)).toBeLessThan(hit)
  })
})
