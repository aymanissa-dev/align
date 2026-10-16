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

      res.json({
        date,
        planned: visible.filter((task) => task.plannedFor === date).map(withProject),
        carried: visible
          .filter((task) => task.plannedFor != null && task.plannedFor < date && !task.completed)
          .map(withProject),
        available: visible
          .filter((task) => !task.completed && task.plannedFor !== date && !(task.plannedFor && task.plannedFor < date))
          .map(withProject),
        finished: visible
          .filter((task) => task.completed && task.completedOn === date && task.plannedFor !== date)
          .map(withProject),
      })
    }),
  )

  return router
}
