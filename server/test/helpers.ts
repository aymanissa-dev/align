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

export async function registerUser(name = 'Ada Lovelace', email = `ada-${crypto.randomUUID()}@align.test`): Promise<Registered> {
  const password = 'password12'
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/register').send({ name, email, password })
  if (response.status !== 201) {
    throw new Error(`register failed: ${response.status} ${JSON.stringify(response.body)}`)
  }
  return { agent, email, password, id: response.body.id as string, name: response.body.name as string }
}
