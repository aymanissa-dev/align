import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { Project } from '../src/models.ts'
import { app, registerUser } from './helpers.ts'

describe('auth', () => {
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
      password: 'password1',
    })
    expect(created.status).toBe(201)
    const cookie = created.headers['set-cookie']
    expect(cookie?.[0]).toMatch(/HttpOnly/i)
    expect(cookie?.[0]).toMatch(/SameSite=Lax/i)
    expect(cookie?.[0]).not.toMatch(/Secure/i)

    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const secure = await request(app).post('/api/auth/login').send({
        email: created.body.email,
        password: 'password1',
      })
      expect(secure.headers['set-cookie']?.[0]).toMatch(/Secure/i)
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
      password: 'password1',
    })
    expect(duplicate.status).toBe(409)

    const invalid = await request(app).post('/api/auth/register').send({
      name: 'Ada',
      email: 'not-an-email',
      password: 'short',
    })
    expect(invalid.status).toBe(400)

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

    const badPassword = await agent.post('/api/auth/password').send({
      currentPassword: 'nope',
      newPassword: 'password2',
    })
    expect(badPassword.status).toBe(400)

    const changed = await agent.post('/api/auth/password').send({
      currentPassword: password,
      newPassword: 'password2',
    })
    expect(changed.status).toBe(204)

    const oldLogin = await request(app).post('/api/auth/login').send({ email, password })
    expect(oldLogin.status).toBe(401)
    const newLogin = await request(app).post('/api/auth/login').send({ email, password: 'password2' })
    expect(newLogin.status).toBe(200)

    const removed = await agent.delete('/api/auth/me')
    expect(removed.status).toBe(204)
    expect(await Project.countDocuments({ _id: project.body.id })).toBe(0)
    const gone = await request(app).post('/api/auth/login').send({ email, password: 'password2' })
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
      password: 'password1',
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

    const reset = await request(app).post('/api/auth/reset').send({
      token: forgot.body.resetToken,
      password: 'password2',
    })
    expect(reset.status).toBe(200)
    expect(reset.body.email).toBe(email)

    const reused = await request(app).post('/api/auth/reset').send({
      token: forgot.body.resetToken,
      password: 'password3',
    })
    expect(reused.status).toBe(400)

    expect((await request(app).post('/api/auth/login').send({ email, password: 'password1' })).status).toBe(401)
    expect((await request(app).post('/api/auth/login').send({ email, password: 'password2' })).status).toBe(200)
  })

  it('rate-limits repeated auth attempts', async () => {
    const limited = createApp({ authRateLimitMax: 3 })
    const email = `limit-${crypto.randomUUID()}@align.test`
    const first = await request(limited).post('/api/auth/register').send({
      name: 'Limit',
      email,
      password: 'password1',
    })
    expect(first.status).toBe(201)
    expect((await request(limited).post('/api/auth/login').send({ email, password: 'nope' })).status).toBe(401)
    expect((await request(limited).post('/api/auth/login').send({ email, password: 'nope' })).status).toBe(401)
    const blocked = await request(limited).post('/api/auth/login').send({ email, password: 'password1' })
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many attempts. Try again later.' })
  })
})
