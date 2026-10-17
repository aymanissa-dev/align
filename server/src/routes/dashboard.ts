import { Router } from 'express'
import { Types } from 'mongoose'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Project, Task } from '../models.ts'

const OPEN_LIMIT = 40

type CountRow = {
  _id: { projectId: Types.ObjectId; completed: boolean }
  n: number
}

type OpenRow = {
  _id: Types.ObjectId
  title: string
  dueDate: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  projectId: Types.ObjectId
}

export function dashboardRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const userId = new Types.ObjectId(currentUserId(req))
      const [projects, counts, dated, undated] = await Promise.all([
        Project.find({ userId, status: 'active' }).select('name description').sort({ updatedAt: -1 }).lean(),
        Task.aggregate<CountRow>([
          { $match: { userId } },
          { $group: { _id: { projectId: '$projectId', completed: '$completed' }, n: { $sum: 1 } } },
        ]),
        Task.find({ userId, completed: false, dueDate: { $gte: '0000-01-01' } })
          .select('title dueDate priority projectId')
          .sort({ dueDate: 1, title: 1 })
          .limit(OPEN_LIMIT)
          .lean<OpenRow[]>(),
        Task.find({ userId, completed: false, dueDate: null })
          .select('title dueDate priority projectId')
          .sort({ title: 1 })
          .limit(OPEN_LIMIT)
          .lean<OpenRow[]>(),
      ])
      const names = new Map(projects.map((project) => [project._id.toString(), project.name]))

      const tally = new Map<string, { total: number; done: number }>()
      for (const row of counts) {
        const id = row._id.projectId.toString()
        const bucket = tally.get(id) ?? { total: 0, done: 0 }
        bucket.total += row.n
        if (row._id.completed) bucket.done += row.n
        tally.set(id, bucket)
      }
      let openTaskCount = 0
      for (const [id, bucket] of tally) {
        if (!names.has(id)) continue
        openTaskCount += bucket.total - bucket.done
      }

      const open = [...dated, ...undated].slice(0, OPEN_LIMIT).flatMap((task) => {
        const projectName = names.get(task.projectId.toString())
        if (!projectName) return []
        return [
          {
            id: task._id.toString(),
            projectId: task.projectId.toString(),
            projectName,
            title: task.title,
            dueDate: task.dueDate,
            priority: task.priority,
            completed: false as const,
          },
        ]
      })

      res.json({
        projects: projects.map((project) => {
          const bucket = tally.get(project._id.toString()) ?? { total: 0, done: 0 }
          return {
            id: project._id.toString(),
            name: project.name,
            description: project.description,
            percentComplete: bucket.total === 0 ? 0 : Math.round((bucket.done / bucket.total) * 100),
            completedCount: bucket.done,
            taskCount: bucket.total,
          }
        }),
        openTasks: open,
        openTaskCount,
      })
    }),
  )

  return router
}
