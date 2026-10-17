import { describe, expect, it } from 'vitest'
import { Project, Task } from '../src/models.ts'
import { registerUser } from './helpers.ts'

describe('dashboard and search', () => {
  it('reports progress for active projects and open tasks', async () => {
    const { agent } = await registerUser()
    const active = await agent.post('/api/projects').send({ name: 'Website refresh', description: 'Fewer pages.' })
    const archived = await agent.post('/api/projects').send({ name: 'Old workshop' })
    const activeId = active.body.id as string
    const archivedId = archived.body.id as string

    await agent.post(`/api/projects/${activeId}/tasks`).send({ title: 'Later', dueDate: '2026-10-22' })
    const done = await agent.post(`/api/projects/${activeId}/tasks`).send({ title: 'Done already' })
    await agent.patch(`/api/tasks/${done.body.id}`).send({ completed: true })
    await agent.post(`/api/projects/${activeId}/tasks`).send({ title: 'Soon', dueDate: '2026-10-16' })
    await agent.post(`/api/projects/${archivedId}/tasks`).send({ title: 'Hidden' })
    await agent.patch(`/api/projects/${archivedId}/archive`)

    const dashboard = await agent.get('/api/dashboard')
    expect(dashboard.status).toBe(200)
    expect(dashboard.body.projects).toEqual([
      expect.objectContaining({
        id: activeId,
        name: 'Website refresh',
        description: 'Fewer pages.',
        taskCount: 3,
        completedCount: 1,
        percentComplete: 33,
      }),
    ])
    expect(dashboard.body.openTasks.map((task: { title: string }) => task.title)).toEqual(['Soon', 'Later'])
    expect(dashboard.body.openTasks[0]).toMatchObject({
      projectName: 'Website refresh',
      dueDate: '2026-10-16',
      completed: false,
    })
  })

  it('groups search results and keeps them inside the account', async () => {
    const owner = await registerUser('Owner')
    const other = await registerUser('Other')
    const project = await owner.agent.post('/api/projects').send({
      name: 'Quartz lamp',
      description: 'A beeswax shade.',
    })
    const id = project.body.id as string
    await owner.agent.post(`/api/projects/${id}/tasks`).send({ title: 'Cut the wick' })
    await owner.agent.post(`/api/projects/${id}/notes`).send({
      title: 'Materials',
      body: 'Use beeswax, not paraffin.',
    })
    await other.agent.post('/api/projects').send({ name: 'Quartz lamp' })

    const full = await owner.agent.get('/api/search').query({ q: 'quartz' })
    expect(full.body.projects.map((item: { name: string }) => item.name)).toEqual(['Quartz lamp'])
    expect(full.body.tasks).toEqual([])
    expect(full.body.notes).toEqual([])

    const partial = await owner.agent.get('/api/search').query({ q: 'wick' })
    expect(partial.body.tasks).toEqual([
      expect.objectContaining({ title: 'Cut the wick', projectName: 'Quartz lamp', completed: false }),
    ])

    const body = await owner.agent.get('/api/search').query({ q: 'beeswax' })
    expect(body.body.notes).toHaveLength(1)
    expect(body.body.notes[0]).toMatchObject({ title: 'Materials', projectName: 'Quartz lamp' })
    expect(body.body.projects.map((item: { name: string }) => item.name)).toContain('Quartz lamp')

    const foreign = await other.agent.get('/api/search').query({ q: 'wick' })
    expect(foreign.body).toEqual({ projects: [], tasks: [], notes: [] })

    const empty = await owner.agent.get('/api/search').query({ q: '   ' })
    expect(empty.body).toEqual({ projects: [], tasks: [], notes: [] })
    const short = await owner.agent.get('/api/search').query({ q: 'wi' })
    expect(short.body).toEqual({ projects: [], tasks: [], notes: [] })

    await owner.agent.post(`/api/projects/${id}/tasks`).send({ title: 'R2 overdue' })
    await owner.agent.post(`/api/projects/${id}/tasks`).send({ title: 'R2 future' })
    const prefixed = await owner.agent.get('/api/search').query({ q: 'R2 ov' })
    expect(prefixed.body.tasks.map((task: { title: string }) => task.title)).toEqual(['R2 overdue'])

    const indexes = await Project.collection.indexes()
    const taskIndexes = await Task.collection.indexes()
    expect(indexes.some((index) => index.key?._fts === 'text')).toBe(true)
    expect(indexes.some((index) => index.key?.userId === 1 && index.key?.status === 1)).toBe(true)
    expect(taskIndexes.some((index) => index.key?.projectId === 1 && index.key?.completed === 1)).toBe(true)
  })
})
