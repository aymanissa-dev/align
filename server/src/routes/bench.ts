import { Router } from 'express'
import type { Query } from 'mongoose'
import { HttpError } from '../errors.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { Activity, Note, Notification, Project, Task, User } from '../models.ts'

const BENCH_EMAIL = 'bench-depth@align.test'

type Scan = { stage?: string; indexName?: string; inputStage?: Scan; inputStages?: Scan[]; shards?: Record<string, { winningPlan?: Scan }> }

function scans(plan: Scan | undefined, found: Scan[] = []): Scan[] {
  if (!plan) return found
  if (plan.stage === 'IXSCAN' || plan.stage === 'COLLSCAN') found.push(plan)
  if (plan.inputStage) scans(plan.inputStage, found)
  if (plan.inputStages) plan.inputStages.forEach((stage) => scans(stage, found))
  if (plan.shards) Object.values(plan.shards).forEach((shard) => scans(shard.winningPlan, found))
  return found
}

async function summarize(name: string, query: Query<unknown[], unknown>, limit = 50) {
  const explained = await query.limit(limit).explain('executionStats')
  const plan = (explained as { queryPlanner?: { winningPlan?: Scan }; executionStats?: { totalKeysExamined?: number; totalDocsExamined?: number; nReturned?: number } })
  const found = scans(plan.queryPlanner?.winningPlan)
  const stats = plan.executionStats
  return {
    name,
    stages: found.map((scan) => scan.stage),
    indexes: found.map((scan) => scan.indexName).filter(Boolean),
    keysExamined: stats?.totalKeysExamined ?? null,
    docsExamined: stats?.totalDocsExamined ?? null,
    returned: stats?.nReturned ?? null,
  }
}

async function requireBench(userId: string) {
  const user = await User.findById(userId).select('email')
  if (!user || user.email !== BENCH_EMAIL) throw new HttpError(404, 'Not found.')
  return user
}

