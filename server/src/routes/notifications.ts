import { Router } from 'express'
import { Types } from 'mongoose'
import { bind } from '../data/content.ts'
import { currentTenant, type Tenant } from '../data/tenant.ts'
import { shiftISODate } from '../dates.ts'
import { HttpError } from '../errors.ts'
import { asyncHandler, requireAuth, requireWriter } from '../middleware.ts'
import { decodeCursor, encodeCursor, pageLimit } from '../page.ts'
import { objectId } from '../data/content.ts'
import { publicNotification } from '../serialize.ts'
import { normalizeDueDate } from '../validate.ts'

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
const KEY = /^([a-f\d]{24}):(overdue|due-soon):(\d{4}-\d{2}-\d{2})$/i

type DueRow = {
  key: string
  taskId: Types.ObjectId
  projectId: Types.ObjectId
  kind: 'overdue' | 'due-soon'
  title: string
  projectName: string
  dueDate: string
  read: boolean
  createdAt: string
}

function requireToday(value: unknown): string {
  const today = typeof value === 'string' ? normalizeDueDate(value) : null
  if (!today) throw new HttpError(400, 'Use a valid date.')
  return today
}

async function dueRows(tenant: Tenant, today: string): Promise<DueRow[]> {
  const db = bind(tenant)
  const tomorrow = shiftISODate(today, 1)
  const tasks = await db.tasks
    .find({
      completed: false,
      dueDate: { $gte: '0000-01-01', $lte: tomorrow },
    })
    .select('title dueDate projectId')
    .lean()

  const projectIds = [...new Set(tasks.map((task) => task.projectId.toString()))]
  const keys = tasks.flatMap((task) => {
    if (!task.dueDate || task.dueDate === today) return []
    const kind: 'overdue' | 'due-soon' = task.dueDate < today ? 'overdue' : 'due-soon'
    return [`${task._id.toString()}:${kind}:${task.dueDate}`]
  })
  const [projects, stored] = await Promise.all([
    projectIds.length === 0
      ? Promise.resolve([])
      : db.projects.find({ _id: { $in: projectIds } }).select('name').lean(),
    keys.length === 0
      ? Promise.resolve([])
      : db.notifications.find({ key: { $in: keys } }).select('key read createdAt').lean(),
  ])
  const names = new Map(projects.map((project) => [project._id.toString(), project.name]))
  const flags = new Map(stored.map((item) => [item.key, item]))

  return tasks.flatMap((task) => {
    if (!task.dueDate || task.dueDate === today || task.dueDate > tomorrow) return []
    const projectName = names.get(task.projectId.toString())
    if (!projectName) return []
    const kind: 'overdue' | 'due-soon' = task.dueDate < today ? 'overdue' : 'due-soon'
    const key = `${task._id.toString()}:${kind}:${task.dueDate}`
    const saved = flags.get(key)
    return [
      {
        key,
        taskId: task._id,
        projectId: task.projectId,
        kind,
        title: task.title,
        projectName,
        dueDate: task.dueDate,
        read: saved?.read ?? false,
        createdAt: saved?.createdAt.toISOString() ?? `${task.dueDate}T00:00:00.000Z`,
      },
    ]
  })
}

function present(row: DueRow) {
  return {
    id: row.key,
    projectId: row.projectId.toString(),
    taskId: row.taskId.toString(),
    kind: row.kind,
    title: row.title,
    projectName: row.projectName,
    dueDate: row.dueDate,
    read: row.read,
    createdAt: row.createdAt,
  }
}

export function notificationsRouter(): Router {
  const router = Router()
  router.use(requireAuth, requireWriter)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const today = requireToday(req.query.today)
      const tenant = currentTenant(req)
      const [rows, devices] = await Promise.all([
        dueRows(tenant, today),
        bind(tenant).notifications.find({ kind: { $in: ['new-device', 'passkey-added'] } }).sort({ createdAt: -1 }).limit(20).lean(),
      ])
      const listed = [
        ...rows.map(present),
        ...devices.map((item) => ({
          id: item._id.toString(),
          projectId: '',
          taskId: '',
          kind: item.kind === 'passkey-added' ? ('passkey-added' as const) : ('new-device' as const),
          title: item.title,
          projectName: item.projectName ?? '',
          dueDate: '',
          read: item.read,
          createdAt: item.createdAt.toISOString(),
        })),
      ]
      listed.sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
      const cursor = decodeCursor(req.query.cursor)
      const filtered =
        cursor && cursor.length === 2
          ? listed.filter((row) => row.createdAt < cursor[0] || (row.createdAt === cursor[0] && row.id < cursor[1]))
          : listed
      const limit = pageLimit(req.query.limit)
      const page = filtered.slice(0, limit)
      const last = page[limit - 1]
      if (filtered.length > limit && last) res.set('X-Next-Cursor', encodeCursor([last.createdAt, last.id]))
      res.json(page)
    }),
  )

  router.post(
    '/read-all',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      const db = bind(tenant)
      const userId = tenant.userId
      const today = typeof req.query.today === 'string' && req.query.today ? requireToday(req.query.today) : null
      if (today) {
        const rows = await dueRows(tenant, today)
        const userObjectId = new Types.ObjectId(userId)
        const expireAt = new Date(Date.now() + NINETY_DAYS_MS)
        if (rows.length > 0) {
          await db.notifications.bulkWrite(
            rows.map((row) => ({
              updateOne: {
                filter: { userId: userObjectId, key: row.key },
                update: {
                  $set: { read: true, title: row.title, projectName: row.projectName },
                  $setOnInsert: {
                    userId: userObjectId,
                    projectId: row.projectId,
                    taskId: row.taskId,
                    kind: row.kind,
                    dueDate: row.dueDate,
                    key: row.key,
                    expireAt,
                  },
                },
                upsert: true,
              },
            })),
          )
        }
      }
      await db.notifications.updateMany({ read: false }, { read: true })
      res.status(204).send()
    }),
  )

  router.post(
    '/:id/read',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      const db = bind(tenant)
      const userId = tenant.userId
      const id = objectId(req.params.id)
      if (id) {
        const item = await db.notifications.findOneAndUpdate({ _id: id }, { read: true }, { new: true })
        if (!item) throw new HttpError(404, 'Notification not found.')
        res.json(publicNotification(item))
        return
      }

      const match = KEY.exec(req.params.id)
      if (!match) throw new HttpError(404, 'Notification not found.')
      const taskId = match[1] ?? ''
      const kind = match[2] as 'overdue' | 'due-soon'
      const dueDate = match[3] ?? ''
      const task = await db.tasks.findOne({ _id: taskId, completed: false, dueDate }).select('title projectId dueDate')
      if (!task?.dueDate) throw new HttpError(404, 'Notification not found.')
      const project = await db.projects.find({ _id: task.projectId }).select('name')
      const named = project[0]
      if (!named) throw new HttpError(404, 'Notification not found.')
      const item = await db.notifications.findOneAndUpdate(
        { userId, key: req.params.id },
        {
          $set: { read: true, title: task.title, projectName: named.name },
          $setOnInsert: {
            userId,
            projectId: task.projectId,
            taskId: task._id,
            kind,
            dueDate,
            key: req.params.id,
            expireAt: new Date(Date.now() + NINETY_DAYS_MS),
          },
        },
        { new: true, upsert: true },
      )
      if (!item) throw new HttpError(404, 'Notification not found.')
      res.json({ ...publicNotification(item), id: req.params.id })
    }),
  )

  return router
}
