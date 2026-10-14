import { Router } from 'express'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Project, Task } from '../models.ts'

export function dashboardRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      const projects = await Project.find({ userId, status: 'active' }).sort({ updatedAt: -1 })
      const projectIds = projects.map((project) => project._id)
      const tasks = await Task.find({ userId, projectId: { $in: projectIds } })
      const tasksByProject = new Map<string, typeof tasks>()
      for (const task of tasks) {
        const key = task.projectId.toString()
        const list = tasksByProject.get(key)
        if (list) list.push(task)
        else tasksByProject.set(key, [task])
      }

      const names = new Map(projects.map((project) => [project.id, project.name]))
      const openTasks = tasks
        .filter((task) => !task.completed)
        .map((task) => ({
          id: task.id,
          projectId: task.projectId.toString(),
          projectName: names.get(task.projectId.toString()) ?? '',
          title: task.title,
          dueDate: task.dueDate,
          completed: false,
        }))
        .sort((a, b) => {
          if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
          if (a.dueDate && !b.dueDate) return -1
          if (!a.dueDate && b.dueDate) return 1
          return a.title.localeCompare(b.title)
        })

      res.json({
        projects: projects.map((project) => {
          const projectTasks = tasksByProject.get(project.id) ?? []
          const completedCount = projectTasks.filter((task) => task.completed).length
          const taskCount = projectTasks.length
          return {
            id: project.id,
            name: project.name,
            description: project.description,
            percentComplete: taskCount === 0 ? 0 : Math.round((completedCount / taskCount) * 100),
            completedCount,
            taskCount,
          }
        }),
        openTasks,
      })
    }),
  )

  return router
}
