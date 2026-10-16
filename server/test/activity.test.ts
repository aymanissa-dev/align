import { describe, expect, it } from 'vitest'
import { registerUser } from './helpers.ts'

describe('activity and notifications', () => {
  it('records create, update, complete, and delete events on the project', async () => {
    const owner = await registerUser()
    const other = await registerUser('Grace')
    const project = await owner.agent.post('/api/projects').send({ name: 'Launch' })
    const id = project.body.id as string

    const task = await owner.agent.post(`/api/projects/${id}/tasks`).send({ title: 'Write the changelog' })
    await owner.agent.patch(`/api/tasks/${task.body.id}`).send({ completed: true })
    await owner.agent.post(`/api/projects/${id}/notes`).send({ title: 'Tone', body: 'Calm.' })
    await owner.agent.delete(`/api/tasks/${task.body.id}`)

    const timeline = await owner.agent.get(`/api/projects/${id}/activity`)
    expect(timeline.status).toBe(200)
    expect(timeline.body.map((item: { type: string }) => item.type)).toEqual(['delete', 'create', 'complete', 'create', 'create'])
    expect(timeline.body[0].summary).toContain('Deleted task')
    expect(timeline.body[2].summary).toContain('Completed task')
    expect((await other.agent.get(`/api/projects/${id}/activity`)).status).toBe(404)
  })

  it('records label create, update, and delete on the project feed', async () => {
    const { agent } = await registerUser()
    const project = await agent.post('/api/projects').send({ name: 'Launch' })
    const created = await agent.post('/api/labels').send({ name: 'Bug', color: '#b91c1c' })
    expect(created.status).toBe(201)
    const updated = await agent.patch(`/api/labels/${created.body.id}`).send({ name: 'Defect' })
    expect(updated.status).toBe(200)
    expect((await agent.delete(`/api/labels/${created.body.id}`)).status).toBe(204)

    const timeline = await agent.get(`/api/projects/${project.body.id}/activity`)
    expect(timeline.body.map((item: { summary: string }) => item.summary)).toEqual([
      expect.stringContaining('Deleted label'),
      expect.stringContaining('Updated label'),
      expect.stringContaining('Created label'),
      expect.stringContaining('Created project'),
    ])
  })

  it('creates due-soon and overdue notifications and marks them read', async () => {
    const { agent } = await registerUser()
    const project = await agent.post('/api/projects').send({ name: 'Launch' })
    const id = project.body.id as string
    await agent.post(`/api/projects/${id}/tasks`).send({ title: 'Yesterday', dueDate: '2026-10-14' })
    await agent.post(`/api/projects/${id}/tasks`).send({ title: 'Tomorrow', dueDate: '2026-10-16' })
    await agent.post(`/api/projects/${id}/tasks`).send({ title: 'Later', dueDate: '2026-11-01' })

    const missing = await agent.get('/api/notifications')
    expect(missing.status).toBe(400)

    const inbox = await agent.get('/api/notifications').query({ today: '2026-10-15' })
    expect(inbox.status).toBe(200)
    const kinds = Object.fromEntries(inbox.body.map((item: { title: string; kind: string }) => [item.title, item.kind]))
    expect(kinds).toEqual({ Yesterday: 'overdue', Tomorrow: 'due-soon' })
    expect(inbox.body.every((item: { read: boolean }) => item.read === false)).toBe(true)

    const again = await agent.get('/api/notifications').query({ today: '2026-10-15' })
    expect(again.body).toHaveLength(2)

    const marked = await agent.post(`/api/notifications/${inbox.body[0].id}/read`)
    expect(marked.body.read).toBe(true)
    expect((await agent.post('/api/notifications/read-all')).status).toBe(204)
    const cleared = await agent.get('/api/notifications').query({ today: '2026-10-15' })
    expect(cleared.body.every((item: { read: boolean }) => item.read)).toBe(true)
    expect((await agent.post('/api/notifications/not-an-id/read')).status).toBe(404)
  })
})
