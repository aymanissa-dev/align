import { describe, expect, it } from 'vitest'
import { resolveRequestUrl } from '../src/requestPath.ts'

const none = () => undefined

describe('resolveRequestUrl', () => {
  it('keeps an API path that is already complete', () => {
    expect(resolveRequestUrl('/api/auth/login?next=/', none)).toBe('/api/auth/login?next=/')
  })

  it('restores a nested path from the original-url header when the rewrite collapsed it', () => {
    expect(
      resolveRequestUrl('/api', (name) => (name === 'x-forwarded-uri' ? '/api/projects/abc/tasks' : undefined)),
    ).toBe('/api/projects/abc/tasks')
  })

  it('prefixes a path that had /api stripped', () => {
    expect(resolveRequestUrl('/auth/me?x=1', none)).toBe('/api/auth/me?x=1')
  })

  it('reads an absolute original URL', () => {
    expect(
      resolveRequestUrl('/', (name) =>
        name === 'x-original-url' ? 'https://align.example/api/notes/1' : undefined,
      ),
    ).toBe('/api/notes/1')
  })
})
