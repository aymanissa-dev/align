import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { Note, Task } from '../src/models.ts'
import { app, registerUser } from './helpers.ts'

describe('projects', () => {
  it('creates, lists, updates, archives, and deletes with a cascade', async () => {
    const { agent } = await registerUser()
    const created = await agent.post('/api/projects').send({
      name: '  Website refresh  ',
      description: 'Fewer pages.',
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      name: 'Website refresh',
      description: 'Fewer pages.',
      status: 'active',
    })
    expect(created.body).not.toHaveProperty('userId')

    const id = created.body.id as string
    const task = await agent.post(`/api/projects/${id}/tasks`).send({ title: 'Rewrite the homepage' })
    const note = await agent.post(`/api/projects/${id}/notes`).send({ title: 'Direction', body: 'Lead with the product.' })
    expect(task.status).toBe(201)
    expect(note.status).toBe(201)

    const listed = await agent.get('/api/projects?status=active')
    expect(listed.body.map((project: { name: string }) => project.name)).toEqual(['Website refresh'])

    const updated = await agent.patch(`/api/projects/${id}`).send({ description: 'Clearer writing.' })
    expect(updated.body.description).toBe('Clearer writing.')

    const archived = await agent.patch(`/api/projects/${id}/archive`)
    expect(archived.body.status).toBe('archived')
    const active = await agent.get('/api/projects?status=active')
    expect(active.body).toEqual([])
    const restored = await agent.patch(`/api/projects/${id}/archive`)
    expect(restored.body.status).toBe('active')

    const removed = await agent.delete(`/api/projects/${id}`)
    expect(removed.status).toBe(204)
    expect(await Task.countDocuments({ projectId: id })).toBe(0)
    expect(await Note.countDocuments({ projectId: id })).toBe(0)
    expect((await agent.get(`/api/projects/${id}`)).status).toBe(404)
    expect((await agent.get(`/api/tasks/${task.body.id}`)).status).toBe(404)
    expect((await agent.get(`/api/notes/${note.body.id}`)).status).toBe(404)
  })

  it('hides projects that belong to someone else', async () => {
    const owner = await registerUser('Owner')
    const other = await registerUser('Other')
    const created = await owner.agent.post('/api/projects').send({ name: 'Secret' })
    const id = created.body.id as string

    expect((await other.agent.get('/api/projects')).body).toEqual([])
    expect((await other.agent.get(`/api/projects/${id}`)).status).toBe(404)
    expect((await other.agent.delete(`/api/projects/${id}`)).status).toBe(404)
    expect((await other.agent.get(`/api/projects/${id}/tasks`)).status).toBe(404)
    expect((await request(app).get(`/api/projects/not-an-id`)).status).toBe(401)
    expect((await owner.agent.get('/api/projects/not-an-id')).status).toBe(404)
    expect((await owner.agent.get('/api/projects?status=nope')).status).toBe(400)
    expect((await owner.agent.post('/api/projects').send({ name: '   ' })).status).toBe(400)
  })
})
