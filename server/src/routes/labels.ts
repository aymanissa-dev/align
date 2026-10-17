import { Router } from 'express'
import { quoteTitle, recordActivity } from '../activity.ts'
import { assertVersion, expectedVersion, stampVersion } from '../concurrency.ts'
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
      const labels = await Label.find({ userId: currentUserId(req) })
        .select('name color createdAt __v')
        .sort({ name: 1 })
        .lean()
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
      await recordActivity({
        userId,
        type: 'create',
        summary: `Created label ${quoteTitle(label.name)}`,
      })
      stampVersion(res, label.__v)
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
      assertVersion(label.__v, expectedVersion(req))
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
      await recordActivity({
        userId,
        type: 'update',
        summary: `Updated label ${quoteTitle(label.name)}`,
      })
      stampVersion(res, label.__v)
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
      const name = label.name
      await label.deleteOne()
      await recordActivity({
        userId,
        type: 'delete',
        summary: `Deleted label ${quoteTitle(name)}`,
      })
      res.status(204).send()
    }),
  )

  return router
}
