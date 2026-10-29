import { Router } from 'express'
import { quoteTitle, recordActivity } from '../activity.ts'
import { assertVersion, expectedVersion, stampVersion } from '../concurrency.ts'
import { bind } from '../data/content.ts'
import { currentTenant } from '../data/tenant.ts'
import { asyncHandler, requireAuth, requireWriter } from '../middleware.ts'
import { spawnNextOccurrence } from '../recur.ts'
import { publicTask } from '../serialize.ts'
import { normalizeDueDate, parseBody, taskPatchSchema } from '../validate.ts'

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

export function tasksRouter(): Router {
  const router = Router()
  router.use(requireAuth, requireWriter)

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      const db = bind(tenant)
      const task = await db.requireTask(req.params.id)
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
        input.completedOn === undefined &&
        input.recurrence === undefined &&
        input.status === undefined &&
        input.subtasks === undefined
      if (input.title !== undefined) task.title = input.title
      if (input.dueDate !== undefined) task.dueDate = normalizeDueDate(input.dueDate) ?? null
      if (input.priority !== undefined) task.priority = input.priority
      if (input.labelIds !== undefined) task.labelIds = await db.ownedLabelIds(input.labelIds)
      if (input.plannedFor !== undefined) task.plannedFor = normalizeDueDate(input.plannedFor) ?? null
      if (input.order !== undefined) task.order = input.order
      if (input.recurrence !== undefined) task.recurrence = input.recurrence
      if (input.subtasks !== undefined) task.set('subtasks', input.subtasks)

      if (input.status !== undefined && input.completed === undefined) {
        task.status = input.status
        task.completed = input.status === 'done'
        if (task.completed) {
          task.completedOn = normalizeDueDate(input.completedOn) ?? task.completedOn ?? utcDay()
        } else {
          task.completedOn = null
        }
      } else if (input.completed !== undefined) {
        task.completed = input.completed
        if (input.completed) {
          task.completedOn = normalizeDueDate(input.completedOn) ?? task.completedOn ?? utcDay()
          task.status = input.status && input.status !== 'done' ? input.status : 'done'
        } else {
          task.completedOn = null
          task.status = input.status === 'doing' ? 'doing' : 'todo'
        }
      } else if (input.status !== undefined) {
        task.status = input.status
      }

      const justFinished = !wasCompleted && task.completed
      await task.save()
      const requestedFinish = input.completed === true || (input.status === 'done' && input.completed !== false)
      const today = task.completedOn && /^\d{4}-\d{2}-\d{2}$/.test(task.completedOn) ? task.completedOn : utcDay()
      let spawned: Awaited<ReturnType<typeof spawnNextOccurrence>> = null
      if (task.completed && task.recurrence && (justFinished || (requestedFinish && wasCompleted))) {
        spawned = await spawnNextOccurrence(db, task, today)
      }
      await db.touchProject(task.projectId)
      if (!planningOnly) {
        await recordActivity({
          userId: tenant.userId,
          workspaceId: tenant.workspaceId,
          projectId: task.projectId,
          type: justFinished ? 'complete' : 'update',
          summary: justFinished ? `Completed task ${quoteTitle(task.title)}` : `Updated task ${quoteTitle(task.title)}`,
        })
      }
      if (spawned) {
        await recordActivity({
          userId: tenant.userId,
          workspaceId: tenant.workspaceId,
          projectId: task.projectId,
          type: 'create',
          summary: `Created task ${quoteTitle(task.title)}`,
        })
      }
      if (task.completed) await db.notifications.deleteMany({ taskId: task._id, kind: 'overdue' })
      stampVersion(res, task.__v)
      const body = publicTask(task)
      res.json(spawned ? { ...body, spawned: publicTask(spawned) } : body)
    }),
  )

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      const db = bind(tenant)
      const task = await db.requireTask(req.params.id)
      const projectId = task.projectId
      const title = task.title
      await db.notifications.deleteMany({ taskId: task._id })
      await db.softDeleteTask(task)
      await db.touchProject(projectId)
      await recordActivity({
        userId: tenant.userId,
        workspaceId: tenant.workspaceId,
        projectId,
        type: 'delete',
        summary: `Deleted task ${quoteTitle(title)}`,
      })
      res.status(204).send()
    }),
  )

  return router
}
