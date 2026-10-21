import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { PERSONAL_WORKSPACES } from '../src/migrate/personalWorkspaces.ts'
import { runMigrations } from '../src/migrate/runner.ts'
import { Note, Project, Task, User } from '../src/models.ts'
import { hashPassword } from '../src/password.ts'
import { app, registerUser } from './helpers.ts'

describe('tenancy', () => {
  it('keeps route handlers off the raw models', () => {
    const dir = join(import.meta.dirname, '../src/routes')
    const offenders = readdirSync(dir)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => /from ['"][^'"]*models/.test(readFileSync(join(dir, file), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('isolates one account from another, including trash', async () => {
    const owner = await registerUser('Owner')
    const other = await registerUser('Other')
    const created = await owner.agent.post('/api/projects').send({ name: 'Private' })
    const projectId = created.body.id as string
    const task = await owner.agent.post(`/api/projects/${projectId}/tasks`).send({ title: 'Hidden task' })
    const note = await owner.agent.post(`/api/projects/${projectId}/notes`).send({ title: 'Hidden note', body: 'no' })
    expect(task.status).toBe(201)
    expect(note.status).toBe(201)

    expect((await other.agent.get('/api/projects')).body).toEqual([])
    expect((await other.agent.get(`/api/projects/${projectId}`)).status).toBe(404)
    expect((await other.agent.patch(`/api/projects/${projectId}`).send({ name: 'Stolen' })).status).toBe(404)
    expect((await other.agent.delete(`/api/projects/${projectId}`)).status).toBe(404)
    expect((await other.agent.get(`/api/projects/${projectId}/tasks`)).status).toBe(404)
    expect((await other.agent.patch(`/api/tasks/${task.body.id}`).send({ title: 'Stolen' })).status).toBe(404)
    expect((await other.agent.get(`/api/notes/${note.body.id}`)).status).toBe(404)
    expect((await other.agent.get('/api/trash')).body).toEqual({ projects: [], tasks: [] })
    expect((await other.agent.post(`/api/trash/projects/${projectId}/restore`)).status).toBe(404)
  })

  it('enforces workspace roles', async () => {
    const owner = await registerUser('Owner')
    const viewer = await registerUser('Viewer')
    const member = await registerUser('Member')
    const shared = await owner.agent.post('/api/workspaces').send({ name: 'Studio' })
    expect(shared.status).toBe(201)
    const workspaceId = shared.body.id as string
    const header = { 'x-workspace-id': workspaceId }

    expect((await owner.agent.post('/api/workspaces/members').set(header).send({ email: viewer.email, role: 'viewer' })).status).toBe(201)
    expect((await owner.agent.post('/api/workspaces/members').set(header).send({ email: member.email, role: 'member' })).status).toBe(201)
    expect((await viewer.agent.post('/api/workspaces/members').set(header).send({ email: member.email, role: 'admin' })).status).toBe(403)

    expect((await viewer.agent.get('/api/projects').set(header)).status).toBe(200)
    expect((await viewer.agent.post('/api/projects').set(header).send({ name: 'Nope' })).status).toBe(403)
    const created = await member.agent.post('/api/projects').set(header).send({ name: 'Shared board' })
    expect(created.status).toBe(201)
    expect((await owner.agent.get('/api/projects').set(header)).body.map((project: { name: string }) => project.name)).toContain('Shared board')
    expect((await owner.agent.get('/api/projects')).body).toEqual([])

    expect((await owner.agent.patch(`/api/workspaces/members/${member.id}`).set(header).send({ role: 'admin' })).status).toBe(200)
    expect((await owner.agent.delete(`/api/workspaces/members/${viewer.id}`).set(header)).status).toBe(204)
    expect((await viewer.agent.get('/api/projects').set(header)).status).toBe(403)
    const stale = await viewer.agent.get('/api/projects')
    expect(stale.status).toBe(401)
    expect(stale.body).toEqual({
      error: 'You no longer have access to this workspace.',
      code: 'membership_changed',
    })
    expect((await viewer.agent.post('/api/auth/refresh')).status).toBe(200)
    expect((await viewer.agent.get('/api/projects')).status).toBe(200)
    expect((await viewer.agent.get('/api/projects').set(header)).status).toBe(403)
  })

  it('moves unscoped documents into a personal workspace and can roll back', async () => {
    await runMigrations({ direction: 'down', only: PERSONAL_WORKSPACES })
    const user = await User.create({
      name: 'Mig',
      email: `mig-${crypto.randomUUID()}@align.test`,
      passwordHash: await hashPassword('password12'),
    })
    await Project.create({ userId: user._id, name: 'Loose', status: 'active' })
    await Task.create({ userId: user._id, projectId: (await Project.findOne({ name: 'Loose' }))!._id, title: 'Loose task', order: 1 })

    const dry = await runMigrations({ dryRun: true, direction: 'up', only: PERSONAL_WORKSPACES })
    expect(dry[0]?.dryRun).toBe(true)
    expect(dry[0]?.counts.users).toBeGreaterThanOrEqual(1)
    expect(dry[0]?.counts.projects).toBeGreaterThanOrEqual(1)
    expect((await Project.findOne({ name: 'Loose' }))?.workspaceId).toBeFalsy()

    const applied = await runMigrations({ direction: 'up', only: PERSONAL_WORKSPACES })
    expect(applied[0]?.counts.projects).toBeGreaterThanOrEqual(1)
    expect(applied[0]?.counts.tasks).toBeGreaterThanOrEqual(1)
    expect((await Project.findOne({ name: 'Loose' }))?.workspaceId).toBeTruthy()
    expect(await runMigrations({ direction: 'up', only: PERSONAL_WORKSPACES })).toEqual([])

    const down = await runMigrations({ direction: 'down', only: PERSONAL_WORKSPACES })
    expect(down[0]?.direction).toBe('down')
    expect((await Project.findOne({ name: 'Loose' }))?.workspaceId).toBeFalsy()
    const dryDown = await runMigrations({ dryRun: true, direction: 'down', only: PERSONAL_WORKSPACES })
    expect(dryDown[0]?.dryRun).toBe(true)

    await runMigrations({ direction: 'up', only: PERSONAL_WORKSPACES })
  })

  it('soft-deletes into trash and restores within the workspace', async () => {
    const { agent } = await registerUser()
    const created = await agent.post('/api/projects').send({ name: 'Cabinet' })
    const projectId = created.body.id as string
    const kept = await agent.post(`/api/projects/${projectId}/tasks`).send({ title: 'Keep me' })
    const alone = await agent.post(`/api/projects/${projectId}/tasks`).send({ title: 'Alone' })
    await agent.post(`/api/projects/${projectId}/notes`).send({ title: 'Note', body: 'Still here' })

    expect((await agent.delete(`/api/tasks/${alone.body.id}`)).status).toBe(204)
    expect((await agent.get(`/api/projects/${projectId}/tasks`)).body.map((task: { title: string }) => task.title)).toEqual(['Keep me'])
    expect((await agent.post(`/api/trash/tasks/${alone.body.id}/restore`)).status).toBe(200)
    expect((await agent.get(`/api/projects/${projectId}/tasks`)).body.map((task: { title: string }) => task.title)).toContain('Alone')

    expect((await agent.delete(`/api/projects/${projectId}`)).status).toBe(204)
    expect((await agent.get('/api/projects')).body).toEqual([])
    expect(await Task.countDocuments({ projectId, deletedAt: null })).toBe(0)
    expect(await Note.countDocuments({ projectId })).toBe(1)
    const trash = await agent.get('/api/trash')
    expect(trash.body.projects.map((project: { name: string }) => project.name)).toContain('Cabinet')
    expect((await agent.post(`/api/trash/tasks/${kept.body.id}/restore`)).status).toBe(409)

    const restored = await agent.post(`/api/trash/projects/${projectId}/restore`)
    expect(restored.status).toBe(200)
    expect((await agent.get(`/api/projects/${projectId}`)).body.name).toBe('Cabinet')
    expect((await agent.get(`/api/projects/${projectId}/tasks`)).body.length).toBeGreaterThan(0)
    expect((await request(app).get('/api/trash')).status).toBe(401)
  })

  it('permanently deletes one trashed item and can empty the rest', async () => {
    const { agent } = await registerUser()
    const other = await registerUser()
    const created = await agent.post('/api/projects').send({ name: 'Burn box' })
    const projectId = created.body.id as string
    const task = await agent.post(`/api/projects/${projectId}/tasks`).send({ title: 'Kindling' })
    await agent.post(`/api/projects/${projectId}/notes`).send({ title: 'Note', body: 'Gone with the project' })
    expect((await agent.delete(`/api/projects/${projectId}`)).status).toBe(204)
    expect((await other.agent.delete(`/api/trash/projects/${projectId}`)).status).toBe(404)
    expect((await agent.delete(`/api/trash/projects/${projectId}`)).status).toBe(204)
    expect(await Task.countDocuments({ projectId })).toBe(0)
    expect(await Note.countDocuments({ projectId })).toBe(0)
    expect((await agent.get('/api/trash')).body.projects).toEqual([])

    const kept = await agent.post('/api/projects').send({ name: 'Stay' })
    const loose = await agent.post(`/api/projects/${kept.body.id}/tasks`).send({ title: 'Scrap' })
    expect((await agent.delete(`/api/tasks/${loose.body.id}`)).status).toBe(204)
    expect((await agent.delete(`/api/trash/tasks/${loose.body.id}`)).status).toBe(204)
    expect(await Task.countDocuments({ _id: loose.body.id })).toBe(0)
    expect((await agent.get(`/api/projects/${kept.body.id}`)).body.name).toBe('Stay')

    const doomed = await agent.post('/api/projects').send({ name: 'Pile' })
    const child = await agent.post(`/api/projects/${doomed.body.id}/tasks`).send({ title: 'Leaf' })
    await agent.post(`/api/projects/${doomed.body.id}/notes`).send({ title: 'Slip', body: 'Paper' })
    expect((await agent.delete(`/api/projects/${doomed.body.id}`)).status).toBe(204)
    expect((await agent.post('/api/trash/empty')).status).toBe(204)
    expect((await agent.get('/api/trash')).body).toEqual({ projects: [], tasks: [] })
    expect(await Task.countDocuments({ _id: child.body.id })).toBe(0)
    expect(await Note.countDocuments({ projectId: doomed.body.id })).toBe(0)
    expect(task.body.id).toEqual(expect.any(String))
  })
})
