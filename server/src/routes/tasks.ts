import { Router } from 'express'
import { quoteTitle, recordActivity } from '../activity.ts'
import { assertVersion, expectedVersion, stampVersion } from '../concurrency.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Notification } from '../models.ts'
import { publicTask } from '../serialize.ts'
import { ownedLabelIds, requireTask, touchProject } from '../scope.ts'
import { normalizeDueDate, parseBody, taskPatchSchema } from '../validate.ts'

export function tasksRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const task = await requireTask(userId, req.params.id)
      assertVersion(task.__v, expectedVersion(req))
      const input = parseBody(taskPatchSchema, req.body)
      const wasCompleted = task.completed
      const planningOnly =
        input.plannedFor !== undefined &&
        input.title === undefined &&
        input.completed === undefined &&
        input.dueDate === undefined &&
        input.priority === undefined &&
        input.labelIds === undefined &&
        input.order === undefined &&
        input.completedOn === undefined
      if (input.title !== undefined) task.title = input.title
      if (input.completed !== undefined) {
        task.completed = input.completed
        if (input.completed) {
          task.completedOn =
            normalizeDueDate(input.completedOn) ?? task.completedOn ?? new Date().toISOString().slice(0, 10)
        } else {
          task.completedOn = null
        }
      }
      if (input.dueDate !== undefined) task.dueDate = normalizeDueDate(input.dueDate) ?? null
      if (input.priority !== undefined) task.priority = input.priority
      if (input.labelIds !== undefined) task.labelIds = await ownedLabelIds(userId, input.labelIds)
      if (input.plannedFor !== undefined) task.plannedFor = normalizeDueDate(input.plannedFor) ?? null
      if (input.order !== undefined) task.order = input.order
      await task.save()
      await touchProject(task.projectId, userId)
      const finished = !wasCompleted && task.completed
      if (!planningOnly) await recordActivity({
        userId,
        projectId: task.projectId,
        type: finished ? 'complete' : 'update',
        summary: finished ? `Completed task ${quoteTitle(task.title)}` : `Updated task ${quoteTitle(task.title)}`,
      })
      if (task.completed) await Notification.deleteMany({ userId, taskId: task._id, kind: 'overdue' })
      stampVersion(res, task.__v)
      res.json(publicTask(task))
    }),
  )

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const task = await requireTask(userId, req.params.id)
      const projectId = task.projectId
      const title = task.title
      await Notification.deleteMany({ userId, taskId: task._id })
      await task.deleteOne()
      await touchProject(projectId, userId)
      await recordActivity({
        userId,
        projectId,
        type: 'delete',
        summary: `Deleted task ${quoteTitle(title)}`,
      })
      res.status(204).send()
    }),
  )

  return router
}
