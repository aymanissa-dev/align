import { Router } from 'express'
import { quoteTitle, recordActivity } from '../activity.ts'
import { assertVersion, expectedVersion, stampVersion } from '../concurrency.ts'
import { bind } from '../data/content.ts'
import { currentTenant } from '../data/tenant.ts'
import { asyncHandler, requireAuth, requireWriter } from '../middleware.ts'
import { afterTaskCursor, afterTaskFilter, beforeCursor, beforeFilter, nextDateCursor, nextTaskCursor, pageLimit } from '../page.ts'
import { publicActivity, publicNote, publicProject, publicTask, TASK_FIELDS } from '../serialize.ts'
import {
  normalizeDueDate,
  noteCreateSchema,
  parseBody,
  projectCreateSchema,
  projectPatchSchema,
  taskCreateSchema,
  emptyScene,
  whiteboardSceneSchema,
} from '../validate.ts'

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
}

export function projectsRouter(): Router {
  const router = Router()
  router.use(requireAuth, requireWriter)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const db = bind(currentTenant(req))
      const status = req.query.status
      const filter: { status?: 'active' | 'archived' } = {}
      if (status !== undefined) {
        if (status !== 'active' && status !== 'archived') {
          res.status(400).json({ error: 'Status must be active or archived.' })
          return
        }
        filter.status = status
      }
      const projects = await db.projects.find(filter).select('name description status createdAt updatedAt __v').sort({ updatedAt: -1 }).lean()
      res.json(projects.map(publicProject))
    }),
  )

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      const db = bind(tenant)
      const input = parseBody(projectCreateSchema, req.body)
      const project = await db.projects.create({
        name: input.name,
        description: input.description ?? '',
        status: 'active',
      })
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        projectId: project._id,
        type: 'create',
        summary: `Created project ${quoteTitle(project.name)}`,
      })
      stampVersion(res, project.__v)
      res.status(201).json(publicProject(project))
    }),
  )

  router.get(
    '/:id/tasks',
    asyncHandler(async (req, res) => {
      const db = bind(currentTenant(req))
      const project = await db.requireProject(req.params.id)
      const limit = pageLimit(req.query.limit)
      const cursor = afterTaskCursor(req.query.cursor)
      const base = { projectId: project._id }
      const tasks = await db.tasks
        .find(cursor ? { $and: [base, afterTaskFilter(cursor)] } : base)
        .select(TASK_FIELDS)
        .sort({ order: 1, createdAt: 1, _id: 1 })
        .limit(limit + 1)
        .lean()
      const next = nextTaskCursor(tasks, limit)
      if (next) res.set('X-Next-Cursor', next)
      res.json(tasks.slice(0, limit).map(publicTask))
    }),
  )

  router.post(
    '/:id/tasks',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      const db = bind(tenant)
      const input = parseBody(taskCreateSchema, req.body)
      if (input.clientId) {
        const existing = await db.tasks.findOne({ userId: db.userId, clientId: input.clientId })
        if (existing) {
          res.json(publicTask(existing))
          return
        }
      }
      const project = await db.requireProject(req.params.id)
      const dueDate = normalizeDueDate(input.dueDate) ?? null
      const labelIds = await db.ownedLabelIds(input.labelIds ?? [])
      const latest = await db.tasks.findOne({ projectId: project._id }).sort({ order: -1 }).select('order')
      const status = input.status === 'doing' || input.status === 'done' ? input.status : 'todo'
      try {
        const task = await db.tasks.create({
          projectId: project._id,
          title: input.title,
          completed: status === 'done',
          dueDate,
          priority: input.priority ?? 'medium',
          labelIds,
          plannedFor: normalizeDueDate(input.plannedFor) ?? null,
          completedOn: status === 'done' ? new Date().toISOString().slice(0, 10) : null,
          order: (latest?.order ?? 0) + 1,
          status,
          recurrence: input.recurrence ?? null,
          subtasks: input.subtasks ?? [],
          ...(input.clientId ? { clientId: input.clientId } : {}),
        })
        const side = Promise.all([
          db.touchProject(project._id),
          recordActivity({
            userId: tenant.userId,
            workspaceId: tenant.workspaceId,
            projectId: project._id,
            type: 'create',
            summary: `Created task ${quoteTitle(task.title)}`,
          }),
        ])
        if (process.env.NODE_ENV === 'test') await side
        else void side.catch(() => undefined)
        stampVersion(res, task.__v)
        res.status(201).json(publicTask(task))
      } catch (error) {
        if (input.clientId && isDuplicateKey(error)) {
          const existing = await db.tasks.findOne({ userId: db.userId, clientId: input.clientId })
          if (existing) {
            res.json(publicTask(existing))
            return
          }
        }
        throw error
      }
    }),
  )

  router.get(
    '/:id/notes',
    asyncHandler(async (req, res) => {
      const db = bind(currentTenant(req))
      const project = await db.requireProject(req.params.id)
      const notes = await db.notes.find({ projectId: project._id }).select('projectId title body createdAt updatedAt __v').sort({ updatedAt: -1 }).lean()
      res.json(notes.map(publicNote))
    }),
  )

  router.post(
    '/:id/notes',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      const db = bind(tenant)
      const project = await db.requireProject(req.params.id)
      const input = parseBody(noteCreateSchema, req.body)
      const note = await db.notes.create({
        projectId: project._id,
        title: input.title ? input.title : 'Untitled',
        body: input.body ?? '',
      })
      await db.touchProject(project._id)
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        projectId: project._id,
        type: 'create',
        summary: `Created note ${quoteTitle(note.title)}`,
      })
      stampVersion(res, note.__v)
      res.status(201).json(publicNote(note))
    }),
  )

  router.get(
    '/:id/whiteboard',
    asyncHandler(async (req, res) => {
      const db = bind(currentTenant(req))
      const project = await db.requireProject(req.params.id)
      const board = await db.whiteboards.findOne({ projectId: project._id }).select('scene').lean()
      res.json({ scene: board?.scene ?? emptyScene })
    }),
  )

  router.put(
    '/:id/whiteboard',
    asyncHandler(async (req, res) => {
      const db = bind(currentTenant(req))
      const project = await db.requireProject(req.params.id)
      const scene = parseBody(whiteboardSceneSchema, req.body?.scene ?? req.body)
      const board = await db.whiteboards.save(project._id, scene)
      res.json({ scene: board?.scene ?? scene })
    }),
  )

  router.get(
    '/:id/activity',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      const db = bind(tenant)
      const project = await db.requireProject(req.params.id)
      const limit = pageLimit(req.query.limit)
      const cursor = beforeCursor(req.query.cursor)
      const scope = { userId: db.userId, $or: [{ projectId: project._id }, { projectId: null }] }
      const items = await db.activity
        .find(cursor ? { $and: [scope, beforeFilter(cursor)] } : scope)
        .select('projectId type summary createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean()
      const next = nextDateCursor(items, limit)
      if (next) res.set('X-Next-Cursor', next)
      res.json(items.slice(0, limit).map(publicActivity))
    }),
  )

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const project = await bind(currentTenant(req)).requireProject(req.params.id)
      stampVersion(res, project.__v)
      res.json(publicProject(project))
    }),
  )

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      const db = bind(tenant)
      const project = await db.requireProject(req.params.id)
      assertVersion(project.__v, expectedVersion(req))
      const input = parseBody(projectPatchSchema, req.body)
      if (input.name !== undefined) project.name = input.name
      if (input.description !== undefined) project.description = input.description
      await project.save()
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        projectId: project._id,
        type: 'update',
        summary: `Updated project ${quoteTitle(project.name)}`,
      })
      stampVersion(res, project.__v)
      res.json(publicProject(project))
    }),
  )

  router.patch(
    '/:id/archive',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      const db = bind(tenant)
      const project = await db.requireProject(req.params.id)
      assertVersion(project.__v, expectedVersion(req))
      project.status = project.status === 'active' ? 'archived' : 'active'
      await project.save()
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        projectId: project._id,
        type: 'update',
        summary: project.status === 'archived' ? `Archived project ${quoteTitle(project.name)}` : `Restored project ${quoteTitle(project.name)}`,
      })
      stampVersion(res, project.__v)
      res.json(publicProject(project))
    }),
  )

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const db = bind(currentTenant(req))
      const project = await db.requireProject(req.params.id)
      await db.softDeleteProject(project)
      res.status(204).send()
    }),
  )

  return router
}
