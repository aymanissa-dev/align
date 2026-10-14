import { Router } from 'express'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { publicTask } from '../serialize.ts'
import { requireTask, touchProject } from '../scope.ts'
import { normalizeDueDate, parseBody, taskPatchSchema } from '../validate.ts'

export function tasksRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const task = await requireTask(userId, req.params.id)
      const input = parseBody(taskPatchSchema, req.body)
      if (input.title !== undefined) task.title = input.title
      if (input.completed !== undefined) task.completed = input.completed
      if (input.dueDate !== undefined) task.dueDate = normalizeDueDate(input.dueDate) ?? null
      if (input.order !== undefined) task.order = input.order
      await task.save()
      await touchProject(task.projectId, userId)
      res.json(publicTask(task))
    }),
  )

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const task = await requireTask(userId, req.params.id)
      await task.deleteOne()
      await touchProject(task.projectId, userId)
      res.status(204).send()
    }),
  )

  return router
}
