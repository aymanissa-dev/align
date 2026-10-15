import { Router } from 'express'
import { HttpError } from '../errors.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Notification, Project, Task } from '../models.ts'
import { objectId } from '../scope.ts'
import { publicNotification } from '../serialize.ts'
import { shiftISODate } from '../dates.ts'
import { normalizeDueDate } from '../validate.ts'

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
      const projects = await Project.find({ userId }).select('name')
      const names = new Map(projects.map((project) => [project.id, project.name]))

      await Promise.all(
        tasks.map(async (task) => {
          if (!task.dueDate) return
          const kind = task.dueDate < today ? 'overdue' : task.dueDate <= tomorrow ? 'due-soon' : null
          if (!kind) return
          const key = `${task.id}:${kind}:${task.dueDate}`
          await Notification.updateOne(
            { userId, key },
            {
              $setOnInsert: {
                userId,
                projectId: task.projectId,
                taskId: task._id,
                kind,
                dueDate: task.dueDate,
                read: false,
                key,
              },
              $set: {
                title: task.title,
                projectName: names.get(task.projectId.toString()) ?? 'Project',
              },
            },
            { upsert: true },
          )
        }),
      )

      const items = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(50)
      res.json(items.map(publicNotification))
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
