import { describe, expect, it } from 'vitest'
import { registerUser } from './helpers.ts'

describe('today planner', () => {
  it('plans tasks for a date and separates carried work', async () => {
    const { agent } = await registerUser()
    const project = await agent.post('/api/projects').send({ name: 'Launch' })
    const id = project.body.id as string
    const first = await agent.post(`/api/projects/${id}/tasks`).send({ title: 'Write the changelog' })
    const second = await agent.post(`/api/projects/${id}/tasks`).send({ title: 'Draft the note' })
    const third = await agent.post(`/api/projects/${id}/tasks`).send({ title: 'Already done' })
    await agent.patch(`/api/tasks/${third.body.id}`).send({ completed: true })

    const planned = await agent.patch(`/api/tasks/${first.body.id}`).send({ plannedFor: '2026-10-15' })
    expect(planned.body.plannedFor).toBe('2026-10-15')
    await agent.patch(`/api/tasks/${second.body.id}`).send({ plannedFor: '2026-10-14' })

    const today = await agent.get('/api/today').query({ date: '2026-10-15' })
    expect(today.status).toBe(200)
    expect(today.body.planned.map((task: { title: string }) => task.title)).toEqual(['Write the changelog'])
    expect(today.body.carried.map((task: { title: string }) => task.title)).toEqual(['Draft the note'])
    expect(today.body.available.map((task: { title: string }) => task.title)).toEqual([])

    await agent.patch(`/api/tasks/${first.body.id}`).send({ completed: true, completedOn: '2026-10-15' })
    const recap = await agent.get('/api/today').query({ date: '2026-10-15' })
    expect(recap.body.planned[0]).toMatchObject({ title: 'Write the changelog', completed: true, completedOn: '2026-10-15' })
    expect(recap.body.finished).toEqual([])

    const elsewhere = await agent.post(`/api/projects/${id}/tasks`).send({ title: 'Finished off-plan', plannedFor: '2026-10-20' })
    await agent.patch(`/api/tasks/${elsewhere.body.id}`).send({ completed: true, completedOn: '2026-10-15' })
    const withFinished = await agent.get('/api/today').query({ date: '2026-10-15' })
    expect(withFinished.body.finished.map((task: { title: string }) => task.title)).toEqual(['Finished off-plan'])
    expect(withFinished.body.available.map((task: { title: string }) => task.title)).not.toContain('Finished off-plan')
    expect((await agent.get('/api/today')).status).toBe(400)
    expect((await agent.patch(`/api/tasks/${second.body.id}`).send({ plannedFor: '15-10-2026' })).status).toBe(400)
  })
})