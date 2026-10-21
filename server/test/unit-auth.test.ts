import { createHash } from 'node:crypto'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { isRole, roleAtLeast } from '../src/authz.ts'
import { csrfProtection } from '../src/csrf.ts'
import { assertPasswordNotBreached, HIBP_TIMEOUT_MS, noteBreachedPassword, passwordIsBreached } from '../src/hibp.ts'
import { signJwt, verifyJwt } from '../src/keys.ts'
import { isMediumPassword } from '../src/passwordPolicy.ts'
import { HttpError } from '../src/errors.ts'
import { clientIp } from '../src/clientIp.ts'
import { authRouteStore, bucketStart, clearLoginFailures, enforceAuthLimit, guardLogin, recordLoginFailure, recordLoginSuccess, REGISTER_DAY_MS, REGISTER_WINDOW_MS, WINDOW_MS } from '../src/rateLimit.ts'
import { RateLimit, SecurityEvent } from '../src/models.ts'
import { accessFromRequest, coarseIp, deviceLabel, sessionExpired, stepUpFresh } from '../src/session.ts'
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
    expect(verifyJwt('eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4IiwidHlwIjoiYWNjZXNzIn0.')).toBeNull()
    delete process.env.JWT_SECRET_PREVIOUS
    delete process.env.JWT_KID_PREVIOUS

    const claimed = signJwt({ sub: 'user-1', sid: 'sess-1', typ: 'access', wid: 'ws-1', role: 'member', mv: 4 }, '15m')
    expect(accessFromRequest({ headers: { cookie: `token=${claimed}` } } as never)).toMatchObject({
      userId: 'user-1',
      sid: 'sess-1',
      workspaceId: 'ws-1',
      role: 'member',
      membershipVersion: 4,
    })
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
    expect(HIBP_TIMEOUT_MS).toBe(1_500)
    const slow = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')))
      })) as typeof fetch
    await expect(passwordIsBreached(password, slow, 40)).resolves.toBe(false)

    const userId = crypto.randomUUID().replace(/-/g, '').slice(0, 24)
    const again = createHash('sha1').update(password).digest('hex').toUpperCase()
    const breachedFetch = (async () => new Response(`${again.slice(5)}:4\n`, { status: 200 })) as typeof fetch
    await noteBreachedPassword(userId, password, breachedFetch)
    const events = await SecurityEvent.find({ userId, type: 'password-breached' })
    expect(events).toHaveLength(1)
    expect(events[0]?.summary).toContain('Change your password')
    await noteBreachedPassword(userId, password, breachedFetch)
    expect(await SecurityEvent.countDocuments({ userId, type: 'password-breached' })).toBe(1)
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

  it('reads the Vercel client address and ignores a spoofed forwarded header off the platform', () => {
    const previous = process.env.VERCEL
    const previousEnv = process.env.VERCEL_ENV
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    const spoofed = {
      get(name: string) {
        const headers: Record<string, string> = { 'x-real-ip': '203.0.113.50', 'x-forwarded-for': '198.51.100.8, 10.0.0.2' }
        return headers[name.toLowerCase()]
      },
      socket: { remoteAddress: '127.0.0.1' },
    }
    expect(clientIp(spoofed)).toBe('127.0.0.1')
    process.env.VERCEL_ENV = 'production'
    expect(clientIp(spoofed)).toBe('203.0.113.50')
    delete process.env.VERCEL_ENV
    process.env.VERCEL = '1'
    try {
      expect(clientIp(spoofed)).toBe('203.0.113.50')
      expect(
        clientIp({
          get(name: string) {
            return name.toLowerCase() === 'x-forwarded-for' ? '2001:db8::1, 10.0.0.2' : undefined
          },
          socket: { remoteAddress: '10.0.0.8' },
        }),
      ).toBe('2001:db8::1')
      expect(
        clientIp({
          get(name: string) {
            return name.toLowerCase() === 'x-real-ip' ? '::ffff:203.0.113.10' : '198.51.100.1'
          },
          socket: { remoteAddress: '10.0.0.8' },
        }),
      ).toBe('203.0.113.10')
    } finally {
      if (previous === undefined) delete process.env.VERCEL
      else process.env.VERCEL = previous
      if (previousEnv === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = previousEnv
    }
  })

  it('shares the auth route counter across store instances', async () => {
    const first = authRouteStore()
    const second = authRouteStore()
    first.init({ windowMs: 60_000 })
    second.init({ windowMs: 60_000 })
    expect((await first.increment('203.0.113.20')).totalHits).toBe(1)
    expect((await second.increment('203.0.113.20')).totalHits).toBe(2)
    await first.decrement('203.0.113.20')
    expect((await second.increment('203.0.113.20')).totalHits).toBe(2)
    await second.resetKey('203.0.113.20')
    expect((await first.increment('203.0.113.20')).totalHits).toBe(1)
    expect(await RateLimit.findOne({ key: 'auth-route:203.0.113.20' })).toBeTruthy()
  })

  it('caps registration at 5 per hour and 20 per day for one IP', async () => {
    const hourIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`
    const dayIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`
    const otherIp = `192.0.2.${Math.floor(Math.random() * 200) + 1}`
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(await enforceAuthLimit('register', hourIp, `hour-${attempt}@align.test`)).toBe(attempt + 1)
      }
      await expect(enforceAuthLimit('register', hourIp, 'someone-else@align.test')).rejects.toMatchObject({ status: 429 })
      expect(await RateLimit.findOne({ key: 'register:email:someone-else@align.test' })).toBeNull()
      expect(await enforceAuthLimit('register', otherIp, 'someone-else@align.test')).toBe(1)

      await RateLimit.create({
        key: `register:ip:${dayIp}:day`,
        windowStart: bucketStart(REGISTER_DAY_MS),
        count: 20,
        expiresAt: new Date(bucketStart(REGISTER_DAY_MS) + REGISTER_DAY_MS),
      })
      await expect(enforceAuthLimit('register', dayIp, 'day@align.test')).rejects.toMatchObject({ status: 429 })
      expect(await RateLimit.findOne({ key: 'register:email:day@align.test' })).toBeNull()
    } finally {
      process.env.NODE_ENV = previous
    }
  })

  it('keeps the per-IP register window at 60 minutes', async () => {
    const previous = process.env.NODE_ENV
    const previousVercel = process.env.VERCEL
    process.env.NODE_ENV = 'production'
    process.env.VERCEL = '1'
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response('', { status: 200 })) as typeof fetch
    const realNow = Date.now
    const hourStart = Math.floor(realNow() / REGISTER_WINDOW_MS) * REGISTER_WINDOW_MS
    const now = hourStart + 30 * 60 * 1000
    Date.now = () => now
    try {
      const app = createApp()
      const ip = '203.0.113.61'
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const created = await request(app)
          .post('/api/auth/register')
          .set('x-real-ip', ip)
          .send({ name: 'Hour', email: `hour-${attempt}-${crypto.randomUUID()}@align.test`, password: 'password12' })
        expect(created.status).toBe(201)
      }
      const blocked = await request(app)
        .post('/api/auth/register')
        .set('x-real-ip', ip)
        .send({ name: 'Hour', email: `hour-blocked-${crypto.randomUUID()}@align.test`, password: 'password12' })
      expect(blocked.status).toBe(429)
      expect(blocked.headers['retry-after']).toBe('1800')
      expect(blocked.headers['ratelimit-reset']).toBe('1800')
      const doc = await RateLimit.findOne({ key: `register:ip:${ip}`, windowStart: hourStart })
      expect(doc?.expiresAt.getTime()).toBe(hourStart + REGISTER_WINDOW_MS)
      expect((doc?.expiresAt.getTime() ?? 0) - (doc?.windowStart ?? 0)).toBe(60 * 60 * 1000)
    } finally {
      Date.now = realNow
      globalThis.fetch = original
      process.env.NODE_ENV = previous
      if (previousVercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = previousVercel
    }
  })

  it('shares a 20-per-hour register bucket across one IPv4 /24 and one IPv6 /64', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      for (let host = 1; host <= 20; host += 1) {
        expect(await enforceAuthLimit('register', `203.0.113.${host}`, `net-${host}@align.test`)).toBe(1)
      }
      await expect(enforceAuthLimit('register', '203.0.113.21', 'net-over@align.test')).rejects.toMatchObject({
        status: 429,
        headers: { 'Retry-After': expect.any(String) },
      })
      const subnet = await RateLimit.findOne({ key: 'register:net:203.0.113.0/24' })
      expect(subnet?.count).toBe(21)
      expect((subnet?.expiresAt.getTime() ?? 0) - (subnet?.windowStart ?? 0)).toBe(REGISTER_WINDOW_MS)
      expect(await enforceAuthLimit('register', '198.51.100.21', 'other-net@align.test')).toBe(1)

      expect(await enforceAuthLimit('register', '2001:db8:1:2::10', 'v6-a@align.test')).toBe(1)
      expect(await enforceAuthLimit('register', '2001:db8:1:2::20', 'v6-b@align.test')).toBe(1)
      expect((await RateLimit.findOne({ key: 'register:net:2001:db8:1:2::/64' }))?.count).toBe(2)
      expect(await enforceAuthLimit('register', '2001:db8:9:9::1', 'v6-other@align.test')).toBe(1)
    } finally {
      process.env.NODE_ENV = previous
    }
  })

  it('stops registration globally after 200 attempts in an hour', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    const start = bucketStart(REGISTER_WINDOW_MS)
    try {
      await RateLimit.create({
        key: 'register:global',
        windowStart: start,
        count: 200,
        expiresAt: new Date(start + REGISTER_WINDOW_MS),
      })
      try {
        await enforceAuthLimit('register', '192.0.2.40', 'global@align.test')
        throw new Error('expected the global register cap to reject the attempt')
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError)
        const limited = error as HttpError
        expect(limited.status).toBe(429)
        const retryAfter = Number(limited.headers['Retry-After'])
        expect(retryAfter).toBeGreaterThan(0)
        expect(retryAfter).toBeLessThanOrEqual(60 * 60)
        const doc = await RateLimit.findOne({ key: 'register:global', windowStart: start })
        expect(doc?.count).toBe(201)
        expect((doc?.expiresAt.getTime() ?? 0) - start).toBe(REGISTER_WINDOW_MS)
      }
    } finally {
      process.env.NODE_ENV = previous
    }
  })

  it('limits an address that is already over the production cap', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`
    await RateLimit.create({
      key: `login:ip:${ip}`,
      windowStart: bucketStart(WINDOW_MS),
      count: 10,
      expiresAt: new Date(bucketStart(WINDOW_MS) + WINDOW_MS),
    })
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await expect(enforceAuthLimit('login', ip, 'person@align.test')).rejects.toMatchObject({ status: 429 })
    } finally {
      process.env.NODE_ENV = previous
    }
  })

  it('lets thirty successful sign-ins through without touching the failure lock', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`
    const email = `ok-${crypto.randomUUID()}@align.test`
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await guardLogin(ip, email)
        await recordLoginSuccess(ip, email)
      }
      expect(await RateLimit.findOne({ key: `login:fail:email:${email}` })).toBeNull()
      expect(await RateLimit.findOne({ key: `login:fail:ip:${ip}` })).toBeNull()
      try {
        await guardLogin(ip, email)
        throw new Error('expected the per-minute success budget to reject one more sign-in')
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError)
        const limited = error as HttpError
        expect(limited.status).toBe(429)
        const retryAfter = Number(limited.headers['Retry-After'])
        expect(retryAfter).toBeGreaterThan(0)
        expect(retryAfter).toBeLessThanOrEqual(60)
      }
    } finally {
      process.env.NODE_ENV = previous
    }
  })

  it('locks an address after repeated failed sign-ins', async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`
    const email = `fail-${crypto.randomUUID()}@align.test`
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await guardLogin(ip, email)
        expect(await recordLoginFailure(ip, email)).toBe(attempt + 1)
      }
      try {
        await guardLogin(ip, email)
        throw new Error('expected the failure window to reject the next sign-in')
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError)
        const locked = error as HttpError
        expect(locked.status).toBe(429)
        const retryAfter = Number(locked.headers['Retry-After'])
        expect(retryAfter).toBeGreaterThan(0)
        expect(retryAfter).toBeLessThanOrEqual(15 * 60)
      }
    } finally {
      process.env.NODE_ENV = previous
    }
  })

  it('clears the per-email failure counter after a successful sign-in', async () => {
    const ip = `192.0.2.${Math.floor(Math.random() * 200) + 1}`
    const ip2 = `192.0.2.${Math.floor(Math.random() * 50) + 201}`
    const email = `reset-${crypto.randomUUID()}@align.test`
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      for (let attempt = 0; attempt < 9; attempt += 1) await recordLoginFailure(ip, email)
      await clearLoginFailures(email)
      expect(await RateLimit.findOne({ key: `login:fail:email:${email}` })).toBeNull()
      expect((await RateLimit.findOne({ key: `login:fail:ip:${ip}` }))?.count).toBe(9)
      await guardLogin(ip, email)
      for (let attempt = 0; attempt < 9; attempt += 1) {
        await guardLogin(ip2, email)
        await recordLoginFailure(ip2, email)
      }
      expect((await RateLimit.findOne({ key: `login:fail:email:${email}` }))?.count).toBe(9)
      await guardLogin(ip2, email)
      await recordLoginFailure(ip2, email)
      await expect(guardLogin(ip2, email)).rejects.toMatchObject({ status: 429 })
    } finally {
      process.env.NODE_ENV = previous
    }
  })

  it('sets Retry-After to the remaining per-email window', async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`
    const email = `window-${crypto.randomUUID()}@align.test`
    await RateLimit.create({
      key: `login:email:${email}`,
      windowStart: bucketStart(WINDOW_MS),
      count: 10,
      expiresAt: new Date(bucketStart(WINDOW_MS) + WINDOW_MS),
    })
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await enforceAuthLimit('login', ip, email)
      throw new Error('expected the per-email window to reject the attempt')
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      const locked = error as HttpError
      expect(locked.status).toBe(429)
      const retryAfter = Number(locked.headers['Retry-After'])
      expect(retryAfter).toBeGreaterThan(0)
      expect(retryAfter).toBeLessThanOrEqual(15 * 60)
    } finally {
      process.env.NODE_ENV = previous
    }
  })

  it('shares the register cap across two app instances', async () => {
    const previous = process.env.NODE_ENV
    const previousVercel = process.env.VERCEL
    process.env.NODE_ENV = 'production'
    process.env.VERCEL = '1'
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response('', { status: 200 })) as typeof fetch
    try {
      const first = createApp()
      const second = createApp()
      const ip = '203.0.113.77'
      let remaining = 60
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const created = await request(attempt % 2 === 0 ? first : second)
          .post('/api/auth/register')
          .set('x-real-ip', ip)
          .set('x-forwarded-for', '198.51.100.77')
          .send({
            name: 'Cap',
            email: `cap-${attempt}-${crypto.randomUUID()}@align.test`,
            password: 'password12',
          })
        expect(created.status).toBe(201)
        const nextRemaining = Number(created.headers['ratelimit-remaining'])
        expect(nextRemaining).toBe(remaining - 1)
        remaining = nextRemaining
      }
      const blocked = await request(second)
        .post('/api/auth/register')
        .set('x-real-ip', ip)
        .set('x-forwarded-for', '198.51.100.77')
        .send({
          name: 'Cap',
          email: `cap-blocked-${crypto.randomUUID()}@align.test`,
          password: 'password12',
        })
      expect(blocked.status).toBe(429)
      expect(blocked.body).toEqual({ error: 'Too many attempts. Try again later.' })
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
      const other = await request(first)
        .post('/api/auth/register')
        .set('x-real-ip', '198.51.100.77')
        .send({
          name: 'Other',
          email: `cap-other-${crypto.randomUUID()}@align.test`,
          password: 'password12',
        })
      expect(other.status).toBe(201)
    } finally {
      globalThis.fetch = original
      process.env.NODE_ENV = previous
      if (previousVercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = previousVercel
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
