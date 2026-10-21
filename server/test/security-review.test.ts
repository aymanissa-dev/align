import { readFileSync } from 'node:fs'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { consumeRecoveryCode } from '../src/data/factors.ts'
import { claimInvites } from '../src/data/workspaces.ts'
import { upPurgeReviewerWorkspace } from '../src/migrate/purgeReviewerWorkspace.ts'
import { Invite, Membership, Passkey, Project, RateLimit, SecurityEvent, Session, User, Workspace } from '../src/models.ts'
import { totpAt } from '../src/totp.ts'
import { consumeAuthToken, issueAuthToken } from '../src/tokens.ts'
import { app, csrfToken, registerUser } from './helpers.ts'

function cookiePair(setCookie: string | string[] | undefined, name: string): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  for (const cookie of list) {
    const pair = cookie.split(';')[0] ?? ''
    if (pair.startsWith(`${name}=`)) return pair
  }
  return undefined
}

describe('security review', () => {
  it('keeps a new session unstepped until an explicit step-up, including after refresh', async () => {
    const { agent, email, password, id } = await registerUser()
    expect((await Session.findOne({ userId: id }))?.stepUpAt ?? null).toBeNull()
    expect((await request(app).post('/api/auth/login').send({ email, password })).status).toBe(200)
    const signedIn = await Session.find({ userId: id, revokedAt: null, replacedBy: null })
    expect(signedIn.every((session) => session.stepUpAt == null)).toBe(true)
    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)
    const before = await Session.find({ userId: id, revokedAt: null, replacedBy: null })
    const stepped = before.find((session) => session.stepUpAt)
    expect(stepped?.stepUpAt).toBeTruthy()
    expect((await agent.post('/api/auth/refresh')).status).toBe(200)
    const after = await Session.find({ userId: id, revokedAt: null, replacedBy: null })
    expect(after.find((session) => session.stepUpAt)?.stepUpAt?.getTime()).toBe(stepped?.stepUpAt?.getTime())
  })

  it('requires a step-up and the password before authenticator setup', async () => {
    const { agent, password } = await registerUser()
    expect((await agent.post('/api/auth/totp/setup').send({})).status).toBe(400)
    expect((await agent.post('/api/auth/totp/setup').send({ password: '   ' })).status).toBe(400)
    const locked = await agent.post('/api/auth/totp/setup').send({ password })
    expect(locked.status).toBe(403)
    expect(locked.body.code).toBe('step_up_required')
    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)
    expect((await agent.post('/api/auth/totp/setup').send({ password: 'not-the-password' })).status).toBe(400)
    const setup = await agent.post('/api/auth/totp/setup').send({ password })
    expect(setup.status).toBe(200)
    const code = totpAt(setup.body.secret as string, Math.floor(Date.now() / 1000 / 30))
    expect((await agent.post('/api/auth/totp/confirm').send({ code })).status).toBe(400)
    await Session.updateMany({}, { stepUpAt: new Date(Date.now() - 11 * 60 * 1000) })
    expect((await agent.post('/api/auth/totp/confirm').send({ code, password })).status).toBe(403)
    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)
    expect((await agent.post('/api/auth/totp/confirm').send({ code, password })).status).toBe(200)
  })

  it('keeps two-factor authentication and passkeys when a recovery key and authenticator code reset the password', async () => {
    const { agent, email, password, id, recoveryKey } = await registerUser()
    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)
    const setup = await agent.post('/api/auth/totp/setup').send({ password })
    const code = totpAt(setup.body.secret as string, Math.floor(Date.now() / 1000 / 30))
    expect((await agent.post('/api/auth/totp/confirm').send({ code, password })).status).toBe(200)
    await Passkey.create({
      userId: id,
      credentialId: `cred-${crypto.randomUUID()}`,
      publicKey: Buffer.from([1, 2, 3]),
      counter: 0,
      name: 'Laptop',
    })
    const keyOnly = await request(app).post('/api/auth/reset').send({ email, password: 'password123', recoveryKey })
    expect(keyOnly.status).toBe(400)
    expect(keyOnly.body).toEqual({ error: "Those details don't match." })
    const reset = await request(app)
      .post('/api/auth/reset')
      .send({ email, password: 'password123', recoveryKey, code })
    expect(reset.status).toBe(200)
    const user = await User.findById(id).select('+totpSecret +recoveryCodes')
    expect(user?.totpEnabledAt).toBeTruthy()
    expect(user?.totpSecret).toBeTruthy()
    expect(user?.recoveryCodes?.length).toBeGreaterThan(0)
    expect(await Passkey.countDocuments({ userId: id })).toBe(1)
    expect((await agent.get('/api/auth/me')).status).toBe(401)
    const event = await SecurityEvent.findOne({ userId: id, type: 'password-reset' })
    expect(event?.summary).toMatch(/new recovery key/)
    const fresh = await Session.findOne({ userId: id, revokedAt: null, replacedBy: null })
    expect(fresh?.stepUpAt ?? null).toBeNull()
  })

  it('does not auto-link Google onto an unverified account, and does link from a stepped-up session', async () => {
    const { email, id } = await registerUser()
    process.env.GOOGLE_CLIENT_ID = 'google-client'
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret'
    const original = globalThis.fetch
    let profile = { sub: `sub-${crypto.randomUUID()}`, email, email_verified: true, name: 'Linked' }
    globalThis.fetch = (async (url: string | URL) => {
      const href = String(url)
      if (href.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
      if (href.includes('userinfo')) return new Response(JSON.stringify(profile), { status: 200 })
      return original(url)
    }) as typeof fetch
    try {
      const start = await request(app).get('/api/auth/google')
      const state = new URL(start.headers.location as string).searchParams.get('state')
      const refused = await request(app).get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(state ?? '')}`)
      expect(refused.headers.location).toBe('/login?error=google')
      expect((await User.findById(id))?.googleId ?? null).toBeNull()

      const again = await request(app).get('/api/auth/google')
      const verifiedState = new URL(again.headers.location as string).searchParams.get('state')
      const stillRefused = await request(app).get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(verifiedState ?? '')}`)
      expect(stillRefused.headers.location).toBe('/login?error=google')
      expect((await User.findById(id))?.googleId ?? null).toBeNull()

      const other = await registerUser('Other')
      profile = { sub: `sub-${crypto.randomUUID()}`, email: other.email, email_verified: true, name: 'Other' }
      expect((await other.agent.get('/api/auth/google/link')).status).toBe(403)
      expect((await other.agent.post('/api/auth/step-up').send({ password: other.password })).status).toBe(204)
      const explicit = await other.agent.get('/api/auth/google/link')
      expect(explicit.status).toBe(302)
      const linkState = new URL(explicit.headers.location as string).searchParams.get('state')
      const done = await other.agent.get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(linkState ?? '')}`)
      expect(done.headers.location).toBe('/settings')
      const saved = await User.findById(other.id)
      expect(saved?.googleId).toBe(profile.sub)
      profile = { ...profile, email_verified: false }
      const unverifiedStart = await other.agent.get('/api/auth/google/link')
      const unverifiedState = new URL(unverifiedStart.headers.location as string).searchParams.get('state')
      const unverified = await other.agent.get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(unverifiedState ?? '')}`)
      expect(unverified.headers.location).toBe('/login?error=google')
      expect((await User.findById(other.id))?.googleId).toBe(profile.sub)
    } finally {
      globalThis.fetch = original
      delete process.env.GOOGLE_CLIENT_ID
      delete process.env.GOOGLE_CLIENT_SECRET
    }
  })

  it('spends a reset token and a recovery code once under concurrent calls', async () => {
    const { agent, password, id } = await registerUser()
    const token = await issueAuthToken(id, 'reset')
    const spent = await Promise.all([consumeAuthToken(token, 'reset'), consumeAuthToken(token, 'reset')])
    expect(spent.filter((value) => value === id)).toHaveLength(1)
    expect(spent.filter((value) => value === null)).toHaveLength(1)

    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)
    const setup = await agent.post('/api/auth/totp/setup').send({ password })
    const code = totpAt(setup.body.secret as string, Math.floor(Date.now() / 1000 / 30))
    const confirmed = await agent.post('/api/auth/totp/confirm').send({ code, password })
    const recovery = confirmed.body.recoveryCodes[0] as string
    const used = await Promise.all([consumeRecoveryCode(id, recovery), consumeRecoveryCode(id, recovery)])
    expect(used.filter(Boolean)).toHaveLength(1)
  })

  it('blocks account deletion while other people share an owned workspace, and removes an empty one', async () => {
    const owner = await registerUser('Owner')
    const member = await registerUser('Member')
    const shared = await owner.agent.post('/api/workspaces').send({ name: 'Studio' })
    const header = { 'x-workspace-id': shared.body.id as string }
    expect((await owner.agent.post('/api/workspaces/members').set(header).send({ email: member.email, role: 'member' })).status).toBe(201)
    expect((await owner.agent.post('/api/auth/step-up').send({ password: owner.password })).status).toBe(204)
    const blocked = await owner.agent.delete('/api/auth/me').send({ password: owner.password })
    expect(blocked.status).toBe(409)
    expect(await User.findById(owner.id)).toBeTruthy()
    expect(await Workspace.findById(shared.body.id)).toBeTruthy()

    const solo = await registerUser('Solo')
    const empty = await solo.agent.post('/api/workspaces').send({ name: 'Empty' })
    const project = await solo.agent.post('/api/projects').set({ 'x-workspace-id': empty.body.id as string }).send({ name: 'Board' })
    expect(project.status).toBe(201)
    expect((await solo.agent.post('/api/auth/step-up').send({ password: solo.password })).status).toBe(204)
    expect((await solo.agent.delete('/api/auth/me').send({ password: solo.password })).status).toBe(204)
    expect(await Workspace.findById(empty.body.id)).toBeNull()
    expect(await Project.findById(project.body.id)).toBeNull()
    expect(await User.findById(solo.id)).toBeNull()
  })

  it('invites an unknown address the same way as a known one, and claims it on register', async () => {
    const owner = await registerUser('Owner')
    const known = await registerUser('Known')
    const shared = await owner.agent.post('/api/workspaces').send({ name: 'Studio' })
    const header = { 'x-workspace-id': shared.body.id as string }
    const ghost = `ghost-${crypto.randomUUID()}@align.test`
    const pending = await owner.agent.post('/api/workspaces/members').set(header).send({ email: ghost, role: 'member' })
    const existing = await owner.agent.post('/api/workspaces/members').set(header).send({ email: known.email, role: 'viewer' })
    const repeat = await owner.agent.post('/api/workspaces/members').set(header).send({ email: known.email, role: 'admin' })
    expect(pending.status).toBe(201)
    expect(existing.status).toBe(201)
    expect(repeat.status).toBe(201)
    expect(pending.body).toEqual({ email: ghost, role: 'member' })
    expect(existing.body).toEqual({ email: known.email, role: 'viewer' })
    expect(repeat.body).toEqual({ email: known.email, role: 'viewer' })
    expect(await Invite.countDocuments({ email: ghost })).toBe(1)

    const created = await request(app).post('/api/auth/register').send({ name: 'Ghost', email: ghost, password: 'password12' })
    expect(created.status).toBe(201)
    expect(await Invite.countDocuments({ email: ghost })).toBe(0)
    const token = csrfToken(created.headers['set-cookie'])
    const issued = created.headers['set-cookie']
    const pairs = (Array.isArray(issued) ? issued : issued ? [issued] : []).map((cookie) => cookie.split(';')[0] ?? '')
    const projects = await request(app)
      .get('/api/projects')
      .set('Cookie', pairs)
      .set('x-csrf-token', token ?? '')
      .set(header)
    expect(projects.status).toBe(200)
    await Invite.create({ workspaceId: shared.body.id, email: known.email, role: 'member' })
    await claimInvites(known.id, known.email)
    expect(await Invite.countDocuments({ email: known.email })).toBe(0)
    expect(await Membership.findOne({ userId: known.id, workspaceId: shared.body.id })).toBeTruthy()
  })

  it('does not say that a registration email is already taken', async () => {
    const { email } = await registerUser()
    const again = await request(app).post('/api/auth/register').send({ name: 'Dup', email, password: 'password12' })
    expect(again.status).toBe(409)
    expect(again.body.error).toBe("We couldn't create an account with those details.")
    expect(JSON.stringify(again.body)).not.toMatch(/already exists/i)
    const fresh = await request(app).post('/api/auth/register').send({
      name: 'Fresh',
      email: `fresh-${crypto.randomUUID()}@align.test`,
      password: 'password12',
    })
    expect(fresh.status).toBe(201)
    expect(fresh.body.id).toEqual(expect.any(String))
    const spoofed = await request(app).post('/api/auth/register').set('x-real-ip', '203.0.113.50').set('x-forwarded-for', '198.51.100.8').send({
      name: 'Spoof',
      email: `spoof-${crypto.randomUUID()}@align.test`,
      password: 'password12',
    })
    expect(spoofed.status).toBe(201)
    const keys = (await RateLimit.find({ key: /^register:ip:/ }).select('key').lean()).map((row) => row.key)
    expect(keys.join(' ')).not.toMatch(/203\.0\.113\.50|198\.51\.100\.8/)
  })

  it('counts a failed sign-in and a password reset request against x-real-ip', async () => {
    const previous = process.env.VERCEL
    process.env.VERCEL = '1'
    try {
      const email = `miss-${crypto.randomUUID()}@align.test`
      const wrong = await request(app)
        .post('/api/auth/login')
        .set('x-real-ip', '203.0.113.40')
        .set('x-forwarded-for', '198.51.100.40, 10.0.0.4')
        .send({ email, password: 'not-the-password' })
      expect(wrong.status).toBe(401)
      const reset = await request(app)
        .post('/api/auth/reset')
        .set('x-real-ip', '203.0.113.41')
        .set('x-forwarded-for', '198.51.100.41')
        .send({ email, password: 'password123', recoveryKey: 'abcd-ef01-2345-6789-abcd-ef01-2345-6789' })
      expect(reset.status).toBe(400)
      expect(reset.body).toEqual({ error: "Those details don't match." })
      expect(await RateLimit.findOne({ key: 'login:fail:ip:203.0.113.40' })).toBeTruthy()
      expect(await RateLimit.findOne({ key: 'login:fail:ip:198.51.100.40' })).toBeNull()
      expect(await RateLimit.findOne({ key: 'reset:ip:203.0.113.41' })).toBeTruthy()
      expect(await RateLimit.findOne({ key: 'reset:ip:198.51.100.41' })).toBeNull()
    } finally {
      if (previous === undefined) delete process.env.VERCEL
      else process.env.VERCEL = previous
    }
  })

  it('counts registration against x-real-ip when Vercel sets it, even if forwarded-for changes', async () => {
    const previousEnv = process.env.NODE_ENV
    const previousVercel = process.env.VERCEL
    process.env.NODE_ENV = 'production'
    process.env.VERCEL = '1'
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const created = await request(app)
          .post('/api/auth/register')
          .set('x-real-ip', '203.0.113.10')
          .set('x-forwarded-for', `198.51.100.${attempt}, 10.0.0.${attempt}`)
          .send({
            name: 'Rate',
            email: `edge-${crypto.randomUUID()}@align.test`,
            password: `rK7m-${crypto.randomUUID()}`,
          })
        expect(created.status).toBe(201)
      }
      const blocked = await request(app)
        .post('/api/auth/register')
        .set('x-real-ip', '203.0.113.10')
        .set('x-forwarded-for', '203.0.113.99')
        .send({
          name: 'Rate',
          email: `edge-${crypto.randomUUID()}@align.test`,
          password: `rK7m-${crypto.randomUUID()}`,
        })
      expect(blocked.status).toBe(429)
      const other = await request(app)
        .post('/api/auth/register')
        .set('x-real-ip', '203.0.113.11')
        .set('x-forwarded-for', '203.0.113.10')
        .send({
          name: 'Rate',
          email: `edge-${crypto.randomUUID()}@align.test`,
          password: `rK7m-${crypto.randomUUID()}`,
        })
      expect(other.status).toBe(201)
    } finally {
      process.env.NODE_ENV = previousEnv
      if (previousVercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = previousVercel
    }
  }, 60_000)

  it('keeps registration on 201 and 409 and never calls an email API', async () => {
    const existing = await registerUser('Existing')
    const originalFetch = globalThis.fetch
    let mailed = false
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const [input] = args
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('api.resend.com')) mailed = true
      return originalFetch(...args)
    }) as typeof fetch
    try {
      const fresh = `new-${crypto.randomUUID()}@align.test`
      const knownStarted = performance.now()
      const duplicate = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Dup', email: existing.email, password: 'another-password-12' })
      const knownMs = performance.now() - knownStarted
      const freshStarted = performance.now()
      const created = await request(app).post('/api/auth/register').send({ name: 'New', email: fresh, password: 'password12' })
      const freshMs = performance.now() - freshStarted
      expect(created.status).toBe(201)
      expect(created.body.email).toBe(fresh)
      expect(created.body.recoveryKey).toMatch(/^[0-9a-f]{4}(?:-[0-9a-f]{4}){7}$/)
      expect(duplicate.status).toBe(409)
      expect(duplicate.body).toEqual({ error: "We couldn't create an account with those details." })
      expect(JSON.stringify(duplicate.body)).not.toMatch(/already exists|check your email/i)
      expect(Math.abs(knownMs - freshMs)).toBeLessThan(1000)
      expect(mailed).toBe(false)
      expect((await User.findOne({ email: fresh }))?.pendingVerification).toBe(false)
      expect((await request(app).post('/api/auth/verify').send({ token: 'abc' })).status).toBe(404)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rate limits registration and authenticator guesses, and the general auth limiter, in production', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const created = await request(app).post('/api/auth/register').send({
          name: 'Rate',
          email: `rate-${crypto.randomUUID()}@align.test`,
          password: `rK7m-${crypto.randomUUID()}`,
        })
        expect(created.status).toBe(201)
      }
      const blocked = await request(app).post('/api/auth/register').send({
        name: 'Rate',
        email: `rate-${crypto.randomUUID()}@align.test`,
        password: `rK7m-${crypto.randomUUID()}`,
      })
      expect(blocked.status).toBe(429)
    } finally {
      process.env.NODE_ENV = previous
    }

    const { email, password } = await registerUser()
    expect((await request(app).post('/api/auth/login').send({ email, password })).status).toBe(200)
    const agent = request.agent(app)
    const signed = await agent.post('/api/auth/login').send({ email, password })
    const csrf = csrfToken(signed.headers['set-cookie'])
    if (csrf) agent.set('x-csrf-token', csrf)
    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)
    const setup = await agent.post('/api/auth/totp/setup').send({ password })
    const real = totpAt(setup.body.secret as string, Math.floor(Date.now() / 1000 / 30))
    expect((await agent.post('/api/auth/totp/confirm').send({ code: real, password })).status).toBe(200)
    const challenge = await request(app).post('/api/auth/login').send({ email, password })
    const pending = cookiePair(challenge.headers['set-cookie'], 'pending')
    const pendingCsrf = csrfToken(challenge.headers['set-cookie'])
    const wrongCode = real === '000000' ? '111111' : '000000'
    process.env.NODE_ENV = 'production'
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const wrong = await request(app)
          .post('/api/auth/login/mfa')
          .set('Cookie', [pending ?? '', `csrf=${pendingCsrf}`])
          .set('x-csrf-token', pendingCsrf ?? '')
          .send({ code: wrongCode, method: 'totp' })
        expect(wrong.status).toBe(401)
      }
      const locked = await request(app)
        .post('/api/auth/login/mfa')
        .set('Cookie', [pending ?? '', `csrf=${pendingCsrf}`])
        .set('x-csrf-token', pendingCsrf ?? '')
        .send({ code: wrongCode, method: 'totp' })
      expect(locked.status).toBe(429)
    } finally {
      process.env.NODE_ENV = previous
    }

    process.env.NODE_ENV = 'production'
    try {
      await RateLimit.deleteMany({ key: /^auth-route:/ })
      const first = createApp()
      const second = createApp()
      for (let attempt = 0; attempt < 30; attempt += 1) {
        expect((await request(first).post('/api/auth/password').send({})).status).not.toBe(429)
      }
      for (let attempt = 0; attempt < 30; attempt += 1) {
        expect((await request(second).post('/api/auth/password').send({})).status).not.toBe(429)
      }
      expect((await request(first).post('/api/auth/password').send({})).status).toBe(429)
    } finally {
      process.env.NODE_ENV = previous
    }
  }, 60_000)

  it('purges only the reviewer workspace and project', async () => {
    const owner = await registerUser('Owner')
    const workspaceId = '6ad897539bb929a182fb6e47'
    const projectId = '6ad897539bb929a182fb6e54'
    await Workspace.create({ _id: workspaceId, name: 'Shared Sec WS', personal: false, ownerId: owner.id })
    await Membership.create({ workspaceId, userId: owner.id, role: 'owner' })
    await Project.create({ _id: projectId, userId: owner.id, workspaceId, name: 'Leftover', status: 'active' })
    const keeper = await owner.agent.post('/api/projects').send({ name: 'Keep' })
    const dry = await upPurgeReviewerWorkspace(true)
    expect(dry.workspaces).toBe(1)
    expect(dry.projects).toBe(1)
    expect(await Project.findById(projectId)).toBeTruthy()
    await upPurgeReviewerWorkspace(false)
    expect(await Workspace.findById(workspaceId)).toBeNull()
    expect(await Project.findById(projectId)).toBeNull()
    expect(await Membership.countDocuments({ workspaceId })).toBe(0)
    expect(await Project.findById(keeper.body.id)).toBeTruthy()
    const again = await upPurgeReviewerWorkspace(false)
    expect(again.workspaces).toBe(0)
    expect(again.projects).toBe(0)
  })

  it('serves a strict script policy and a health body with no counts', async () => {
    const html = readFileSync(new URL('../../client/index.html', import.meta.url), 'utf8')
    const vercel = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')
    const vite = readFileSync(new URL('../../client/vite.config.ts', import.meta.url), 'utf8')
    expect(html).toContain('src="/boot.js"')
    expect(html).not.toMatch(/<script\b[^>]*>\s*[^<\s]/)
    expect(vercel).toContain("script-src 'self'")
    expect(vercel).toContain("object-src 'none'")
    expect(vercel).toContain("base-uri 'self'")
    expect(vercel).toContain("frame-ancestors 'none'")
    expect(vercel).toContain("connect-src 'self'")
    expect(vercel).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(vite).toContain("injectRegister: 'script'")
    const health = await request(app).get('/api/health')
    expect(health.body).toEqual({ ok: true, db: 'up' })
    expect(health.body).not.toHaveProperty('latencyMs')
    expect(health.body).not.toHaveProperty('migration')
  })
})
