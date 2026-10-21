import { Router } from 'express'
import { bind } from '../data/content.ts'
import { currentTenant } from '../data/tenant.ts'
import { asyncHandler, requireAuth, requireWriter } from '../middleware.ts'

export function trashRouter(): Router {
  const router = Router()
  router.use(requireAuth, requireWriter)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { projects, tasks, notes } = await bind(currentTenant(req)).trash()
      res.json({
        projects: projects.map((project) => ({
          id: project._id.toString(),
          name: project.name,
          deletedAt: project.deletedAt?.toISOString() ?? null,
          purgeAt: project.purgeAt?.toISOString() ?? null,
        })),
        tasks: tasks.map((task) => ({
          id: task._id.toString(),
          projectId: task.projectId.toString(),
          title: task.title,
          deletedAt: task.deletedAt?.toISOString() ?? null,
          purgeAt: task.purgeAt?.toISOString() ?? null,
        })),
        notes: notes.map((note) => ({
          id: note._id.toString(),
          projectId: note.projectId.toString(),
          title: note.title,
          deletedAt: note.deletedAt?.toISOString() ?? null,
          purgeAt: note.purgeAt?.toISOString() ?? null,
        })),
      })
    }),
  )

  router.post(
    '/projects/:id/restore',
    asyncHandler(async (req, res) => {
      const project = await bind(currentTenant(req)).restoreProject(req.params.id)
      res.json({ id: project.id, name: project.name })
    }),
  )

  router.post(
    '/tasks/:id/restore',
    asyncHandler(async (req, res) => {
      const task = await bind(currentTenant(req)).restoreTask(req.params.id)
      res.json({ id: task.id, title: task.title })
    }),
  )

  router.delete(
    '/projects/:id',
    asyncHandler(async (req, res) => {
      await bind(currentTenant(req)).purgeProject(req.params.id)
      res.status(204).send()
    }),
  )

  router.delete(
    '/tasks/:id',
    asyncHandler(async (req, res) => {
      await bind(currentTenant(req)).purgeTask(req.params.id)
      res.status(204).send()
    }),
  )

  router.post(
    '/notes/:id/restore',
    asyncHandler(async (req, res) => {
      const note = await bind(currentTenant(req)).restoreNote(req.params.id)
      res.json({ id: note.id, title: note.title })
    }),
  )

  router.delete(
    '/notes/:id',
    asyncHandler(async (req, res) => {
      await bind(currentTenant(req)).purgeNote(req.params.id)
      res.status(204).send()
    }),
  )

  router.post(
    '/empty',
    asyncHandler(async (req, res) => {
      await bind(currentTenant(req)).emptyTrash()
      res.status(204).send()
    }),
  )

  return router
}
