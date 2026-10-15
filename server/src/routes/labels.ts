import { Router } from 'express'
import { HttpError } from '../errors.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Label, Task } from '../models.ts'
import { objectId } from '../scope.ts'
import { publicLabel } from '../serialize.ts'
import { labelCreateSchema, labelPatchSchema, parseBody } from '../validate.ts'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function labelsRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const labels = await Label.find({ userId: currentUserId(req) }).sort({ name: 1 })
      res.json(labels.map(publicLabel))
    }),
  )

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const input = parseBody(labelCreateSchema, req.body)
      const duplicate = await Label.findOne({
        userId,
        name: new RegExp(`^${escapeRegExp(input.name)}$`, 'i'),
      })
      if (duplicate) throw new HttpError(409, 'A label with that name already exists.')
      const label = await Label.create({
        userId,
        name: input.name,
        color: input.color.toLowerCase(),
      })
      res.status(201).json(publicLabel(label))
    }),
  )

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const labelId = objectId(req.params.id)
      if (!labelId) throw new HttpError(404, 'Label not found.')
      const label = await Label.findOne({ _id: labelId, userId })
      if (!label) throw new HttpError(404, 'Label not found.')
      const input = parseBody(labelPatchSchema, req.body)
      if (input.name !== undefined && input.name.toLowerCase() !== label.name.toLowerCase()) {
        const duplicate = await Label.findOne({
          userId,
          name: new RegExp(`^${escapeRegExp(input.name)}$`, 'i'),
        })
        if (duplicate) throw new HttpError(409, 'A label with that name already exists.')
        label.name = input.name
      }
      if (input.color !== undefined) label.color = input.color.toLowerCase()
      await label.save()
      res.json(publicLabel(label))
    }),
  )

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const labelId = objectId(req.params.id)
      if (!labelId) throw new HttpError(404, 'Label not found.')
      const label = await Label.findOne({ _id: labelId, userId })
      if (!label) throw new HttpError(404, 'Label not found.')
      await Task.updateMany({ userId, labelIds: label._id }, { $pull: { labelIds: label._id } })
      await label.deleteOne()
      res.status(204).send()
    }),
  )

  return router
}
