import { Router } from 'express'
import { Types } from 'mongoose'
import { HttpError } from '../errors.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Notification, Project, Task } from '../models.ts'
import { beforeCursor, beforeFilter, nextDateCursor, pageLimit } from '../page.ts'
import { objectId } from '../scope.ts'
import { publicNotification } from '../serialize.ts'
import { shiftISODate } from '../dates.ts'
import { normalizeDueDate } from '../validate.ts'

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

export function notificationsRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const todayParam = typeof req.query.today === 'string' ? req.query.today : ''
      const today = normalizeDueDate(todayParam)
      if (!today) throw new HttpError(400, 'Use a valid date.')
      const tomorrow = shiftISODate(today, 1)

      const tasks = await Task.find({ userId, completed: false, dueDate: { $ne: null } })
        .select('title dueDate projectId')
        .lean()
      const projects = await Project.find({ userId }).select('name').lean()
      const names = new Map(projects.map((project) => [project._id.toString(), project.name]))
      const expireAt = new Date(Date.now() + NINETY_DAYS_MS)
      const userObjectId = new Types.ObjectId(userId)
      const writes = tasks.flatMap((task) => {
        if (!task.dueDate) return []
        const kind: 'overdue' | 'due-soon' | null =
          task.dueDate < today ? 'overdue' : task.dueDate > today && task.dueDate <= tomorrow ? 'due-soon' : null
        if (!kind) return []
        const key = `${task._id.toString()}:${kind}:${task.dueDate}`
        return [
          {
            updateOne: {
              filter: { userId: userObjectId, key },
              update: {
                $setOnInsert: {
                  userId: userObjectId,
                  projectId: task.projectId,
                  taskId: task._id,
                  kind,
                  dueDate: task.dueDate,
                  read: false,
                  key,
                  expireAt,
                },
                $set: {
                  title: task.title,
                  projectName: names.get(task.projectId.toString()) ?? 'Project',
                },
              },
              upsert: true,
            },
          },
        ]
      })
      await Notification.bulkWrite([
        ...writes,
        {
          updateMany: {
            filter: { userId: userObjectId, expireAt: { $exists: false } },
            update: { $set: { expireAt } },
          },
        },
      ])

      const limit = pageLimit(req.query.limit)
      const cursor = beforeCursor(req.query.cursor)
      const filter = cursor ? { $and: [{ userId }, beforeFilter(cursor)] } : { userId }
      const items = await Notification.find(filter)
        .select('projectId taskId kind title projectName dueDate read createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean()
      const next = nextDateCursor(items, limit)
      if (next) res.set('X-Next-Cursor', next)
      res.json(items.slice(0, limit).map(publicNotification))
    }),
  )

  router.post(
    '/read-all',
    asyncHandler(async (req, res) => {
      await Notification.updateMany({ userId: currentUserId(req), read: false }, { read: true })
      res.status(204).send()
    }),
  )

  router.post(
    '/:id/read',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const id = objectId(req.params.id)
      if (!id) throw new HttpError(404, 'Notification not found.')
      const item = await Notification.findOneAndUpdate({ _id: id, userId }, { read: true }, { new: true })
      if (!item) throw new HttpError(404, 'Notification not found.')
      res.json(publicNotification(item))
    }),
  )

  return router
}
