import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { Notification, Passkey, SecurityEvent, Session, User } from '../src/models.ts'
import { totpAt } from '../src/totp.ts'
import { app, registerUser } from './helpers.ts'

describe('account recovery keys', () => {
  it('consumes a key once, even when two resets race', async () => {
    const { email, id, recoveryKey } = await registerUser()
    const body = { email, password: 'password123', recoveryKey }
    const [first, second] = await Promise.all([
      request(app).post('/api/auth/reset').send(body),
      request(app).post('/api/auth/reset').send(body),
    ])
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 400])
    const winner = first.status === 200 ? first : second
    expect(winner.body.recoveryKey).toMatch(/^[0-9a-f]{4}(?:-[0-9a-f]{4}){7}$/)
    expect(winner.body.recoveryKey).not.toBe(recoveryKey)
    const again = await request(app).post('/api/auth/reset').send(body)
    expect(again.status).toBe(400)
    expect(await Session.countDocuments({ userId: id, revokedAt: null })).toBe(1)
    const fresh = await Session.findOne({ userId: id, revokedAt: null })
    expect(fresh?.stepUpAt ?? null).toBeNull()
    expect(await SecurityEvent.findOne({ userId: id, type: 'password-reset' })).toBeTruthy()
    expect(await Notification.findOne({ userId: id, kind: 'password-reset' })).toBeTruthy()
  })

  it('resets with the recovery key alone when two-factor authentication is off and keeps passkeys', async () => {
    const { email, id, recoveryKey } = await registerUser()
    await Passkey.create({
      userId: id,
      credentialId: `cred-${crypto.randomUUID()}`,
      publicKey: Buffer.from([1]),
      counter: 0,
      name: 'Phone',
    })
    const codeOnly = await request(app).post('/api/auth/reset').send({ email, password: 'password123', code: 'abcde-fghij' })
    expect(codeOnly.status).toBe(400)
    expect(codeOnly.body).toEqual({ error: "Those details don't match." })
    const reset = await request(app).post('/api/auth/reset').send({ email, password: 'password123', recoveryKey })
    expect(reset.status).toBe(200)
    expect(reset.body.recoveryKey).not.toBe(recoveryKey)
    expect(await Passkey.countDocuments({ userId: id })).toBe(1)
    expect((await request(app).post('/api/auth/login').send({ email, password: 'password123' })).status).toBe(200)
  })

  it('requires the recovery key and a second factor when two-factor authentication is on', async () => {
    const { agent, email, password, id, recoveryKey } = await registerUser()
    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)
    const setup = await agent.post('/api/auth/totp/setup').send({ password })
    const totp = totpAt(setup.body.secret as string, Math.floor(Date.now() / 1000 / 30))
    const confirmed = await agent.post('/api/auth/totp/confirm').send({ code: totp, password })
    expect(confirmed.status).toBe(200)
    const recoveryCode = confirmed.body.recoveryCodes[0] as string
    const spare = confirmed.body.recoveryCodes[1] as string
    await Passkey.create({
      userId: id,
      credentialId: `cred-${crypto.randomUUID()}`,
      publicKey: Buffer.from([4, 5, 6]),
      counter: 0,
      name: 'Phone',
    })

    const codeAlone = await request(app).post('/api/auth/reset').send({ email, password: 'password123', code: recoveryCode })
    expect(codeAlone.status).toBe(400)
    const keyAlone = await request(app).post('/api/auth/reset').send({ email, password: 'password123', recoveryKey })
    expect(keyAlone.status).toBe(400)
    const wrongKey = await request(app)
      .post('/api/auth/reset')
      .send({ email, password: 'password123', recoveryKey: 'ffff-ffff-ffff-ffff-ffff-ffff-ffff-ffff', code: recoveryCode })
    expect(wrongKey.status).toBe(400)
    const stored = await User.findById(id).select('+recoveryCodes +recoveryKeyHash')
    expect(stored?.recoveryCodes?.every((entry) => entry.usedAt == null)).toBe(true)
    expect((await request(app).post('/api/auth/login').send({ email, password })).status).toBe(200)

    const withCode = await request(app)
      .post('/api/auth/reset')
      .send({ email, password: 'password123', recoveryKey, code: recoveryCode })
    expect(withCode.status).toBe(200)
    expect(withCode.body.recoveryKey).not.toBe(recoveryKey)
    const after = await User.findById(id).select('+totpSecret +recoveryCodes')
    expect(after?.totpEnabledAt).toBeTruthy()
    expect(after?.totpSecret).toBeTruthy()
    expect(after?.recoveryCodes?.some((entry) => entry.usedAt)).toBe(true)
    expect(await Passkey.countDocuments({ userId: id })).toBe(1)
    const reused = await request(app)
      .post('/api/auth/reset')
      .send({ email, password: 'password123', recoveryKey: withCode.body.recoveryKey, code: recoveryCode })
    expect(reused.status).toBe(400)

    const withTotp = await request(app)
      .post('/api/auth/reset')
      .send({ email, password: 'password1234', recoveryKey: withCode.body.recoveryKey, code: totp })
    expect(withTotp.status).toBe(200)
    const spareStillThere = await User.findById(id).select('+recoveryCodes')
    expect(spareStillThere?.recoveryCodes?.filter((entry) => entry.usedAt == null).length).toBeGreaterThan(0)
    expect(spare).toEqual(expect.any(String))
    expect((await request(app).post('/api/auth/reset/passkey').send({ password: 'password123', response: {} })).status).toBe(404)
  })

  it('issues a replacement key from settings only after step-up', async () => {
    const { agent, email, id, recoveryKey } = await registerUser()
    const locked = await agent.post('/api/auth/recovery-key').send({})
    expect(locked.status).toBe(403)
    expect(locked.body.code).toBe('step_up_required')
    expect((await agent.post('/api/auth/step-up').send({ password: 'password12' })).status).toBe(204)
    const issued = await agent.post('/api/auth/recovery-key').send({})
    expect(issued.status).toBe(200)
    expect(issued.body.recoveryKey).toMatch(/^[0-9a-f]{4}(?:-[0-9a-f]{4}){7}$/)
    expect(issued.body.recoveryKey).not.toBe(recoveryKey)
    expect(await SecurityEvent.findOne({ userId: id, type: 'recovery-key-created' })).toBeTruthy()
    const old = await request(app).post('/api/auth/reset').send({ email, password: 'password123', recoveryKey })
    expect(old.status).toBe(400)
    const reset = await request(app)
      .post('/api/auth/reset')
      .send({ email, password: 'password123', recoveryKey: issued.body.recoveryKey })
    expect(reset.status).toBe(200)
  })
})
