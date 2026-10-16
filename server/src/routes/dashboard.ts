import { Router } from 'express'
import { Types } from 'mongoose'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Project } from '../models.ts'

type OpenRow = {
  _id: Types.ObjectId
  title: string
  dueDate: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  projectId: Types.ObjectId
  projectName: string
}

type DashboardRow = {
  _id: Types.ObjectId
  name: string
  description: string
  taskCount: number
  completedCount: number
  openTasks: OpenRow[]
}

export function dashboardRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const userId = new Types.ObjectId(currentUserId(req))
      const rows = await Project.aggregate<DashboardRow>([
        { $match: { userId, status: 'active' } },
        { $sort: { updatedAt: -1 } },
        {
          $lookup: {
            from: 'tasks',
            let: { projectId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ['$projectId', '$$projectId'] }, { $eq: ['$userId', userId] }],
                  },
                },
              },
              { $project: { title: 1, dueDate: 1, priority: 1, completed: 1, projectId: 1 } },
            ],
            as: 'tasks',
          },
        },
        {
          $project: {
            name: 1,
            description: 1,
            taskCount: { $size: '$tasks' },
            completedCount: {
              $size: { $filter: { input: '$tasks', as: 'task', cond: { $eq: ['$$task.completed', true] } } },
            },
            openTasks: {
              $map: {
                input: { $filter: { input: '$tasks', as: 'task', cond: { $eq: ['$$task.completed', false] } } },
                as: 'task',
                in: {
                  _id: '$$task._id',
                  title: '$$task.title',
                  dueDate: '$$task.dueDate',
                  priority: '$$task.priority',
                  projectId: '$_id',
                  projectName: '$name',
                },
              },
            },
          },
        },
      ])

      const openTasks = rows
        .flatMap((row) => row.openTasks)
        .sort((a, b) => {
          if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
          if (a.dueDate && !b.dueDate) return -1
          if (!a.dueDate && b.dueDate) return 1
          return a.title.localeCompare(b.title)
        })
        .map((task) => ({
          id: task._id.toString(),
          projectId: task.projectId.toString(),
          projectName: task.projectName,
          title: task.title,
          dueDate: task.dueDate,
          priority: task.priority,
          completed: false as const,
        }))

      res.json({
        projects: rows.map((project) => ({
          id: project._id.toString(),
          name: project.name,
          description: project.description,
          percentComplete: project.taskCount === 0 ? 0 : Math.round((project.completedCount / project.taskCount) * 100),
          completedCount: project.completedCount,
          taskCount: project.taskCount,
        })),
        openTasks,
      })
    }),
  )

  return router
}
