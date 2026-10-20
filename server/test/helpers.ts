import request, { type Agent } from 'supertest'
import { createApp } from '../src/app.ts'

export const app = createApp()

type Registered = {
  agent: Agent
  email: string
  password: string
  id: string
  name: string
}

export function csrfToken(setCookie: string | string[] | undefined): string | undefined {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  for (const cookie of list) {
    const pair = cookie.split(';')[0] ?? ''
    if (pair.startsWith('csrf=')) return decodeURIComponent(pair.slice('csrf='.length))
  }
  return undefined
}

export async function registerUser(name = 'Ada Lovelace', email = `ada-${crypto.randomUUID()}@align.test`): Promise<Registered> {
  const password = 'password12'
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/register').send({ name, email, password })
  const token = csrfToken(response.headers['set-cookie'])
  if (token) agent.set('x-csrf-token', token)
  if (response.status !== 201) {
    throw new Error(`register failed: ${response.status} ${JSON.stringify(response.body)}`)
  }
  return { agent, email, password, id: response.body.id as string, name: response.body.name as string }
}
