import { createHash } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { describe, expect, it } from 'vitest'
import { isRole, roleAtLeast } from '../src/authz.ts'
import { csrfProtection } from '../src/csrf.ts'
import { assertPasswordNotBreached } from '../src/hibp.ts'
import { signJwt, verifyJwt } from '../src/keys.ts'
import { isMediumPassword } from '../src/passwordPolicy.ts'
import { enforceAuthLimit } from '../src/rateLimit.ts'
import { RateLimit } from '../src/models.ts'
import { coarseIp, deviceLabel, sessionExpired, stepUpFresh } from '../src/session.ts'
import { generateRecoveryCodes, generateTotpSecret, totpAt, verifyTotp } from '../src/totp.ts'

describe('auth units', () => {
  it('accepts the current signing key and a previous kid', () => {
    const token = signJwt({ sub: 'user-1', typ: 'access' }, '15m')
    const header = jwt.decode(token, { complete: true })
    expect(header && typeof header === 'object' ? header.header.kid : '').toBe('current')
    expect(verifyJwt(token)?.sub).toBe('user-1')

    process.env.JWT_SECRET_PREVIOUS = 'previous-secret-value'
    process.env.JWT_KID_PREVIOUS = 'previous'
    const older = jwt.sign({ sub: 'user-2', typ: 'access' }, 'previous-secret-value', {
      algorithm: 'HS256',
      header: { kid: 'previous', alg: 'HS256' },
    })
    expect(verifyJwt(older)?.sub).toBe('user-2')
    expect(verifyJwt(`${token}x`)).toBeNull()
    delete process.env.JWT_SECRET_PREVIOUS
    delete process.env.JWT_KID_PREVIOUS
  })

  it('verifies TOTP inside the window and issues ten recovery codes', () => {
    const secret = generateTotpSecret()
    const counter = Math.floor(Date.now() / 1000 / 30)
    expect(verifyTotp(secret, totpAt(secret, counter))).toBe(true)
    expect(verifyTotp(secret, totpAt(secret, counter - 1))).toBe(true)
    expect(verifyTotp(secret, '000000')).toBe(false)
    expect(verifyTotp(secret, 'abcdef')).toBe(false)
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    expect(codes[0]).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/)
  })

  it('rejects a breached password and fails open when HIBP is down', async () => {
    const password = 'horse battery staple'
    const digest = createHash('sha1').update(password).digest('hex').toUpperCase()
    const breached = async () => new Response(`${digest.slice(5)}:4\n0123456789ABCDEF0123456789ABCDE0:1\n`, { status: 200 })
    await expect(assertPasswordNotBreached(password, breached as typeof fetch)).rejects.toThrow(/data breach/)

    const clean = async () => new Response('0123456789ABCDEF0123456789ABCDE0:1\n', { status: 200 })
    await expect(assertPasswordNotBreached(password, clean as typeof fetch)).resolves.toBeUndefined()
    await expect(assertPasswordNotBreached(password, (async () => new Response('', { status: 503 })) as typeof fetch)).resolves.toBeUndefined()
    await expect(assertPasswordNotBreached(password, (async () => {
      throw new Error('network')
    }) as typeof fetch)).resolves.toBeUndefined()
  })

  it('ranks workspace roles and keeps the password strength rules', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true)
    expect(roleAtLeast('viewer', 'member')).toBe(false)
    expect(roleAtLeast('member', 'member')).toBe(true)
    expect(isRole('admin')).toBe(true)
    expect(isRole('guest')).toBe(false)
    expect(isMediumPassword('password12')).toBe(true)
    expect(isMediumPassword('short')).toBe(false)
  })

  it('coarsens addresses and expires idle or absolute sessions', () => {
    expect(coarseIp('203.0.113.9')).toBe('203.0.113.0/24')
    expect(coarseIp('::ffff:203.0.113.9')).toBe('203.0.113.0/24')
    expect(coarseIp('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64')
    expect(deviceLabel('Mozilla/5.0 Chrome/120.0 Linux')).toBe('Chrome on Linux')
    const fresh = new Date()
    expect(sessionExpired({ expiresAt: new Date(Date.now() + 60_000), lastSeenAt: fresh })).toBe(false)
    expect(sessionExpired({ expiresAt: new Date(Date.now() - 1), lastSeenAt: fresh })).toBe(true)
    expect(sessionExpired({ expiresAt: new Date(Date.now() + 60_000), lastSeenAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) })).toBe(true)
    expect(stepUpFresh(new Date())).toBe(true)
    expect(stepUpFresh(new Date(Date.now() - 11 * 60 * 1000))).toBe(false)
    expect(stepUpFresh(null)).toBe(false)
  })

  it('requires the double-submit token once the cookie exists', async () => {
    const first = await invokeCsrf({ method: 'POST', path: '/api/projects', headers: {} })
    expect(first.next).toBe(true)

    const blocked = await invokeCsrf({
      method: 'POST',
      path: '/api/projects',
      headers: { cookie: 'csrf=abc' },
      header: '',
    })
    expect(blocked.statusCode).toBe(403)

    const allowed = await invokeCsrf({
      method: 'POST',
      path: '/api/projects',
      headers: { cookie: 'csrf=abc' },
      header: 'abc',
    })
    expect(allowed.next).toBe(true)

    const read = await invokeCsrf({ method: 'GET', path: '/api/projects', headers: { cookie: 'csrf=abc' } })
    expect(read.next).toBe(true)
  })

  it('limits an address that is already over the production cap', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`
    await RateLimit.create({
      key: `login:ip:${ip}`,
      count: 10,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await expect(enforceAuthLimit('login', ip, 'person@align.test')).rejects.toMatchObject({ status: 429 })
    } finally {
      process.env.NODE_ENV = previous
    }
  })
})

function invokeCsrf(input: { method: string; path: string; headers: { cookie?: string }; header?: string }): Promise<{
  next?: boolean
  statusCode?: number
}> {
  return new Promise((resolve) => {
    const req = {
      method: input.method,
      path: input.path,
      headers: input.headers,
      get(name: string) {
        return name.toLowerCase() === 'x-csrf-token' ? input.header : undefined
      },
    }
    const res = {
      statusCode: 200,
      cookie() {
        return res
      },
      status(code: number) {
        this.statusCode = code
        return this
      },
      json() {
        resolve({ statusCode: res.statusCode })
      },
    }
    csrfProtection(req as never, res as never, () => resolve({ next: true }))
  })
}
