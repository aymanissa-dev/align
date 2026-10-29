import { Router } from 'express'
import { daysBetween } from '../dates.ts'
import { bind } from '../data/content.ts'
import { currentTenant } from '../data/tenant.ts'
import { HttpError } from '../errors.ts'
import { asyncHandler, requireAuth } from '../middleware.ts'
import { publicRecurrence, publicStatus, TASK_FIELDS } from '../serialize.ts'
import { normalizeDueDate } from '../validate.ts'

const MAX_SPAN = 62

export function calendarRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const from = typeof req.query.from === 'string' ? normalizeDueDate(req.query.from) : null
      const to = typeof req.query.to === 'string' ? normalizeDueDate(req.query.to) : null
      if (!from || !to || from > to) throw new HttpError(400, 'Use a valid date range.')
      if (daysBetween(from, to) > MAX_SPAN) throw new HttpError(400, 'Choose a shorter range.')
      const db = bind(currentTenant(req))
      const [tasks, projects] = await Promise.all([
        db.tasks
          .find({ dueDate: { $gte: from, $lte: to } })
          .select(TASK_FIELDS)
          .sort({ dueDate: 1, order: 1, createdAt: 1 })
          .lean(),
        db.projects.find().select('name').lean(),
      ])
      const names = new Map(projects.map((project) => [project._id.toString(), project.name]))
      res.json(
        tasks.flatMap((task) => {
          const projectName = names.get(task.projectId.toString())
          if (!projectName || !task.dueDate) return []
          return [
            {
              id: task._id.toString(),
              projectId: task.projectId.toString(),
              projectName,
              title: task.title,
              completed: task.completed,
              dueDate: task.dueDate,
              priority: task.priority,
              status: publicStatus(task.completed, task.status),
              recurrence: publicRecurrence(task.recurrence),
            },
          ]
        }),
      )
    }),
  )

  return router
}
