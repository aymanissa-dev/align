import { Router } from 'express'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Note } from '../models.ts'
import { publicNote } from '../serialize.ts'
import { requireNote, touchProject } from '../scope.ts'
import { notePatchSchema, parseBody } from '../validate.ts'

export function notesRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const notes = await Note.find({ userId: currentUserId(req) }).sort({ updatedAt: -1 })
      res.json(notes.map(publicNote))
    }),
  )

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const note = await requireNote(currentUserId(req), req.params.id)
      res.json(publicNote(note))
    }),
  )

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const note = await requireNote(userId, req.params.id)
      const input = parseBody(notePatchSchema, req.body)
      if (input.title !== undefined) note.title = input.title
      if (input.body !== undefined) note.body = input.body
      await note.save()
      await touchProject(note.projectId, userId)
      res.json(publicNote(note))
    }),
  )

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const note = await requireNote(userId, req.params.id)
      await note.deleteOne()
      await touchProject(note.projectId, userId)
      res.status(204).send()
    }),
  )

  return router
}
