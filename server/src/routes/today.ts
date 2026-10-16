import { Router } from 'express'
import { Types } from 'mongoose'
import { HttpError } from '../errors.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Task } from '../models.ts'
import { normalizeDueDate } from '../validate.ts'

type TodayRow = {
  _id: Types.ObjectId
  projectId: Types.ObjectId
  projectName: string
  title: string
  completed: boolean
  dueDate: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  labelIds: Types.ObjectId[]
  plannedFor: string | null
  completedOn: string | null
  order: number
  createdAt: Date
  updatedAt: Date
}

function present(task: TodayRow) {
  return {
    id: task._id.toString(),
    projectId: task.projectId.toString(),
    projectName: task.projectName,
    title: task.title,
    completed: task.completed,
    dueDate: task.dueDate,
    priority: task.priority,
    labelIds: (task.labelIds ?? []).map((id) => id.toString()),
    plannedFor: task.plannedFor,
    completedOn: task.completedOn,
    order: task.order,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

export function todayRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const date = typeof req.query.date === 'string' ? normalizeDueDate(req.query.date) : null
      if (!date) throw new HttpError(400, 'Use a valid date.')
      const userId = new Types.ObjectId(currentUserId(req))
      const visible = await Task.aggregate<TodayRow>([
        { $match: { userId } },
        { $sort: { order: 1, createdAt: 1 } },
        {
          $lookup: {
            from: 'projects',
            let: { projectId: '$projectId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ['$_id', '$$projectId'] }, { $eq: ['$userId', userId] }, { $eq: ['$status', 'active'] }],
                  },
                },
              },
              { $project: { name: 1 } },
            ],
            as: 'project',
          },
        },
        { $unwind: '$project' },
        {
          $project: {
            projectId: 1,
            projectName: '$project.name',
            title: 1,
            completed: 1,
            dueDate: 1,
            priority: 1,
            labelIds: 1,
            plannedFor: 1,
            completedOn: 1,
            order: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      ])

      const planned = visible.filter((task) => task.plannedFor === date)
      const overdue = visible.filter(
        (task) => !task.completed && Boolean(task.dueDate) && (task.dueDate ?? '') < date && task.plannedFor !== date,
      )
      const overdueIds = new Set(overdue.map((task) => task._id.toString()))
      const carried = visible.filter(
        (task) =>
          !task.completed &&
          task.plannedFor != null &&
          task.plannedFor < date &&
          !overdueIds.has(task._id.toString()) &&
          !(task.dueDate && task.dueDate > date),
      )
      const taken = new Set([...planned, ...overdue, ...carried].map((task) => task._id.toString()))
      const available = visible.filter((task) => !task.completed && !taken.has(task._id.toString()))
      const finished = visible.filter((task) => task.completed && task.completedOn === date && task.plannedFor !== date)

      res.json({
        date,
        planned: planned.map(present),
        carried: carried.map(present),
        overdue: overdue.map(present),
        available: available.map(present),
        finished: finished.map(present),
      })
    }),
  )

  return router
}
