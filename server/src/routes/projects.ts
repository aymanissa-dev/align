import { Router } from 'express'
import { quoteTitle, recordActivity } from '../activity.ts'
import { assertVersion, expectedVersion, stampVersion } from '../concurrency.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Activity, Note, Notification, Project, Task, Whiteboard } from '../models.ts'
import { afterTaskCursor, afterTaskFilter, beforeCursor, beforeFilter, nextDateCursor, nextTaskCursor, pageLimit } from '../page.ts'
import { publicActivity, publicNote, publicProject, publicTask } from '../serialize.ts'
import { ownedLabelIds, requireProject, touchProject } from '../scope.ts'
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
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const status = req.query.status
      const filter: { userId: string; status?: 'active' | 'archived' } = { userId: currentUserId(req) }
      if (status !== undefined) {
        if (status !== 'active' && status !== 'archived') {
          res.status(400).json({ error: 'Status must be active or archived.' })
          return
        }
        filter.status = status
      }
      const projects = await Project.find(filter)
        .select('name description status createdAt updatedAt __v')
        .sort({ updatedAt: -1 })
        .lean()
      res.json(projects.map(publicProject))
    }),
  )

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = parseBody(projectCreateSchema, req.body)
      const userId = currentUserId(req)
      const project = await Project.create({
        userId,
        name: input.name,
        description: input.description ?? '',
        status: 'active',
      })
      await recordActivity({
        userId,
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
      const userId = currentUserId(req)
      const project = await requireProject(userId, req.params.id)
      const limit = pageLimit(req.query.limit)
      const cursor = afterTaskCursor(req.query.cursor)
      const base = { userId, projectId: project._id }
      const tasks = await Task.find(cursor ? { $and: [base, afterTaskFilter(cursor)] } : base)
        .select('projectId title completed dueDate priority labelIds plannedFor completedOn order createdAt updatedAt __v')
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
      const userId = currentUserId(req)
      const input = parseBody(taskCreateSchema, req.body)
      if (input.clientId) {
        const existing = await Task.findOne({ userId, clientId: input.clientId })
        if (existing) {
          res.json(publicTask(existing))
          return
        }
      }
      const project = await requireProject(userId, req.params.id)
      const dueDate = normalizeDueDate(input.dueDate) ?? null
      const labelIds = await ownedLabelIds(userId, input.labelIds ?? [])
      const latest = await Task.findOne({ projectId: project._id }).sort({ order: -1 }).select('order')
      try {
        const task = await Task.create({
          userId,
          projectId: project._id,
          title: input.title,
          completed: false,
          dueDate,
          priority: input.priority ?? 'medium',
          labelIds,
          plannedFor: normalizeDueDate(input.plannedFor) ?? null,
          order: (latest?.order ?? 0) + 1,
          ...(input.clientId ? { clientId: input.clientId } : {}),
        })
        await touchProject(project._id, userId)
        await recordActivity({
          userId,
          projectId: project._id,
          type: 'create',
          summary: `Created task ${quoteTitle(task.title)}`,
        })
        stampVersion(res, task.__v)
        res.status(201).json(publicTask(task))
      } catch (error) {
        if (input.clientId && isDuplicateKey(error)) {
          const existing = await Task.findOne({ userId, clientId: input.clientId })
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
      const userId = currentUserId(req)
      const project = await requireProject(userId, req.params.id)
      const notes = await Note.find({ userId, projectId: project._id })
        .select('projectId title body createdAt updatedAt __v')
        .sort({ updatedAt: -1 })
        .lean()
      res.json(notes.map(publicNote))
    }),
  )

  router.post(
    '/:id/notes',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const project = await requireProject(userId, req.params.id)
      const input = parseBody(noteCreateSchema, req.body)
      const note = await Note.create({
        userId,
        projectId: project._id,
        title: input.title ? input.title : 'Untitled',
        body: input.body ?? '',
      })
      await touchProject(project._id, userId)
      await recordActivity({
        userId,
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
      const userId = currentUserId(req)
      const project = await requireProject(userId, req.params.id)
      const board = await Whiteboard.findOne({ userId, projectId: project._id }).select('scene').lean()
      res.json({ scene: board?.scene ?? emptyScene })
    }),
  )

  router.put(
    '/:id/whiteboard',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const project = await requireProject(userId, req.params.id)
      const scene = parseBody(whiteboardSceneSchema, req.body?.scene ?? req.body)
      const board = await Whiteboard.findOneAndUpdate(
        { userId, projectId: project._id },
        { userId, projectId: project._id, scene },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      res.json({ scene: board?.scene ?? scene })
    }),
  )

  router.get(
    '/:id/activity',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const project = await requireProject(userId, req.params.id)
      const limit = pageLimit(req.query.limit)
      const cursor = beforeCursor(req.query.cursor)
      const scope = { userId, $or: [{ projectId: project._id }, { projectId: null }] }
      const items = await Activity.find(cursor ? { $and: [scope, beforeFilter(cursor)] } : scope)
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
      const project = await requireProject(currentUserId(req), req.params.id)
      stampVersion(res, project.__v)
      res.json(publicProject(project))
    }),
  )

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const project = await requireProject(currentUserId(req), req.params.id)
      assertVersion(project.__v, expectedVersion(req))
      const input = parseBody(projectPatchSchema, req.body)
      if (input.name !== undefined) project.name = input.name
      if (input.description !== undefined) project.description = input.description
      await project.save()
      await recordActivity({
        userId: currentUserId(req),
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
      const project = await requireProject(currentUserId(req), req.params.id)
      assertVersion(project.__v, expectedVersion(req))
      project.status = project.status === 'active' ? 'archived' : 'active'
      await project.save()
      await recordActivity({
        userId: currentUserId(req),
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
      const userId = currentUserId(req)
      const project = await requireProject(userId, req.params.id)
      const taskIds = await Task.find({ userId, projectId: project._id }).distinct('_id')
      await Notification.deleteMany({ userId, taskId: { $in: taskIds } })
      await Activity.deleteMany({ userId, projectId: project._id })
      await Whiteboard.deleteMany({ userId, projectId: project._id })
      await Task.deleteMany({ userId, projectId: project._id })
      await Note.deleteMany({ userId, projectId: project._id })
      await project.deleteOne()
      res.status(204).send()
    }),
  )

  return router
}
