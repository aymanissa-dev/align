import { describe, expect, it } from 'vitest'
import { registerUser } from './helpers.ts'

describe('tasks and notes', () => {
  it('creates tasks in order, validates due dates, and updates them', async () => {
    const { agent } = await registerUser()
    const project = await agent.post('/api/projects').send({ name: 'Launch' })
    const id = project.body.id as string

    const first = await agent.post(`/api/projects/${id}/tasks`).send({ title: 'Write the changelog', dueDate: '2026-10-16' })
    const second = await agent.post(`/api/projects/${id}/tasks`).send({ title: 'Record the walkthrough', dueDate: '' })
    expect(first.body).toMatchObject({ order: 1, dueDate: '2026-10-16', completed: false })
    expect(second.body).toMatchObject({ order: 2, dueDate: null })

    const invalid = await agent.post(`/api/projects/${id}/tasks`).send({ title: 'Bad date', dueDate: '2026-02-31' })
    expect(invalid.status).toBe(400)

    const toggled = await agent.patch(`/api/tasks/${first.body.id}`).send({ completed: true, title: 'Changelog' })
    expect(toggled.body).toMatchObject({ completed: true, title: 'Changelog', dueDate: '2026-10-16' })

    const listed = await agent.get(`/api/projects/${id}/tasks`)
    expect(listed.body.map((task: { title: string }) => task.title)).toEqual(['Changelog', 'Record the walkthrough'])

    expect((await agent.delete(`/api/tasks/${second.body.id}`)).status).toBe(204)
    expect((await agent.get(`/api/projects/${id}/tasks`)).body).toHaveLength(1)
    expect((await agent.patch(`/api/tasks/${first.body.id}`).send({ completed: 'yes' })).status).toBe(400)
  })

  it('rejects a stale task write and keeps fields the caller did not send', async () => {
    const { agent } = await registerUser()
    const project = await agent.post('/api/projects').send({ name: 'Conflict' })
    const id = project.body.id as string
    const created = await agent.post(`/api/projects/${id}/tasks`).send({ title: 'Original', priority: 'medium' })
    expect(created.body.version).toBe(0)
    const taskId = created.body.id as string

    const saved = await agent
      .patch(`/api/tasks/${taskId}`)
      .set('If-Match', 'W/"0"')
      .send({ title: 'Title from A', priority: 'high' })
    expect(saved.status).toBe(200)
    expect(saved.body.version).toBe(1)
    expect(saved.headers.etag).toBe('W/"0"')

    const lost = await agent.patch(`/api/tasks/${taskId}`).set('If-Match', 'W/"0"').send({ priority: 'low' })
    expect(lost.status).toBe(409)
    expect(lost.body.error).toBe('This was changed elsewhere.')

    const current = await agent.get(`/api/projects/${id}/tasks`)
    expect(current.body[0]).toMatchObject({ title: 'Title from A', priority: 'high', version: 1 })

    const overwrite = await agent.patch(`/api/tasks/${taskId}`).set('If-Match', '*').send({ priority: 'low' })
    expect(overwrite.status).toBe(200)
    expect(overwrite.body).toMatchObject({ title: 'Title from A', priority: 'low' })
  })

  it('returns the existing task when a create is retried with the same clientId', async () => {
    const { agent } = await registerUser()
    const project = await agent.post('/api/projects').send({ name: 'Idem' })
    const id = project.body.id as string
    const clientId = '11111111-1111-4111-8111-111111111111'
    const [first, second] = await Promise.all([
      agent.post(`/api/projects/${id}/tasks`).send({ title: 'Once', clientId }),
      agent.post(`/api/projects/${id}/tasks`).send({ title: 'Once', clientId }),
    ])
    expect(first.status).toBeLessThan(300)
    expect(second.status).toBeLessThan(300)
    expect(second.body.id).toBe(first.body.id)

    const third = await agent.post(`/api/projects/${id}/tasks`).send({ title: 'Once again', clientId })
    expect(third.status).toBe(200)
    expect(third.body).toMatchObject({ id: first.body.id, title: 'Once' })
    expect(await agent.get(`/api/projects/${id}/tasks`)).toMatchObject({
      status: 200,
      body: [{ id: first.body.id, title: 'Once' }],
    })
  })

  it('creates, lists, updates, and deletes notes', async () => {
    const { agent } = await registerUser()
    const project = await agent.post('/api/projects').send({ name: 'Notes' })
    const id = project.body.id as string

    const untitled = await agent.post(`/api/projects/${id}/notes`).send({})
    expect(untitled.body.title).toBe('Untitled')

    const named = await agent.post(`/api/projects/${id}/notes`).send({ title: 'Tone', body: 'Calm and specific.' })
    await new Promise((resolve) => setTimeout(resolve, 15))
    const edited = await agent.patch(`/api/notes/${untitled.body.id}`).send({
      title: 'Homepage direction',
      body: 'Lead with the product.',
    })
    expect(edited.status).toBe(200)

    const all = await agent.get('/api/notes')
    expect(all.body.map((note: { title: string }) => note.title)).toEqual(['Homepage direction', 'Tone'])

    const projectNotes = await agent.get(`/api/projects/${id}/notes`)
    expect(projectNotes.body).toHaveLength(2)

    const one = await agent.get(`/api/notes/${named.body.id}`)
    expect(one.body.body).toBe('Calm and specific.')

    expect((await agent.patch(`/api/notes/${named.body.id}`).send({ title: '   ' })).status).toBe(400)

    const bumped = await agent.patch(`/api/notes/${named.body.id}`).set('If-Match', 'W/"0"').send({ body: 'Updated once.' })
    expect(bumped.status).toBe(200)
    const stale = await agent
      .patch(`/api/notes/${named.body.id}`)
      .set('If-Match', 'W/"0"')
      .send({ body: 'stale' })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toBe('This was changed elsewhere.')
    expect((await agent.get(`/api/notes/${named.body.id}`)).body.body).toBe('Updated once.')
    expect((await agent.delete(`/api/notes/${named.body.id}`)).status).toBe(204)
    expect((await agent.get(`/api/notes/${named.body.id}`)).status).toBe(404)
  })
})