export function benchRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.post(
    '/seed',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      await requireBench(userId)
      const existing = await Task.countDocuments({ userId })
      if (existing >= 1000) {
        res.json(await counts(userId))
        return
      }
      await Promise.all([
        Project.deleteMany({ userId }),
        Task.deleteMany({ userId }),
        Note.deleteMany({ userId }),
        Activity.deleteMany({ userId }),
        Notification.deleteMany({ userId }),
      ])
      const now = Date.now()
      const projects = await Project.insertMany(
        Array.from({ length: 20 }, (_, index) => ({
          userId,
          name: index === 0 ? 'Launch checklist' : `Project ${String(index + 1).padStart(2, '0')}`,
          description: index % 5 === 0 ? 'Notes about the launch and beeswax samples.' : 'A realistic project used for query measurement.',
          status: index === 19 ? 'archived' : 'active',
          createdAt: new Date(now - index * 86_400_000),
          updatedAt: new Date(now - index * 3_600_000),
        })),
      )
      const active = projects.filter((project) => project.status === 'active')
      const tasks = await Task.insertMany(
        Array.from({ length: 1000 }, (_, index) => {
          const due = index < 250 ? '2026-10-14' : index < 300 ? '2026-10-17' : index < 400 ? '2026-10-16' : index < 500 ? '2026-11-02' : null
          return {
            userId,
            projectId: active[index % active.length]?._id,
            title: index % 17 === 0 ? `Cut the wick ${index}` : `Task ${String(index + 1).padStart(4, '0')}`,
            completed: index >= 700,
            dueDate: due,
            priority: (['low', 'medium', 'high', 'urgent'] as const)[index % 4],
            labelIds: [],
            plannedFor: index < 80 ? '2026-10-15' : index < 120 ? '2026-10-16' : null,
            completedOn: index >= 700 ? '2026-10-16' : null,
            order: index,
            createdAt: new Date(now - index * 60_000),
            updatedAt: new Date(now - index * 30_000),
          }
        }),
      )
      await Note.insertMany(
        Array.from({ length: 200 }, (_, index) => ({
          userId,
          projectId: active[index % active.length]?._id,
          title: index % 11 === 0 ? 'Materials' : `Note ${index + 1}`,
          body: index % 11 === 0 ? 'Use beeswax, not paraffin.' : `Body for note ${index + 1} about the launch.`,
          createdAt: new Date(now - index * 120_000),
          updatedAt: new Date(now - index * 60_000),
        })),
      )
      await Activity.insertMany(
        Array.from({ length: 500 }, (_, index) => ({
          userId,
          projectId: active[index % active.length]?._id,
          type: (['create', 'update', 'complete'] as const)[index % 3],
          summary: `Activity ${index + 1}`,
          createdAt: new Date(now - index * 20_000),
        })),
      )
      await Notification.insertMany(
        tasks.slice(0, 300).map((task, index) => {
          const dueDate = task.dueDate ?? '2026-10-14'
          const kind = dueDate < '2026-10-16' ? 'overdue' : 'due-soon'
          return {
            userId,
            projectId: task.projectId,
            taskId: task._id,
            kind,
            title: task.title,
            projectName: 'Launch checklist',
            dueDate,
            read: index % 4 === 0,
            key: `${task._id.toString()}:${kind}:${dueDate}`,
            expireAt: new Date(now + 90 * 86_400_000),
            createdAt: new Date(now - index * 10_000),
          }
        }),
      )
      res.status(201).json(await counts(userId))
    }),
  )

  router.get(
    '/explain',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      await requireBench(userId)
      const project = await Project.findOne({ userId, status: 'active' }).select('_id')
      if (!project) throw new HttpError(404, 'Not found.')
      const projectId = project._id
      const plans = await Promise.all([
        summarize('projects', Project.find({ userId, status: 'active' }).sort({ updatedAt: -1 })),
        summarize('tasks', Task.find({ userId, projectId }).sort({ order: 1, createdAt: 1, _id: 1 })),
        summarize(
          'tasks-due',
          Task.find({ userId, completed: false, dueDate: { $gte: '0000-01-01', $lte: '2026-10-17' } }),
          1000,
        ),
        summarize('tasks-open', Task.find({ userId, completed: false })),
        summarize('tasks-planned', Task.find({ userId, plannedFor: '2026-10-16' })),
        summarize('notes', Note.find({ userId }).sort({ updatedAt: -1 })),
        summarize('notes-project', Note.find({ userId, projectId }).sort({ updatedAt: -1 })),
        summarize('activity', Activity.find({ projectId }).sort({ createdAt: -1, _id: -1 })),
        summarize('notifications', Notification.find({ userId, key: { $in: ['000000000000000000000000:overdue:2026-10-14'] } })),
      ])
      let text: unknown = null
      try {
        text = await summarize('tasks-text', Task.find({ userId, $text: { $search: 'wick' } }))
      } catch (error) {
        text = { name: 'tasks-text', error: error instanceof Error ? error.message : 'text search failed' }
      }
      let taskIndexes: string[] = []
      let syncError: string | null = null
      try {
        taskIndexes = (await Task.collection.indexes()).map((index) => index.name ?? '')
      } catch (error) {
        syncError = error instanceof Error ? error.message : 'indexes failed'
      }
      if (!taskIndexes.includes('TaskTextIndex')) {
        try {
          await Task.syncIndexes()
          taskIndexes = (await Task.collection.indexes()).map((index) => index.name ?? '')
        } catch (error) {
          syncError = error instanceof Error ? error.message : 'sync failed'
        }
      }
      res.json({ plans: [...plans, text], taskIndexes, syncError })
    }),
  )

  return router
}

async function counts(userId: string) {
  const [projects, tasks, notes, activity, notifications] = await Promise.all([
    Project.countDocuments({ userId }),
    Task.countDocuments({ userId }),
    Note.countDocuments({ userId }),
    Activity.countDocuments({ userId }),
    Notification.countDocuments({ userId }),
  ])
  return { projects, tasks, notes, activity, notifications }
}
