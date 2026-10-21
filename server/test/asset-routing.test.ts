import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

describe('asset routing', () => {
  it('answers a missing hashed file with a plain 404 instead of the app shell', () => {
    const config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')) as {
      rewrites: { source: string; destination: string; statusCode?: number }[]
      headers: { source: string; headers: { key: string; value: string }[] }[]
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
    const missingHeaders = config.headers.find((rule) => rule.source === '/asset-missing.txt')
    expect(missingHeaders?.headers.some((header) => header.value === 'no-store')).toBe(true)
    expect(missingHeaders?.headers.some((header) => header.value.includes('text/plain'))).toBe(true)
  })
})
