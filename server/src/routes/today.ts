import { Router } from 'express'
import { HttpError } from '../errors.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Project, Task } from '../models.ts'
import { publicTask } from '../serialize.ts'
import { normalizeDueDate } from '../validate.ts'

export function todayRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const date = typeof req.query.date === 'string' ? normalizeDueDate(req.query.date) : null
      if (!date) throw new HttpError(400, 'Use a valid date.')
      const userId = currentUserId(req)
      const [tasks, projects] = await Promise.all([
        Task.find({ userId }).sort({ order: 1, createdAt: 1 }),
        Project.find({ userId }).select('name status'),
      ])
      const names = new Map(projects.map((project) => [project.id, project.name]))
      const active = new Set(projects.filter((project) => project.status === 'active').map((project) => project.id))

      const visible = tasks.filter((task) => active.has(task.projectId.toString()))
      const withProject = (task: (typeof tasks)[number]) => ({
        ...publicTask(task),
        projectName: names.get(task.projectId.toString()) ?? '',
      })

      const planned = visible.filter((task) => task.plannedFor === date)
      const overdue = visible.filter(
        (task) => !task.completed && Boolean(task.dueDate) && (task.dueDate ?? '') < date && task.plannedFor !== date,
      )
      const overdueIds = new Set(overdue.map((task) => task.id))
      const carried = visible.filter(
        (task) =>
          !task.completed &&
          task.plannedFor != null &&
          task.plannedFor < date &&
          !overdueIds.has(task.id) &&
          !(task.dueDate && task.dueDate > date),
      )
      const taken = new Set([...planned, ...overdue, ...carried].map((task) => task.id))
      const available = visible.filter((task) => !task.completed && !taken.has(task.id))
      const finished = visible.filter((task) => task.completed && task.completedOn === date && task.plannedFor !== date)

      res.json({
        date,
        planned: planned.map(withProject),
        carried: carried.map(withProject),
        overdue: overdue.map(withProject),
        available: available.map(withProject),
        finished: finished.map(withProject),
      })
    }),
  )

  return router
}
