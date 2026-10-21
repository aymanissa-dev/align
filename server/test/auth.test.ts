import { randomBytes } from 'node:crypto'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { RESET_MESSAGE, VERIFY_MESSAGE } from '../src/mailPolicy.ts'
import { upRevokeExposedTokens } from '../src/migrate/revokeExposedTokens.ts'
import { AuthToken, Project, User } from '../src/models.ts'
import { app, csrfToken, registerUser } from './helpers.ts'

describe('auth', () => {
  it('reports database health without requiring a session', async () => {
    const health = await request(app).get('/api/health')
    expect(health.status).toBe(200)
    expect(health.body).toEqual({ ok: true, db: 'up' })
  })

  it('answers 304 when a GET representation has not changed', async () => {
    const { agent } = await registerUser()
    const first = await agent.get('/api/projects')
    expect(first.status).toBe(200)
    const etag = first.headers.etag as string
    expect(etag).toBeTruthy()
    const second = await agent.get('/api/projects').set('If-None-Match', etag)
    expect(second.status).toBe(304)
  })

  it('publishes the minimum client version without waiting on the database', async () => {
    const version = await request(app).get('/api/version')
    expect(version.status).toBe(200)
    expect(version.body).toEqual({ version: 2, minimum: 2 })
    expect(version.headers['x-align-minimum']).toBe('2')
    expect(version.headers['cache-control']).toMatch(/no-store/i)
  })

  it('registers, reads the session, and logs out', async () => {
    const { agent, email } = await registerUser('Ada Lovelace')
    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body).toMatchObject({ name: 'Ada Lovelace', email })
    expect(me.body).not.toHaveProperty('passwordHash')
    expect(typeof me.body.createdAt).toBe('string')

    const logout = await agent.post('/api/auth/logout')
    expect(logout.status).toBe(204)
    const after = await agent.get('/api/auth/me')
    expect(after.status).toBe(401)
    expect(after.body).toEqual({ error: 'Sign in to continue.' })
  })

  it('sets an httpOnly cookie and adds Secure in production', async () => {
    const created = await request(app).post('/api/auth/register').send({
      name: 'Grace Hopper',
      email: `grace-${crypto.randomUUID()}@align.test`,
      password: 'password12',
    })
    expect(created.status).toBe(201)
    const cookie = created.headers['set-cookie']
    const list = Array.isArray(cookie) ? cookie : cookie ? [cookie] : []
    const token = list.find((entry) => entry.startsWith('token='))
    const csrf = list.find((entry) => entry.startsWith('csrf='))
    expect(token).toMatch(/HttpOnly/i)
    expect(token).toMatch(/SameSite=Lax/i)
    expect(token).not.toMatch(/Secure/i)
    expect(csrf).toBeTruthy()
    expect(csrf).not.toMatch(/HttpOnly/i)

    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const secure = await request(app).post('/api/auth/login').send({
        email: created.body.email,
        password: 'password12',
      })
      const secureCookies = secure.headers['set-cookie']
      const secureList = Array.isArray(secureCookies) ? secureCookies : secureCookies ? [secureCookies] : []
      expect(secureList.find((entry) => entry.startsWith('token='))).toMatch(/Secure/i)
    } finally {
      process.env.NODE_ENV = previous
    }
  })

  it('rejects duplicate emails, short passwords, and bad credentials', async () => {
    const email = `ada-${crypto.randomUUID()}@align.test`
    await registerUser('Ada', email)

    const duplicate = await request(app).post('/api/auth/register').send({
      name: 'Ada',
      email: email.toUpperCase(),
      password: 'password12',
    })
    expect(duplicate.status).toBe(409)

    const invalid = await request(app).post('/api/auth/register').send({
      name: 'Ada',
      email: 'not-an-email',
      password: 'short',
    })
    expect(invalid.status).toBe(400)

    const weak = await request(app).post('/api/auth/register').send({
      name: 'Ada',
      email: `weak-${crypto.randomUUID()}@align.test`,
      password: 'password1',
    })
    expect(weak.status).toBe(400)

    const mixed = await request(app).post('/api/auth/register').send({
      name: 'Ada',
      email: `mixed-${crypto.randomUUID()}@align.test`,
      password: 'Horse1!x',
    })
    expect(mixed.status).toBe(201)

    const wrong = await request(app).post('/api/auth/login').send({ email, password: 'password2' })
    expect(wrong.status).toBe(401)
    expect(wrong.body).toEqual({ error: 'Email or password is incorrect.' })
  })

  it('requires a session for the rest of the API', async () => {
    const response = await request(app).get('/api/projects')
    expect(response.status).toBe(401)
  })

  it('updates the profile, changes the password, and deletes the account', async () => {
    const { agent, email, password } = await registerUser()
    const project = await agent.post('/api/projects').send({ name: 'Private' })
    expect(project.status).toBe(201)

    const profile = await agent.patch('/api/auth/me').send({ name: 'Ada King' })
    expect(profile.status).toBe(200)
    expect(profile.body.name).toBe('Ada King')
    expect(profile.body.accent).toBe('#171717')

    const accent = await agent.patch('/api/auth/me').send({ accent: '#1D4ED8' })
    expect(accent.body.accent).toBe('#1d4ed8')
    expect(accent.body.name).toBe('Ada King')
    expect((await agent.patch('/api/auth/me').send({ accent: 'blue' })).status).toBe(400)
    expect((await agent.patch('/api/auth/me').send({})).status).toBe(400)

    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)
    const badPassword = await agent.post('/api/auth/password').send({
      currentPassword: 'nope',
      newPassword: 'password123',
    })
    expect(badPassword.status).toBe(400)

    const weakPassword = await agent.post('/api/auth/password').send({
      currentPassword: password,
      newPassword: 'password1',
    })
    expect(weakPassword.status).toBe(400)

    const changed = await agent.post('/api/auth/password').send({
      currentPassword: password,
      newPassword: 'password123',
    })
    expect(changed.status).toBe(204)

    const oldLogin = await request(app).post('/api/auth/login').send({ email, password })
    expect(oldLogin.status).toBe(401)
    const newLogin = await request(app).post('/api/auth/login').send({ email, password: 'password123' })
    expect(newLogin.status).toBe(200)

    const removed = await agent.delete('/api/auth/me').send({ password: 'password123' })
    expect(removed.status).toBe(204)
    expect(await Project.countDocuments({ _id: project.body.id })).toBe(0)
    const gone = await request(app).post('/api/auth/login').send({ email, password: 'password123' })
    expect(gone.status).toBe(401)
  })

  it('starts signed out without a 401 and resets a password with a token', async () => {
    const signedOut = await request(app).get('/api/auth/session')
    expect(signedOut.status).toBe(200)
    expect(signedOut.body).toEqual({ user: null })

    const email = `reset-${crypto.randomUUID()}@align.test`
    const registered = await request(app).post('/api/auth/register').send({
      name: 'Reset',
      email,
      password: 'password12',
    })
    expect(registered.status).toBe(201)
    const agent = request.agent(app)
    await agent.post('/api/auth/logout')

    const missing = await request(app).post('/api/auth/forgot').send({ email: 'nobody@align.test' })
    expect(missing.status).toBe(200)
    expect(missing.body.resetToken).toBeUndefined()

    const forgot = await request(app).post('/api/auth/forgot').send({ email })
    expect(forgot.status).toBe(200)
    expect(typeof forgot.body.resetToken).toBe('string')

    const bad = await request(app).post('/api/auth/reset').send({ token: forgot.body.resetToken, password: 'short' })
    expect(bad.status).toBe(400)

    const weakReset = await request(app).post('/api/auth/reset').send({
      token: forgot.body.resetToken,
      password: 'password1',
    })
    expect(weakReset.status).toBe(400)

    const reset = await request(app).post('/api/auth/reset').send({
      token: forgot.body.resetToken,
      password: 'password123',
    })
    expect(reset.status).toBe(200)
    expect(reset.body.email).toBe(email)

    const reused = await request(app).post('/api/auth/reset').send({
      token: forgot.body.resetToken,
      password: 'password3',
    })
    expect(reused.status).toBe(400)

    expect((await request(app).post('/api/auth/login').send({ email, password: 'password12' })).status).toBe(401)
    expect((await request(app).post('/api/auth/login').send({ email, password: 'password123' })).status).toBe(200)
  })

  it('rate-limits repeated auth attempts', async () => {
    const limited = createApp({ authRateLimitMax: 3 })
    const email = `limit-${crypto.randomUUID()}@align.test`
    const first = await request(limited).post('/api/auth/register').send({
      name: 'Limit',
      email,
      password: 'password12',
    })
    expect(first.status).toBe(201)
    expect((await request(limited).post('/api/auth/login').send({ email, password: 'nope' })).status).toBe(401)
    expect((await request(limited).post('/api/auth/login').send({ email, password: 'nope' })).status).toBe(401)
    const blocked = await request(limited).post('/api/auth/login').send({ email, password: 'password12' })
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many attempts. Try again later.' })
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('verifies email with a single-use token', async () => {
    const created = await request(app).post('/api/auth/register').send({
      name: 'Verify',
      email: `verify-${crypto.randomUUID()}@align.test`,
      password: 'password12',
    })
    expect(created.status).toBe(201)
    expect(created.body.emailVerified).toBe(false)
    expect(typeof created.body.verifyToken).toBe('string')

    const verified = await request(app).post('/api/auth/verify').send({ token: created.body.verifyToken })
    expect(verified.status).toBe(200)
    expect(verified.body.emailVerified).toBe(true)
    expect((await request(app).post('/api/auth/verify').send({ token: created.body.verifyToken })).status).toBe(400)
  })

  it('rotates refresh tokens and revokes the family when an old token is reused', async () => {
    const created = await request(app).post('/api/auth/register').send({
      name: 'Refresh',
      email: `refresh-${crypto.randomUUID()}@align.test`,
      password: 'password12',
    })
    const issued = created.headers['set-cookie']
    const cookies = Array.isArray(issued) ? issued : issued ? [issued] : []
    const refresh = cookies.find((cookie) => cookie.startsWith('refresh='))?.split(';')[0]
    expect(refresh).toBeTruthy()

    const rotated = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken(issued) ?? '')
    expect(rotated.status).toBe(200)
    const rotatedCookies = rotated.headers['set-cookie']
    const nextCookies = Array.isArray(rotatedCookies) ? rotatedCookies : rotatedCookies ? [rotatedCookies] : []
    const next = nextCookies.find((cookie) => cookie.startsWith('refresh='))?.split(';')[0]
    expect(next).toBeTruthy()
    expect(next).not.toBe(refresh)

    const reused = await request(app).post('/api/auth/refresh').set('Cookie', refresh ?? '')
    expect(reused.status).toBe(401)
    const after = await request(app).post('/api/auth/refresh').set('Cookie', next ?? '')
    expect(after.status).toBe(401)
  })

  it('lists sessions, revokes one, and signs out everywhere', async () => {
    const { agent, email, password } = await registerUser('Sessions')
    const first = await agent.get('/api/auth/sessions')
    expect(first.status).toBe(200)
    expect(first.body).toHaveLength(1)
    expect(first.body[0].current).toBe(true)
    expect(typeof first.body[0].device).toBe('string')

    expect((await request(app).post('/api/auth/login').send({ email, password })).status).toBe(200)
    const both = await agent.get('/api/auth/sessions')
    expect(both.body).toHaveLength(2)
    const other = both.body.find((session: { current: boolean }) => !session.current)
    expect((await agent.delete(`/api/auth/sessions/${other.id}`)).status).toBe(204)
    expect((await agent.get('/api/auth/sessions')).body).toHaveLength(1)

    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)
    expect((await agent.post('/api/auth/sessions/revoke-all').send({ password })).status).toBe(204)
    expect((await agent.get('/api/auth/me')).status).toBe(401)
  })

  it('does not lock an account that only signs in successfully', async () => {
    const { email, password } = await registerUser('Steady')
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await request(app).post('/api/auth/login').send({ email, password })
      expect(response.status).toBe(200)
      const timing = String(response.headers['server-timing'] ?? '')
      expect(timing).toMatch(/db;dur=/)
      expect(timing).toMatch(/user;dur=/)
      expect(timing).toMatch(/bcrypt;dur=/)
      expect(timing).toMatch(/session;dur=/)
      expect(timing).toMatch(/jwt;dur=/)
    }
  })

  it('lets a successful login reset the failure count', async () => {
    const email = `reset-lock-${crypto.randomUUID()}@align.test`
    await registerUser('Reset', email)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' })).status).toBe(401)
    }
    expect((await request(app).post('/api/auth/login').send({ email, password: 'password12' })).status).toBe(200)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' })).status).toBe(401)
    }
    expect((await request(app).post('/api/auth/login').send({ email, password: 'password12' })).status).toBe(200)
  })

  it('returns 401 for the first ten failures and 429 only on the eleventh', async () => {
    const email = `lock-${crypto.randomUUID()}@align.test`
    await registerUser('Lock', email)
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const response = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' })
        expect(response.status, `failure ${attempt}`).toBe(401)
        expect(response.body).toEqual({ error: 'Email or password is incorrect.' })
      }
      const locked = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' })
      expect(locked.status).toBe(429)
      expect(locked.body).toEqual({ error: 'Too many attempts. Try again later.' })
      const retryAfter = Number(locked.headers['retry-after'])
      expect(retryAfter).toBeGreaterThan(10 * 60)
      expect(retryAfter).toBeLessThanOrEqual(15 * 60)
    } finally {
      process.env.NODE_ENV = previous
    }
  }, 30_000)

  it('never returns an emailed token in production, and existing and unknown addresses match', async () => {
    const previousNode = process.env.NODE_ENV
    const previousVercel = process.env.VERCEL_ENV
    const previousExpose = process.env.EXPOSE_DEV_TOKENS
    const notes: string[] = []
    const original = console.info
    console.info = (...args: unknown[]) => {
      notes.push(args.map(String).join(' '))
    }
    process.env.NODE_ENV = 'production'
    process.env.EXPOSE_DEV_TOKENS = '1'
    delete process.env.VERCEL_ENV
    try {
      const email = `hidden-${crypto.randomUUID()}@align.test`
      const password = `rK7m-${crypto.randomUUID()}`
      const created = await request(app).post('/api/auth/register').send({ name: 'Hidden', email, password })
      expect(created.status).toBe(201)
      expect(created.body.verifyToken).toBeUndefined()
      expect(JSON.stringify(created.body)).not.toMatch(/resetToken|verifyToken|[0-9a-f]{64}/)
      const issued = created.headers['set-cookie']
      const cookieList = Array.isArray(issued) ? issued : issued ? [issued] : []
      const cookie = cookieList.map((entry) => entry.split(';')[0]).join('; ')
      const csrf = csrfToken(issued) ?? ''

      const unknownEmail = `missing-${crypto.randomUUID()}@align.test`
      const knownStarted = performance.now()
      const known = await request(app).post('/api/auth/forgot').send({ email })
      const knownMs = performance.now() - knownStarted
      const unknownStarted = performance.now()
      const unknown = await request(app).post('/api/auth/forgot').send({ email: unknownEmail })
      const unknownMs = performance.now() - unknownStarted

      expect(known.status).toBe(200)
      expect(unknown.status).toBe(200)
      expect(known.body).toEqual(unknown.body)
      expect(known.body).toEqual({ message: RESET_MESSAGE })
      expect(JSON.stringify(known.body)).not.toMatch(/token|https?:|[0-9a-f]{64}/i)
      expect(knownMs).toBeGreaterThanOrEqual(250)
      expect(unknownMs).toBeGreaterThanOrEqual(250)
      expect(Math.abs(knownMs - unknownMs)).toBeLessThan(500)
      expect(await AuthToken.countDocuments({ type: { $in: ['reset', 'verify'] } })).toBe(0)

      const logged = notes.filter((line) => line.includes('password-reset-requested') || line.includes('verification-requested'))
      expect(logged.length).toBeGreaterThan(0)
      expect(logged.join('\n')).not.toMatch(/[0-9a-f]{64}|token=/)

      const sent = await request(app).post('/api/auth/verify/send').set('Cookie', cookie).set('x-csrf-token', csrf)
      expect(sent.status).toBe(200)
      expect(sent.body).toEqual({ message: VERIFY_MESSAGE })

      const next = `next-${crypto.randomUUID()}@align.test`
      const stepped = await request(app).post('/api/auth/step-up').set('Cookie', cookie).set('x-csrf-token', csrf).send({ password })
      expect(stepped.status).toBe(204)
      const changed = await request(app)
        .post('/api/auth/email')
        .set('Cookie', cookie)
        .set('x-csrf-token', csrf)
        .send({ email: next, password })
      expect(changed.status).toBe(200)
      expect(changed.body.email).toBe(next)
      expect(changed.body.verifyToken).toBeUndefined()
      expect(JSON.stringify(changed.body)).not.toMatch(/verifyToken|[0-9a-f]{64}/)
      expect(await AuthToken.countDocuments()).toBe(0)

      process.env.NODE_ENV = 'test'
      process.env.VERCEL_ENV = 'production'
      const blocked = await request(app).post('/api/auth/forgot').send({ email: next })
      expect(blocked.status).toBe(200)
      expect(blocked.body).toEqual({ message: RESET_MESSAGE })
    } finally {
      console.info = original
      process.env.NODE_ENV = previousNode
      if (previousExpose === undefined) delete process.env.EXPOSE_DEV_TOKENS
      else process.env.EXPOSE_DEV_TOKENS = previousExpose
      if (previousVercel === undefined) delete process.env.VERCEL_ENV
      else process.env.VERCEL_ENV = previousVercel
    }
  })

  it('deletes reset and verification tokens that were issued while responses revealed them', async () => {
    const email = `purge-token-${crypto.randomUUID()}@align.test`
    const created = await request(app).post('/api/auth/register').send({ name: 'Purge', email, password: 'password12' })
    expect(created.status).toBe(201)
    await AuthToken.create({
      userId: created.body.id,
      type: 'reset',
      tokenHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    await AuthToken.create({
      userId: created.body.id,
      type: 'verify',
      tokenHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    await User.updateOne(
      { _id: created.body.id },
      { $set: { resetTokenHash: 'legacy-reset-hash', resetTokenExpires: new Date(Date.now() + 60 * 60 * 1000) } },
    )
    const counts = await upRevokeExposedTokens(false)
    expect(counts.tokens).toBeGreaterThanOrEqual(2)
    expect(counts.accounts).toBeGreaterThanOrEqual(1)
    expect(await AuthToken.countDocuments({ type: { $in: ['reset', 'verify'] } })).toBe(0)
    const stored = await User.findById(created.body.id).select('+resetTokenHash +resetTokenExpires')
    expect(stored?.get('resetTokenHash')).toBeUndefined()
    expect(stored?.get('resetTokenExpires')).toBeUndefined()
  })
})
