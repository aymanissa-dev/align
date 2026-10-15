import { Router } from 'express'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Note, Project, Task } from '../models.ts'
import { publicNote, publicProject, publicTask } from '../serialize.ts'
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
      const project = await Project.create({
        userId: currentUserId(req),
        name: input.name,
        description: input.description ?? '',
        status: 'active',
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
      res.status(201).json(publicNote(note))
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
      res.json(publicProject(project))
    }),
  )

  router.patch(
    '/:id/archive',
    asyncHandler(async (req, res) => {
      const project = await requireProject(currentUserId(req), req.params.id)
      project.status = project.status === 'active' ? 'archived' : 'active'
      await project.save()
      res.json(publicProject(project))
    }),
  )

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const project = await requireProject(userId, req.params.id)
      await Task.deleteMany({ userId, projectId: project._id })
      await Note.deleteMany({ userId, projectId: project._id })
      await project.deleteOne()
      res.status(204).send()
    }),
  )

  return router
}
