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
    expect((await agent.get('/api/notes')).body.map((note: { title: string }) => note.title)).toEqual(['Homepage direction'])
    const trash = await agent.get('/api/trash')
    expect(trash.body.notes.map((note: { title: string }) => note.title)).toEqual(['Tone'])
    expect((await agent.post(`/api/trash/notes/${named.body.id}/restore`)).body.title).toBe('Tone')
    expect((await agent.get(`/api/notes/${named.body.id}`)).status).toBe(200)
    expect((await agent.delete(`/api/notes/${named.body.id}`)).status).toBe(204)
    expect((await agent.delete(`/api/trash/notes/${named.body.id}`)).status).toBe(204)
    expect((await agent.get('/api/trash')).body.notes).toEqual([])
    expect((await agent.post('/api/trash/empty')).status).toBe(204)
  })

  it('stores a checklist on the task and keeps it through trash', async () => {
    const { agent } = await registerUser()
    const project = await agent.post('/api/projects').send({ name: 'Checklist' })
    const id = project.body.id as string
    const created = await agent.post(`/api/projects/${id}/tasks`).send({
      title: 'Ship',
      subtasks: [{ id: 'step-1', text: 'Write it', completed: false }],
    })
    expect(created.status).toBe(201)
    expect(created.body.subtasks).toEqual([{ id: 'step-1', text: 'Write it', completed: false }])

    const empty = await agent.patch(`/api/tasks/${created.body.id}`).send({ subtasks: [{ id: 'step-1', text: '   ', completed: false }] })
    expect(empty.status).toBe(400)

    const saved = await agent.patch(`/api/tasks/${created.body.id}`).send({
      subtasks: [
        { id: 'step-2', text: 'Review', completed: true },
        { id: 'step-1', text: 'Write it', completed: false },
      ],
    })
    expect(saved.status).toBe(200)
    expect(saved.body.subtasks).toEqual([
      { id: 'step-2', text: 'Review', completed: true },
      { id: 'step-1', text: 'Write it', completed: false },
    ])

    expect((await agent.delete(`/api/tasks/${created.body.id}`)).status).toBe(204)
    expect((await agent.post(`/api/trash/tasks/${created.body.id}/restore`)).status).toBe(200)
    const restored = await agent.get(`/api/projects/${id}/tasks`)
    expect(restored.body[0].subtasks).toHaveLength(2)
  })

  it('spawns the next occurrence when a recurring task is completed', async () => {
    const { agent } = await registerUser()
    const project = await agent.post('/api/projects').send({ name: 'Repeat' })
    const id = project.body.id as string
    const created = await agent.post(`/api/projects/${id}/tasks`).send({
      title: 'Standup',
      dueDate: '2026-10-29',
      recurrence: 'daily',
      subtasks: [{ id: 'ask', text: 'Ask for blockers', completed: true }],
    })
    const taskId = created.body.id as string
    const before = await agent.get(`/api/projects/${id}/tasks`)
    const done = await agent.patch(`/api/tasks/${taskId}`).send({ completed: true, completedOn: '2026-10-29' })
    expect(done.body).toMatchObject({ completed: true, status: 'done', dueDate: '2026-10-29' })
    expect(done.body.spawned).toMatchObject({ title: 'Standup', completed: false, dueDate: '2026-10-30', status: 'todo' })
    const againList = await agent.get(`/api/projects/${id}/tasks`).set('If-None-Match', before.headers.etag as string)
    expect(againList.status).toBe(200)
    expect(againList.body).toHaveLength(2)

    const again = await agent.patch(`/api/tasks/${taskId}`).send({ completed: true, completedOn: '2026-10-29' })
    expect(again.status).toBe(200)

    const listed = await agent.get(`/api/projects/${id}/tasks`)
    const open = listed.body.find((task: { completed: boolean }) => !task.completed)
    expect(listed.body).toHaveLength(2)
    expect(open).toMatchObject({
      title: 'Standup',
      completed: false,
      dueDate: '2026-10-30',
      recurrence: 'daily',
      status: 'todo',
      subtasks: [{ text: 'Ask for blockers', completed: false }],
    })

    const weekly = await agent.post(`/api/projects/${id}/tasks`).send({
      title: 'Review',
      dueDate: '2026-01-31',
      recurrence: 'monthly',
    })
    await agent.patch(`/api/tasks/${weekly.body.id}`).send({ completed: true, completedOn: '2026-01-31' })
    const afterMonth = await agent.get(`/api/projects/${id}/tasks`)
    expect(afterMonth.body.find((task: { title: string; completed: boolean }) => task.title === 'Review' && !task.completed)).toMatchObject({
      dueDate: '2026-02-28',
    })

    const overdue = await agent.post(`/api/projects/${id}/tasks`).send({
      title: 'Old daily',
      dueDate: '2026-10-01',
      recurrence: 'daily',
    })
    await agent.patch(`/api/tasks/${overdue.body.id}`).send({ completed: true, completedOn: '2026-10-29' })
    const afterOverdue = await agent.get(`/api/projects/${id}/tasks`)
    expect(afterOverdue.body.find((task: { title: string; completed: boolean }) => task.title === 'Old daily' && !task.completed)).toMatchObject({
      dueDate: '2026-10-30',
    })
  })

  it('moves a task across board columns and lists due dates on the calendar', async () => {
    const { agent } = await registerUser()
    const project = await agent.post('/api/projects').send({ name: 'Board' })
    const id = project.body.id as string
    const created = await agent.post(`/api/projects/${id}/tasks`).send({ title: 'Draft', dueDate: '2026-10-29' })
    expect(created.body).toMatchObject({ status: 'todo', completed: false })

    const doing = await agent.patch(`/api/tasks/${created.body.id}`).send({ status: 'doing', order: 4 })
    expect(doing.body).toMatchObject({ status: 'doing', completed: false, order: 4 })

    const done = await agent.patch(`/api/tasks/${created.body.id}`).send({ status: 'done', completed: true, completedOn: '2026-10-29' })
    expect(done.body).toMatchObject({ status: 'done', completed: true })

    const back = await agent.patch(`/api/tasks/${created.body.id}`).send({ status: 'todo', completed: false, completedOn: null })
    expect(back.body).toMatchObject({ status: 'todo', completed: false, completedOn: null })

    const month = await agent.get('/api/calendar').query({ from: '2026-10-01', to: '2026-10-31' })
    expect(month.status).toBe(200)
    expect(month.body).toEqual([
      expect.objectContaining({ id: created.body.id, dueDate: '2026-10-29', projectName: 'Board', title: 'Draft' }),
    ])
    expect((await agent.get('/api/calendar').query({ from: '2026-11-01', to: '2026-11-30' })).body).toEqual([])
    expect((await agent.get('/api/calendar').query({ from: '2026-12-01', to: '2026-10-01' })).status).toBe(400)
    expect((await agent.get('/api/calendar').query({ from: 'not-a-date', to: '2026-10-31' })).status).toBe(400)
  })
})
