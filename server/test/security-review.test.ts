import { readFileSync } from 'node:fs'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { consumeRecoveryCode } from '../src/data/factors.ts'
import { claimInvites } from '../src/data/workspaces.ts'
import { upPurgeReviewerWorkspace } from '../src/migrate/purgeReviewerWorkspace.ts'
import { Invite, Membership, Passkey, Project, SecurityEvent, Session, User, Workspace } from '../src/models.ts'
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

  it('clears every factor when a password is reset', async () => {
    const { agent, email, password, id } = await registerUser()
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
    const forgot = await request(app).post('/api/auth/forgot').send({ email })
    const reset = await request(app).post('/api/auth/reset').send({ token: forgot.body.resetToken, password: 'password123' })
    expect(reset.status).toBe(200)
    const user = await User.findById(id).select('+totpSecret +recoveryCodes')
    expect(user?.totpEnabledAt ?? null).toBeNull()
    expect(user?.totpSecret ?? null).toBeNull()
    expect(user?.recoveryCodes ?? []).toEqual([])
    expect(await Passkey.countDocuments({ userId: id })).toBe(0)
    expect((await agent.get('/api/auth/me')).status).toBe(401)
    const event = await SecurityEvent.findOne({ userId: id, type: 'password-reset' })
    expect(event?.summary).toMatch(/passkeys were removed/)
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

      await User.updateOne({ _id: id }, { emailVerifiedAt: new Date() })
      const again = await request(app).get('/api/auth/google')
      const verifiedState = new URL(again.headers.location as string).searchParams.get('state')
      const linked = await request(app).get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(verifiedState ?? '')}`)
      expect(linked.headers.location).toBe('/')
      expect((await User.findById(id))?.googleId).toBe(profile.sub)

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
      expect(saved?.emailVerifiedAt).toBeTruthy()
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
  })

  it('rate limits registration and authenticator guesses, and the general auth limiter, in production', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
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
      const limited = createApp()
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const response = await request(limited).post('/api/auth/password').send({})
        expect(response.status).not.toBe(429)
      }
      expect((await request(limited).post('/api/auth/password').send({})).status).toBe(429)
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
