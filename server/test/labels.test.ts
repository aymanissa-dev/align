import { describe, expect, it } from 'vitest'
import { registerUser } from './helpers.ts'

describe('priorities and labels', () => {
  it('stores priority and user labels on tasks, and rejects another account’s labels', async () => {
    const owner = await registerUser()
    const other = await registerUser('Grace')
    const project = await owner.agent.post('/api/projects').send({ name: 'Launch' })
    const projectId = project.body.id as string

    const created = await owner.agent.post('/api/labels').send({ name: 'Design', color: '#1D4ED8' })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ name: 'Design', color: '#1d4ed8' })

    const duplicate = await owner.agent.post('/api/labels').send({ name: 'design', color: '#171717' })
    expect(duplicate.status).toBe(409)

    const invalid = await owner.agent.post('/api/labels').send({ name: 'Ops', color: 'blue' })
    expect(invalid.status).toBe(400)

    const task = await owner.agent.post(`/api/projects/${projectId}/tasks`).send({
      title: 'Set type',
      dueDate: '2026-10-18',
      priority: 'high',
      labelIds: [created.body.id],
    })
    expect(task.status).toBe(201)
    expect(task.body).toMatchObject({
      priority: 'high',
      labelIds: [created.body.id],
      dueDate: '2026-10-18',
    })

    const def = await owner.agent.post(`/api/projects/${projectId}/tasks`).send({ title: 'Default' })
    expect(def.body.priority).toBe('medium')
    expect(def.body.labelIds).toEqual([])

    const stolen = await owner.agent.post(`/api/projects/${projectId}/tasks`).send({
      title: 'Nope',
      labelIds: ['507f1f77bcf86cd799439011'],
    })
    expect(stolen.status).toBe(400)

    const foreign = await other.agent.get('/api/labels')
    expect(foreign.body).toEqual([])
    expect((await other.agent.delete(`/api/labels/${created.body.id}`)).status).toBe(404)

    const renamed = await owner.agent.patch(`/api/labels/${created.body.id}`).send({ name: 'Visual', color: '#047857' })
    expect(renamed.body).toMatchObject({ name: 'Visual', color: '#047857' })

    const cleared = await owner.agent.patch(`/api/tasks/${task.body.id}`).send({ priority: 'urgent', labelIds: [] })
    expect(cleared.body).toMatchObject({ priority: 'urgent', labelIds: [] })
    expect((await owner.agent.patch(`/api/tasks/${task.body.id}`).send({ priority: 'critical' })).status).toBe(400)

    expect((await owner.agent.delete(`/api/labels/${created.body.id}`)).status).toBe(204)
    const listed = await owner.agent.get(`/api/projects/${projectId}/tasks`)
    expect(listed.body.every((item: { labelIds: string[] }) => item.labelIds.length === 0)).toBe(true)
  })
})
