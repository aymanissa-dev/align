import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { clearFactorsAfterReset } from '../src/data/recoveryKey.ts'
import { Passkey, SecurityEvent, Session, User } from '../src/models.ts'
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
  })

  it('keeps the authenticator when a two-factor recovery code resets the password', async () => {
    const { agent, email, password, id, recoveryKey } = await registerUser()
    expect((await agent.post('/api/auth/step-up').send({ password })).status).toBe(204)
    const setup = await agent.post('/api/auth/totp/setup').send({ password })
    const code = totpAt(setup.body.secret as string, Math.floor(Date.now() / 1000 / 30))
    const confirmed = await agent.post('/api/auth/totp/confirm').send({ code, password })
    expect(confirmed.status).toBe(200)
    const recoveryCode = confirmed.body.recoveryCodes[0] as string
    await Passkey.create({
      userId: id,
      credentialId: `cred-${crypto.randomUUID()}`,
      publicKey: Buffer.from([4, 5, 6]),
      counter: 0,
      name: 'Phone',
    })
    const reset = await request(app).post('/api/auth/reset').send({ email, password: 'password123', code: recoveryCode })
    expect(reset.status).toBe(200)
    expect(reset.body.recoveryKey).not.toBe(recoveryKey)
    const user = await User.findById(id).select('+totpSecret +recoveryCodes +recoveryKeyHash')
    expect(user?.totpEnabledAt).toBeTruthy()
    expect(user?.totpSecret).toBeTruthy()
    expect(user?.recoveryCodes?.some((entry) => entry.usedAt)).toBe(true)
    expect(await Passkey.countDocuments({ userId: id })).toBe(0)
    const reused = await request(app).post('/api/auth/reset').send({ email, password: 'password123', code: recoveryCode })
    expect(reused.status).toBe(400)
    expect((await request(app).post('/api/auth/reset').send({ email, password: 'password123', recoveryKey })).status).toBe(400)
  })

  it('keeps only the passkey that authorized the reset', async () => {
    const { id } = await registerUser()
    const kept = await Passkey.create({
      userId: id,
      credentialId: `keep-${crypto.randomUUID()}`,
      publicKey: Buffer.from([1]),
      counter: 0,
      name: 'Kept',
    })
    await Passkey.create({
      userId: id,
      credentialId: `drop-${crypto.randomUUID()}`,
      publicKey: Buffer.from([2]),
      counter: 0,
      name: 'Dropped',
    })
    await clearFactorsAfterReset(id, 'passkey', kept.id)
    const remaining = await Passkey.find({ userId: id })
    expect(remaining.map((passkey) => passkey.id)).toEqual([kept.id])
    const garbage = await request(app).post('/api/auth/reset/passkey').send({ password: 'password123', response: { id: 'nope' } })
    expect(garbage.status).toBe(400)
    expect(garbage.body.error).toBe('Passkey response is invalid.')
    const options = await request(app).post('/api/auth/reset/passkey/options').send({})
    expect(options.status).toBe(200)
    expect(options.body.challenge).toEqual(expect.any(String))
    expect(await Passkey.countDocuments({ userId: id })).toBe(1)
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
