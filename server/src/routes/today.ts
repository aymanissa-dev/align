import { Router } from 'express'
import type { Types } from 'mongoose'
import { HttpError } from '../errors.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Project, Task } from '../models.ts'
import { normalizeDueDate } from '../validate.ts'

const FIELDS = 'projectId title completed dueDate priority labelIds plannedFor completedOn order createdAt updatedAt __v'

type TodayTask = {
  _id: Types.ObjectId
  projectId: Types.ObjectId
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
  __v?: number
}

function present(task: TodayTask, projectName: string) {
  return {
    id: task._id.toString(),
    projectId: task.projectId.toString(),
    projectName,
    title: task.title,
    completed: task.completed,
    dueDate: task.dueDate,
    priority: task.priority,
    labelIds: (task.labelIds ?? []).map((id) => id.toString()),
    plannedFor: task.plannedFor,
    completedOn: task.completedOn,
    order: task.order,
    version: typeof task.__v === 'number' ? task.__v : 0,
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
      const userId = currentUserId(req)
      const [open, plannedDone, finishedOn, projects] = await Promise.all([
        Task.find({ userId, completed: false }).select(FIELDS).lean<TodayTask[]>(),
        Task.find({ userId, completed: true, plannedFor: date }).select(FIELDS).lean<TodayTask[]>(),
        Task.find({ userId, completed: true, completedOn: date }).select(FIELDS).lean<TodayTask[]>(),
        Project.find({ userId, status: 'active' }).select('name').lean(),
      ])
      const names = new Map(projects.map((project) => [project._id.toString(), project.name]))
      const merged = new Map<string, TodayTask>()
      for (const task of [...open, ...plannedDone, ...finishedOn]) merged.set(task._id.toString(), task)
      const visible = [...merged.values()]
        .filter((task) => names.has(task.projectId.toString()))
        .sort((a, b) => a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime())

      const show = (task: TodayTask) => present(task, names.get(task.projectId.toString()) ?? '')
      const plannedForDate = visible.filter((task) => task.plannedFor === date)
      const dueToday = visible.filter((task) => !task.completed && task.dueDate === date && task.plannedFor !== date)
      const planned = [...plannedForDate, ...dueToday]
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
          task.dueDate !== date &&
          !(task.dueDate && task.dueDate > date),
      )
      const taken = new Set([...planned, ...overdue, ...carried].map((task) => task._id.toString()))
      const available = visible.filter((task) => !task.completed && !taken.has(task._id.toString()))
      const finished = visible.filter((task) => task.completed && task.completedOn === date && task.plannedFor !== date)

      res.json({
        date,
        planned: planned.map(show),
        carried: carried.map(show),
        overdue: overdue.map(show),
        available: available.map(show),
        finished: finished.map(show),
      })
    }),
  )

  return router
}
