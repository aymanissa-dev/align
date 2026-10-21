import { Router } from 'express'
import { quoteTitle, recordActivity } from '../activity.ts'
import { assertVersion, expectedVersion, stampVersion } from '../concurrency.ts'
import { bind } from '../data/content.ts'
import { currentTenant } from '../data/tenant.ts'
import { asyncHandler, requireAuth, requireWriter } from '../middleware.ts'
import { publicNote } from '../serialize.ts'
import { notePatchSchema, parseBody } from '../validate.ts'

export function notesRouter(): Router {
  const router = Router()
  router.use(requireAuth, requireWriter)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const db = bind(currentTenant(req))
      const projectIds = await db.activeProjectIds()
      const notes = await db.notes
        .find({ projectId: { $in: projectIds } })
        .select('projectId title body createdAt updatedAt __v')
        .sort({ updatedAt: -1 })
        .lean()
      res.json(notes.map(publicNote))
    }),
  )

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const note = await bind(currentTenant(req)).requireNote(req.params.id)
      stampVersion(res, note.__v)
      res.json(publicNote(note))
    }),
  )

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      const db = bind(tenant)
      const note = await db.requireNote(req.params.id)
      assertVersion(note.__v, expectedVersion(req))
      const input = parseBody(notePatchSchema, req.body)
      if (input.title !== undefined) note.title = input.title
      if (input.body !== undefined) note.body = input.body
      await note.save()
      await db.touchProject(note.projectId)
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        projectId: note.projectId,
        type: 'update',
        summary: `Updated note ${quoteTitle(note.title)}`,
      })
      stampVersion(res, note.__v)
      res.json(publicNote(note))
    }),
  )

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      const db = bind(tenant)
      const note = await db.requireNote(req.params.id)
      const projectId = note.projectId
      const title = note.title
      await db.softDeleteNote(note)
      await db.touchProject(projectId)
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        projectId,
        type: 'delete',
        summary: `Deleted note ${quoteTitle(title)}`,
      })
      res.status(204).send()
    }),
  )

  return router
}
