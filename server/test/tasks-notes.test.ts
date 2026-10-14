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
    expect((await agent.delete(`/api/notes/${named.body.id}`)).status).toBe(204)
    expect((await agent.get(`/api/notes/${named.body.id}`)).status).toBe(404)
  })
})
