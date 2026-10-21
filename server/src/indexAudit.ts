import { Types, type Query } from 'mongoose'
import {
  Activity,
  Label,
  Membership,
  Note,
  Notification,
  Project,
  RateLimit,
  SecurityEvent,
  Session,
  Task,
} from './models.ts'

function usesCollectionScan(plan: unknown): boolean {
  return JSON.stringify(plan).includes('"stage":"COLLSCAN"')
}

async function check(name: string, query: Query<unknown, unknown>): Promise<string | null> {
  try {
    const explained = (await query.explain('executionStats')) as {
      executionStats?: { executionStages?: unknown }
      queryPlanner?: { winningPlan?: unknown }
    }
    const plan = explained.executionStats?.executionStages ?? explained.queryPlanner?.winningPlan
    if (usesCollectionScan(plan)) return `${name} is not an index scan`
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : 'index hint failed'
    return `${name}: ${message}`
  }
}

/** Hot queries must be able to use a named index. A failed hint or a COLLSCAN fails the audit. */
export async function auditHotQueries(): Promise<string[]> {
  const workspaceId = new Types.ObjectId()
  const userId = new Types.ObjectId()
  const projectId = new Types.ObjectId()
  const results = await Promise.all([
    check(
      'ProjectWorkspace',
      Project.find({ workspaceId, status: 'active', deletedAt: null }).sort({ updatedAt: -1 }).hint('ProjectWorkspace'),
    ),
    check(
      'ProjectPurge',
      Project.find({ purgeAt: { $type: 'date' } }).hint('ProjectPurge'),
    ),
    check(
      'TaskProjectOrder',
      Task.find({ workspaceId, projectId, deletedAt: null }).sort({ order: 1, createdAt: 1, _id: 1 }).hint('TaskProjectOrder'),
    ),
    check(
      'TaskDue',
      Task.find({ workspaceId, deletedAt: null, completed: false, dueDate: { $gte: '0000-01-01' } })
        .sort({ dueDate: 1 })
        .hint('TaskDue'),
    ),
    check(
      'TaskClientId',
      Task.find({ userId, clientId: 'client-1', deletedAt: null }).hint('TaskClientId'),
    ),
    check(
      'TaskPurge',
      Task.find({ purgeAt: { $type: 'date' } }).hint('TaskPurge'),
    ),
    check(
      'NoteWorkspace',
      Note.find({ workspaceId, projectId }).sort({ updatedAt: -1 }).hint('NoteWorkspace'),
    ),
    check('LabelWorkspace', Label.find({ workspaceId, name: 'Focus' }).hint('LabelWorkspace')),
    check(
      'ActivityProject',
      Activity.find({ projectId }).sort({ createdAt: -1, _id: -1 }).hint('ActivityProject'),
    ),
    check('ActivityExpire', Activity.find({ expireAt: { $lte: new Date() } }).hint('ActivityExpire')),
    check('SessionToken', Session.find({ tokenHash: 'abc' }).hint('SessionToken')),
    check('RateLimitWindow', RateLimit.find({ key: 'login:ip:203.0.113.0', windowStart: 0 }).hint('RateLimitWindow')),
    check('MembershipByUser', Membership.find({ userId, workspaceId }).hint('MembershipByUser')),
    check(
      'SecurityEventUser',
      SecurityEvent.find({ userId }).sort({ createdAt: -1 }).hint('SecurityEventUser'),
    ),
    check(
      'NotificationRead',
      Notification.find({ userId, read: false }).sort({ createdAt: -1 }).hint({ userId: 1, read: 1, createdAt: -1 }),
    ),
  ])
  return results.filter((failure): failure is string => failure !== null)
}
