import { Router } from 'express'
import { quoteTitle, recordActivity } from '../activity.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Activity, Note, Notification, Project, Task } from '../models.ts'
import { publicActivity, publicNote, publicProject, publicTask } from '../serialize.ts'
import { ownedLabelIds, requireProject, touchProject } from '../scope.ts'
import {
  normalizeDueDate,
  noteCreateSchema,
  parseBody,
  projectCreateSchema,
  projectPatchSchema,
  taskCreateSchema,
} from '../validate.ts'

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
      const projects = await Project.find(filter).sort({ updatedAt: -1 })
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
      res.status(201).json(publicProject(project))
    }),
  )

  router.get(
    '/:id/tasks',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const project = await requireProject(userId, req.params.id)
      const tasks = await Task.find({ userId, projectId: project._id }).sort({ order: 1, createdAt: 1 })
      res.json(tasks.map(publicTask))
    }),
  )

  router.post(
    '/:id/tasks',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const project = await requireProject(userId, req.params.id)
      const input = parseBody(taskCreateSchema, req.body)
      const dueDate = normalizeDueDate(input.dueDate) ?? null
      const labelIds = await ownedLabelIds(userId, input.labelIds ?? [])
      const latest = await Task.findOne({ projectId: project._id }).sort({ order: -1 }).select('order')
      const task = await Task.create({
        userId,
        projectId: project._id,
        title: input.title,
        completed: false,
        dueDate,
        priority: input.priority ?? 'medium',
        labelIds,
        order: (latest?.order ?? 0) + 1,
      })
      await touchProject(project._id, userId)
      await recordActivity({
        userId,
        projectId: project._id,
        type: 'create',
        summary: `Created task ${quoteTitle(task.title)}`,
      })
      res.status(201).json(publicTask(task))
    }),
  )

  router.get(
    '/:id/notes',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const project = await requireProject(userId, req.params.id)
      const notes = await Note.find({ userId, projectId: project._id }).sort({ updatedAt: -1 })
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
      res.status(201).json(publicNote(note))
    }),
  )

  router.get(
    '/:id/activity',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const project = await requireProject(userId, req.params.id)
      const items = await Activity.find({ userId, projectId: project._id }).sort({ createdAt: -1, _id: -1 }).limit(100)
      res.json(items.map(publicActivity))
    }),
  )

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const project = await requireProject(currentUserId(req), req.params.id)
      res.json(publicProject(project))
    }),
  )

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const project = await requireProject(currentUserId(req), req.params.id)
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
      res.json(publicProject(project))
    }),
  )

  router.patch(
    '/:id/archive',
    asyncHandler(async (req, res) => {
      const project = await requireProject(currentUserId(req), req.params.id)
      project.status = project.status === 'active' ? 'archived' : 'active'
      await project.save()
      await recordActivity({
        userId: currentUserId(req),
        projectId: project._id,
        type: 'update',
        summary: project.status === 'archived' ? `Archived project ${quoteTitle(project.name)}` : `Restored project ${quoteTitle(project.name)}`,
      })
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
      await Task.deleteMany({ userId, projectId: project._id })
      await Note.deleteMany({ userId, projectId: project._id })
      await project.deleteOne()
      res.status(204).send()
    }),
  )

  return router
}
