import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { authenticators } from '../src/data/factors.ts'
import { SecurityEvent, Session } from '../src/models.ts'
import { IDLE_MS } from '../src/session.ts'
import { totpAt } from '../src/totp.ts'
import { app, csrfToken, registerUser } from './helpers.ts'

function cookiePair(setCookie: string | string[] | undefined, name: string): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  for (const cookie of list) {
    const pair = cookie.split(';')[0] ?? ''
    if (pair.startsWith(`${name}=`)) return pair
  }
  return undefined
}

describe('sessions and second factors', () => {
  it('rotates refresh tokens and kills the family when one is reused', async () => {
    const { agent, email, password } = await registerUser()
    const login = await request(app).post('/api/auth/login').send({ email, password })
    expect(login.status).toBe(200)
    const refresh = cookiePair(login.headers['set-cookie'], 'refresh')
    const csrf = csrfToken(login.headers['set-cookie'])
    expect(refresh).toBeTruthy()
    const rotated = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [refresh!, `csrf=${csrf}`])
      .set('x-csrf-token', csrf ?? '')
    expect(rotated.status).toBe(200)
    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [refresh!, `csrf=${csrf}`])
      .set('x-csrf-token', csrf ?? '')
    expect(replay.status).toBe(401)
    const events = await agent.get('/api/auth/security-events')
    expect(events.body.some((event: { type: string }) => event.type === 'refresh-reuse')).toBe(true)
    const access = cookiePair(rotated.headers['set-cookie'], 'token')
    const after = await request(app).get('/api/auth/me').set('Cookie', access ?? '')
    expect(after.status).toBe(401)
  })

  it('expires idle and absolute sessions, and revokes one or all', async () => {
    const { agent, email, password, id } = await registerUser()
    const listed = await agent.get('/api/auth/sessions')
    expect(listed.body[0].current).toBe(true)
    const renamed = await agent.patch(`/api/auth/sessions/${listed.body[0].id}`).send({ name: 'Desk' })
    expect(renamed.body.device).toBe('Desk')
    const renamedEvents = await agent.get('/api/auth/security-events')
    const renameEvent = renamedEvents.body.find((event: { type: string }) => event.type === 'session-renamed')
    expect(renameEvent?.summary).toContain('Desk')
    expect(renameEvent?.device).toEqual(expect.any(String))
    expect(renameEvent?.deviceType).toEqual(expect.any(String))

    await Session.updateOne({ userId: id }, { lastSeenAt: new Date(Date.now() - IDLE_MS - 1000) })
    expect((await agent.get('/api/auth/me')).status).toBe(401)

    const again = await request(app).post('/api/auth/login').send({ email, password })
    await Session.updateMany({ userId: id }, { expiresAt: new Date(Date.now() - 1000) })
    expect((await request(app).get('/api/auth/me').set('Cookie', again.headers['set-cookie'])).status).toBe(401)

    const third = request.agent(app)
    const signed = await third.post('/api/auth/login').send({ email, password })
    const thirdToken = csrfToken(signed.headers['set-cookie'])
    if (thirdToken) third.set('x-csrf-token', thirdToken)
    const sessions = await third.get('/api/auth/sessions')
    const current = sessions.body.find((session: { current: boolean }) => session.current)
    expect((await third.delete(`/api/auth/sessions/${current.id}`)).status).toBe(204)
    expect((await third.get('/api/auth/me')).status).toBe(401)

    const fourth = request.agent(app)
    const last = await fourth.post('/api/auth/login').send({ email, password })
    const lastToken = csrfToken(last.headers['set-cookie'])
    if (lastToken) fourth.set('x-csrf-token', lastToken)
    await Session.updateMany({ userId: id }, { stepUpAt: new Date(Date.now() - 11 * 60 * 1000) })
    const stale = await fourth.post('/api/auth/sessions/revoke-all').send({ password })
    expect(stale.status).toBe(403)
    expect(stale.body.code).toBe('step_up_required')
    expect((await fourth.post('/api/auth/step-up').send({ password })).status).toBe(204)
    expect((await fourth.post('/api/auth/sessions/revoke-all').send({ password })).status).toBe(204)
    expect((await fourth.get('/api/auth/me')).status).toBe(401)
  })

  it('signs in with a TOTP code and a one-time recovery code', async () => {
    const { agent, email, password } = await registerUser()
    const setup = await agent.post('/api/auth/totp/setup')
    expect(setup.status).toBe(200)
    expect(setup.body.qr).toContain('data:image')
    const code = totpAt(setup.body.secret as string, Math.floor(Date.now() / 1000 / 30))
    const confirmed = await agent.post('/api/auth/totp/confirm').send({ code })
    expect(confirmed.status).toBe(200)
    const recovery = confirmed.body.recoveryCodes[0] as string

    await agent.post('/api/auth/logout')
    const challenge = await request(app).post('/api/auth/login').send({ email, password })
    expect(challenge.body.mfaRequired).toBe(true)
    expect((await request(app).get('/api/auth/me').set('Cookie', challenge.headers['set-cookie'])).status).toBe(401)
    const pending = cookiePair(challenge.headers['set-cookie'], 'pending')
    const csrf = csrfToken(challenge.headers['set-cookie'])
    const wrong = await request(app)
      .post('/api/auth/login/mfa')
      .set('Cookie', [pending ?? '', `csrf=${csrf}`])
      .set('x-csrf-token', csrf ?? '')
      .send({ code: '000000', method: 'totp' })
    expect(wrong.status).toBe(401)
    const passed = await request(app)
      .post('/api/auth/login/mfa')
      .set('Cookie', [pending ?? '', `csrf=${csrf}`])
      .set('x-csrf-token', csrf ?? '')
      .send({ code, method: 'totp' })
    expect(passed.status).toBe(200)
    expect(passed.body.email).toBe(email)

    await request(app).post('/api/auth/logout').set('Cookie', passed.headers['set-cookie'])
    const again = await request(app).post('/api/auth/login').send({ email, password })
    const pendingAgain = cookiePair(again.headers['set-cookie'], 'pending')
    const csrfAgain = csrfToken(again.headers['set-cookie'])
    const recovered = await request(app)
      .post('/api/auth/login/mfa')
      .set('Cookie', [pendingAgain ?? '', `csrf=${csrfAgain}`])
      .set('x-csrf-token', csrfAgain ?? '')
      .send({ code: recovery, method: 'recovery' })
    expect(recovered.status).toBe(200)
    const reused = await request(app)
      .post('/api/auth/login')
      .send({ email, password })
    const reusedPending = cookiePair(reused.headers['set-cookie'], 'pending')
    const reusedCsrf = csrfToken(reused.headers['set-cookie'])
    const secondUse = await request(app)
      .post('/api/auth/login/mfa')
      .set('Cookie', [reusedPending ?? '', `csrf=${reusedCsrf}`])
      .set('x-csrf-token', reusedCsrf ?? '')
      .send({ code: recovery, method: 'recovery' })
    expect(secondUse.status).toBe(401)
  })

  it('requires a fresh step-up before disabling 2FA or deleting the account', async () => {
    const { agent, password, id } = await registerUser()
    const setup = await agent.post('/api/auth/totp/setup')
    const code = totpAt(setup.body.secret as string, Math.floor(Date.now() / 1000 / 30))
    await agent.post('/api/auth/totp/confirm').send({ code })
    await Session.updateOne({ userId: id, revokedAt: null, replacedBy: null }, { stepUpAt: new Date(Date.now() - 11 * 60 * 1000) })
    const staleDisable = await agent.post('/api/auth/totp/disable').send({ password })
    expect(staleDisable.status).toBe(403)
    expect(staleDisable.body.code).toBe('step_up_required')
    expect((await agent.delete('/api/auth/me').send({ password })).status).toBe(403)
    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)
    expect((await agent.post('/api/auth/totp/disable').send({ password })).status).toBe(204)
    expect((await agent.get('/api/auth/mfa')).body.totp).toBe(false)
    expect((await agent.delete('/api/auth/me').send({ password })).status).toBe(204)
  })

  it('registers a passkey with a verified ceremony and alerts on a new device', async () => {
    const credentialId = `cred-${crypto.randomUUID()}`
    const registration = authenticators.verifyRegistrationResponse
    const authentication = authenticators.verifyAuthenticationResponse
    authenticators.verifyRegistrationResponse = (async () => ({
      verified: true,
      registrationInfo: {
        fmt: 'none',
        aaguid: '00000000-0000-0000-0000-000000000000',
        credentialType: 'public-key',
        credential: {
          id: credentialId,
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 0,
          transports: ['internal'],
        },
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://127.0.0.1',
        rpID: '127.0.0.1',
        userVerified: false,
      },
    })) as unknown as typeof authenticators.verifyRegistrationResponse
    authenticators.verifyAuthenticationResponse = (async () => ({
      verified: true,
      authenticationInfo: {
        newCounter: 1,
        credentialID: credentialId,
        userVerified: false,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://127.0.0.1',
        rpID: '127.0.0.1',
      },
    })) as unknown as typeof authenticators.verifyAuthenticationResponse

    try {
      const { agent, email, password } = await registerUser()
      const options = await agent.post('/api/auth/passkeys/register/options')
      expect(options.status).toBe(200)
      const clientDataJSON = Buffer.from(JSON.stringify({ challenge: options.body.challenge, type: 'webauthn.create' })).toString('base64url')
      const saved = await agent.post('/api/auth/passkeys/register/verify').send({
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        clientExtensionResults: {},
        name: 'Laptop',
        response: { clientDataJSON, attestationObject: 'aa' },
      })
      expect(saved.status).toBe(204)
      const passkeys = await agent.get('/api/auth/passkeys')
      expect(passkeys.body).toHaveLength(1)
      expect((await agent.get('/api/auth/mfa')).body.passkey).toBe(true)

      const step = await agent.post('/api/auth/passkeys/step-up/options')
      const stepClient = Buffer.from(JSON.stringify({ challenge: step.body.challenge })).toString('base64url')
      expect(
        (
          await agent.post('/api/auth/passkeys/step-up/verify').send({
            id: credentialId,
            rawId: credentialId,
            type: 'public-key',
            clientExtensionResults: {},
            response: { clientDataJSON: stepClient, authenticatorData: 'aa', signature: 'aa' },
          })
        ).status,
      ).toBe(204)

      const loginOptions = await request(app).post('/api/auth/passkeys/login/options')
      expect(loginOptions.status).toBe(200)
      await request(app)
        .post('/api/auth/login')
        .set('User-Agent', 'Mozilla/5.0 (Macintosh) Firefox/120.0')
        .set('x-vercel-ip-country', 'SA')
        .send({ email, password })
      const events = await agent.get('/api/auth/security-events')
      const freshDevice = events.body.find((event: { type: string }) => event.type === 'new-device')
      expect(freshDevice?.device).toBe('Firefox on macOS')
      expect(freshDevice?.deviceType).toBe('desktop')
      expect(freshDevice?.location).toBe('SA')
      const inbox = await agent.get('/api/notifications?today=2026-10-21')
      expect(inbox.body.some((item: { kind: string; title: string }) => item.kind === 'new-device' && item.title.includes('Firefox on macOS'))).toBe(true)
      expect(await SecurityEvent.countDocuments({ type: 'passkey-added' })).toBe(1)

      const id = passkeys.body[0].id as string
      expect((await agent.delete(`/api/auth/passkeys/${id}`).send({ password })).status).toBe(204)
    } finally {
      authenticators.verifyRegistrationResponse = registration
      authenticators.verifyAuthenticationResponse = authentication
    }
  })

  it('keeps Google sign-in dormant until keys exist, then accepts a mocked profile', async () => {
    expect((await request(app).get('/api/auth/google')).status).toBe(404)
    process.env.GOOGLE_CLIENT_ID = 'google-client'
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret'
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string | URL) => {
      const href = String(url)
      if (href.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
      if (href.includes('userinfo')) {
        return new Response(JSON.stringify({ sub: 'google-subject', email: 'google@align.test', email_verified: true, name: 'Google User' }), { status: 200 })
      }
      return original(url)
    }) as typeof fetch
    try {
      const start = await request(app).get('/api/auth/google')
      expect(start.status).toBe(302)
      const state = new URL(start.headers.location as string).searchParams.get('state')
      const done = await request(app).get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(state ?? '')}`)
      expect(done.status).toBe(302)
      expect(done.headers.location).toBe('/')
    } finally {
      globalThis.fetch = original
      delete process.env.GOOGLE_CLIENT_ID
      delete process.env.GOOGLE_CLIENT_SECRET
    }
  })

  it('changes the email only after the password is confirmed', async () => {
    const { agent, password, id } = await registerUser()
    await Session.updateMany({ userId: id }, { stepUpAt: new Date(Date.now() - 11 * 60 * 1000) })
    const next = `next-${crypto.randomUUID()}@align.test`
    const wrong = await agent.post('/api/auth/email').send({ email: next, password: 'not-the-password' })
    expect(wrong.status).toBe(403)
    expect(wrong.body.code).toBe('step_up_required')
    const ignored = await agent.post('/api/auth/email').send({ email: next, password })
    expect(ignored.status).toBe(403)
    expect(ignored.body.code).toBe('step_up_required')
    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)
    expect((await agent.post('/api/auth/email').send({ email: next, password: 'not-the-password' })).status).toBe(400)
    const changed = await agent.post('/api/auth/email').send({ email: next, password })
    expect(changed.status).toBe(200)
    expect(changed.body.email).toBe(next)
    expect(changed.body.verifyToken).toEqual(expect.any(String))
    expect((await agent.get('/api/auth/me')).body.email).toBe(next)
  })

  it('rejects a stale session on every sensitive route until a fresh step-up', async () => {
    const { agent, password, id } = await registerUser()
    const setup = await agent.post('/api/auth/totp/setup')
    const code = totpAt(setup.body.secret as string, Math.floor(Date.now() / 1000 / 30))
    await agent.post('/api/auth/totp/confirm').send({ code })
    await Session.updateMany({ userId: id }, { stepUpAt: new Date(Date.now() - 11 * 60 * 1000) })
    const email = `step-${crypto.randomUUID()}@align.test`
    const routes = [
      () => agent.post('/api/auth/email').send({ email, password }),
      () => agent.post('/api/auth/password').send({ currentPassword: password, newPassword: 'password123' }),
      () => agent.post('/api/auth/totp/disable').send({ password }),
      () => agent.post('/api/auth/recovery/regenerate').send({ password }),
      () => agent.delete('/api/auth/me').send({ password }),
      () => agent.post('/api/auth/sessions/revoke-all').send({ password }),
      () => agent.post('/api/auth/sessions/revoke-others').send({ password }),
    ]
    for (const call of routes) {
      const rejected = await call()
      expect(rejected.status).toBe(403)
      expect(rejected.body.code).toBe('step_up_required')
    }
    expect((await agent.post('/api/auth/step-up').send({ password: 'not-the-password' })).status).toBe(403)
    const freshCode = totpAt(setup.body.secret as string, Math.floor(Date.now() / 1000 / 30))
    expect((await agent.post('/api/auth/step-up').send({ code: freshCode, method: 'totp' })).status).toBe(204)
    const changed = await agent.post('/api/auth/email').send({ email, password })
    expect(changed.status).toBe(200)
    expect((await agent.post('/api/auth/recovery/regenerate').send({ password })).status).toBe(200)
    await Session.updateMany({ userId: id }, { stepUpAt: new Date(Date.now() - 11 * 60 * 1000) })
    expect((await agent.post('/api/auth/password').send({ currentPassword: password, newPassword: 'password123' })).status).toBe(403)
    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)
    expect((await agent.post('/api/auth/password').send({ currentPassword: password, newPassword: 'password123' })).status).toBe(204)
    expect((await agent.post('/api/auth/totp/disable').send({ password: 'password123' })).status).toBe(204)
    const events = await SecurityEvent.find({ userId: id }).lean()
    expect(events.some((event) => event.type === 'step-up' && event.device)).toBe(true)
    expect(events.some((event) => event.type === 'email-changed' && event.deviceType)).toBe(true)
    expect(events.some((event) => event.type === 'password-changed')).toBe(true)
    expect(events.some((event) => event.type === 'totp-disabled')).toBe(true)
    expect(events.some((event) => event.type === 'recovery-regenerated')).toBe(true)
    expect((await agent.delete('/api/auth/me').send({ password: 'password123' })).status).toBe(204)
  })

  it('signs out other sessions and keeps the current one', async () => {
    const { agent, email, password, id } = await registerUser()
    const other = request.agent(app)
    const signed = await other.post('/api/auth/login').send({ email, password })
    const token = csrfToken(signed.headers['set-cookie'])
    if (token) other.set('x-csrf-token', token)
    expect((await other.get('/api/auth/me')).status).toBe(200)

    expect((await agent.post('/api/auth/sessions/revoke-others').send({})).status).toBe(400)
    expect((await agent.post('/api/auth/sessions/revoke-others').send({ password: 'not-the-password' })).status).toBe(400)
    expect((await other.get('/api/auth/me')).status).toBe(200)

    await Session.updateMany({ userId: id }, { stepUpAt: new Date(Date.now() - 11 * 60 * 1000) })
    const stale = await agent.post('/api/auth/sessions/revoke-others').send({ password })
    expect(stale.status).toBe(403)
    expect(stale.body.code).toBe('step_up_required')
    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)
    expect((await agent.post('/api/auth/sessions/revoke-others').send({ password })).status).toBe(204)

    expect((await agent.get('/api/auth/me')).status).toBe(200)
    expect((await other.get('/api/auth/me')).status).toBe(401)
    const sessions = await agent.get('/api/auth/sessions')
    expect(sessions.body).toHaveLength(1)
    expect(sessions.body[0].current).toBe(true)
    const events = await SecurityEvent.find({ userId: id, type: 'other-sessions-revoked' })
    expect(events).toHaveLength(1)
  })

  it('rejects an empty or wrong credential inside the step-up window and accepts a valid code', async () => {
    const { agent, password, id } = await registerUser()
    const setup = await agent.post('/api/auth/totp/setup')
    const secret = setup.body.secret as string
    const code = totpAt(secret, Math.floor(Date.now() / 1000 / 30))
    const confirmed = await agent.post('/api/auth/totp/confirm').send({ code })
    const recovery = confirmed.body.recoveryCodes[0] as string
    expect(confirmed.status).toBe(200)

    const empty = await agent.post('/api/auth/totp/disable').send({ password: '' })
    expect(empty.status).toBe(400)
    expect((await agent.post('/api/auth/totp/disable').send({})).status).toBe(400)
    expect((await agent.post('/api/auth/totp/disable').send({ password: '   ' })).status).toBe(400)
    const wrong = await agent.post('/api/auth/totp/disable').send({ password: 'not-the-password' })
    expect(wrong.status).toBe(400)
    expect(wrong.body.error).toBe('Current password is incorrect.')
    const freshCode = totpAt(secret, Math.floor(Date.now() / 1000 / 30))
    const wrongCode = freshCode === '000000' ? '111111' : '000000'
    expect((await agent.post('/api/auth/totp/disable').send({ code: wrongCode })).status).toBe(400)
    expect((await agent.get('/api/auth/mfa')).body.totp).toBe(true)

    expect((await agent.post('/api/auth/recovery/regenerate').send({})).status).toBe(400)
    expect((await agent.post('/api/auth/sessions/revoke-all').send({})).status).toBe(400)
    expect((await agent.post('/api/auth/sessions/revoke-others').send({})).status).toBe(400)
    expect((await agent.delete('/api/auth/me').send({})).status).toBe(400)
    expect((await agent.delete('/api/auth/passkeys/missing').send({})).status).toBe(400)
    expect((await agent.post('/api/auth/email').send({ email: `blank-${crypto.randomUUID()}@align.test` })).status).toBe(400)
    expect((await agent.post('/api/auth/password').send({ newPassword: 'password123' })).status).toBe(400)
    expect((await agent.post('/api/auth/password').send({ currentPassword: '   ', newPassword: 'password123' })).status).toBe(400)

    await Session.updateMany({ userId: id }, { stepUpAt: new Date(Date.now() - 11 * 60 * 1000) })
    const staleEmpty = await agent.post('/api/auth/totp/disable').send({})
    expect(staleEmpty.status).toBe(400)
    const stalePassword = await agent.post('/api/auth/totp/disable').send({ password })
    expect(stalePassword.status).toBe(403)
    expect(stalePassword.body.code).toBe('step_up_required')
    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)

    const before = await Session.findOne({ userId: id, revokedAt: null, replacedBy: null }).lean()
    const replaced = await agent.post('/api/auth/recovery/regenerate').send({ code: recovery })
    expect(replaced.status).toBe(200)
    expect(replaced.body.recoveryCodes).toHaveLength(10)
    const afterCode = await Session.findOne({ userId: id, revokedAt: null, replacedBy: null }).lean()
    expect(afterCode?.stepUpAt?.getTime()).toBe(before?.stepUpAt?.getTime())

    const validCode = totpAt(secret, Math.floor(Date.now() / 1000 / 30))
    expect((await agent.post('/api/auth/totp/disable').send({ code: validCode })).status).toBe(204)
    expect((await agent.get('/api/auth/mfa')).body.totp).toBe(false)
    const afterDisable = await Session.findOne({ userId: id, revokedAt: null, replacedBy: null }).lean()
    expect(afterDisable?.stepUpAt?.getTime()).toBe(before?.stepUpAt?.getTime())
  })
})
