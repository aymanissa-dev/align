import { Router } from 'express'
import { Types } from 'mongoose'
import { bind } from '../data/content.ts'
import { currentTenant, type Tenant } from '../data/tenant.ts'
import { ownerClaims } from '../data/workspaces.ts'
import { asyncHandler, requireAuth } from '../middleware.ts'

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

export async function dashboardPayload(tenant: Tenant) {
  const db = bind(tenant)
  const datedLimit = OPEN_LIMIT * 2
  const [projects, counts, dated, undated, datedIds] = await Promise.all([
    db.projects.find({ status: 'active' }).select('name description').sort({ updatedAt: -1 }).lean(),
    db.tasks.aggregate<CountRow>([
      { $group: { _id: { projectId: '$projectId', completed: '$completed' }, n: { $sum: 1 } } },
    ]),
    db.tasks
      .find({ completed: false, dueDate: { $gte: '0000-01-01' } })
      .select('title dueDate priority projectId')
      .sort({ dueDate: 1, title: 1 })
      .limit(datedLimit)
      .lean<OpenRow[]>(),
    db.tasks
      .find({ completed: false, dueDate: null })
      .select('title dueDate priority projectId')
      .sort({ title: 1 })
      .limit(OPEN_LIMIT)
      .lean<OpenRow[]>(),
    db.tasks.find({ completed: false, dueDate: { $gte: '0000-01-01' } }).select('projectId').lean(),
  ])
  const activeIds = projects.map((project) => project._id)
  const active = new Set(activeIds.map((id) => id.toString()))
  const datedRows =
    dated.length < datedLimit
      ? dated.filter((task) => active.has(task.projectId.toString()))
      : await db.tasks
          .find({ completed: false, projectId: { $in: activeIds }, dueDate: { $gte: '0000-01-01' } })
          .select('title dueDate priority projectId')
          .sort({ dueDate: 1, title: 1 })
          .limit(datedLimit)
          .lean<OpenRow[]>()
  const undatedRows =
    undated.length < OPEN_LIMIT
      ? undated.filter((task) => active.has(task.projectId.toString()))
      : await db.tasks
          .find({ completed: false, projectId: { $in: activeIds }, dueDate: null })
          .select('title dueDate priority projectId')
          .sort({ title: 1 })
          .limit(OPEN_LIMIT)
          .lean<OpenRow[]>()
  const datedOpenCount = datedIds.filter((task) => active.has(task.projectId.toString())).length
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

      const open = [...datedRows, ...undatedRows].flatMap((task) => {
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

  return {
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
    datedOpenCount,
  }
}

export function dashboardForUser(user: {
  id?: string
  personalWorkspaceId?: { toString(): string } | null
  membershipVersion?: number | null
}) {
  const claims = ownerClaims(user)
  if (!claims || !user.id) return Promise.resolve(null)
  return dashboardPayload({ userId: user.id, workspaceId: claims.workspaceId, role: claims.role })
}

export function dashboardRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await dashboardPayload(currentTenant(req)))
    }),
  )

  return router
}
