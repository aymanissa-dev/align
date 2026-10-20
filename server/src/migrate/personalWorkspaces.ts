import type { ClientSession } from 'mongoose'
import { Label, Note, Project, Task, User, Whiteboard, Workspace, Membership, Activity } from '../models.ts'
import { personalWorkspaceName } from '../data/workspaces.ts'
import { withTransaction } from '../data/txn.ts'

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000

export const PERSONAL_WORKSPACES = '001_personal_workspaces'

export type MigrationCounts = Record<string, number>

async function stamp(
  model: {
    countDocuments: (filter: object) => Promise<number>
    updateMany: (filter: object, update: object, options?: { session: ClientSession }) => Promise<{ modifiedCount?: number }>
  },
  userId: unknown,
  workspaceId: unknown,
  session: ClientSession | null,
  dryRun: boolean,
): Promise<number> {
  const filter = { userId, $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }] }
  if (dryRun) return model.countDocuments(filter)
  const result = await model.updateMany(filter, { $set: { workspaceId } }, session ? { session } : undefined)
  return result.modifiedCount ?? 0
}

export async function upPersonalWorkspaces(dryRun: boolean): Promise<MigrationCounts> {
  const counts: MigrationCounts = { users: 0, projects: 0, tasks: 0, notes: 0, labels: 0, whiteboards: 0, activity: 0 }
  const users = await User.find({}).select('name personalWorkspaceId')
  const missing: typeof users = []
  for (const user of users) {
    const workspace = await Workspace.findOne({ ownerId: user._id, personal: true }).select('_id')
    if (!workspace) missing.push(user)
  }
  counts.users = missing.length
  if (dryRun) {
    const unscoped = { $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }] }
    counts.projects = await Project.countDocuments(unscoped)
    counts.tasks = await Task.countDocuments(unscoped)
    counts.notes = await Note.countDocuments(unscoped)
    counts.labels = await Label.countDocuments(unscoped)
    counts.whiteboards = await Whiteboard.countDocuments(unscoped)
    counts.activity = await Activity.countDocuments({ expireAt: { $exists: false } })
    return counts
  }

  await withTransaction(async (session) => {
    for (const user of missing) {
      const created = await Workspace.create(
        [{ name: personalWorkspaceName(user.name), personal: true, ownerId: user._id }],
        { session },
      )
      const workspace = created[0]
      if (!workspace) continue
      await Membership.updateOne(
        { workspaceId: workspace._id, userId: user._id },
        { $setOnInsert: { role: 'owner' } },
        { upsert: true, session },
      )
      await User.updateOne({ _id: user._id }, { personalWorkspaceId: workspace._id }, { session })
    }
  })

  const owned = await Workspace.find({ personal: true }).select('ownerId')
  for (const workspace of owned) {
    counts.projects += await stamp(Project, workspace.ownerId, workspace._id, null, false)
    counts.tasks += await stamp(Task, workspace.ownerId, workspace._id, null, false)
    counts.notes += await stamp(Note, workspace.ownerId, workspace._id, null, false)
    counts.labels += await stamp(Label, workspace.ownerId, workspace._id, null, false)
    counts.whiteboards += await stamp(Whiteboard, workspace.ownerId, workspace._id, null, false)
    const activity = await Activity.updateMany(
      { userId: workspace.ownerId, $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }] },
      { $set: { workspaceId: workspace._id } },
    )
    counts.activity += activity.modifiedCount ?? 0
  }
  const retention = await Activity.updateMany(
    { expireAt: { $exists: false } },
    { $set: { expireAt: new Date(Date.now() + RETENTION_MS) } },
  )
  counts.activity += retention.modifiedCount ?? 0
  const deleted = await Task.updateMany({ deletedAt: { $exists: false } }, { $set: { deletedAt: null } })
  counts.tasks += deleted.modifiedCount ?? 0
  return counts
}

export async function downPersonalWorkspaces(dryRun: boolean): Promise<MigrationCounts> {
  const workspaces = await Workspace.find({ personal: true }).select('_id')
  const ids = workspaces.map((workspace) => workspace._id)
  const counts: MigrationCounts = {
    workspaces: ids.length,
    projects: await Project.countDocuments({ workspaceId: { $in: ids } }),
    tasks: await Task.countDocuments({ workspaceId: { $in: ids } }),
    notes: await Note.countDocuments({ workspaceId: { $in: ids } }),
    labels: await Label.countDocuments({ workspaceId: { $in: ids } }),
    whiteboards: await Whiteboard.countDocuments({ workspaceId: { $in: ids } }),
  }
  if (dryRun) return counts
  await withTransaction(async (session) => {
    await Project.updateMany({ workspaceId: { $in: ids } }, { $unset: { workspaceId: '' } }, { session })
    await Task.updateMany({ workspaceId: { $in: ids } }, { $unset: { workspaceId: '' } }, { session })
    await Note.updateMany({ workspaceId: { $in: ids } }, { $unset: { workspaceId: '' } }, { session })
    await Label.updateMany({ workspaceId: { $in: ids } }, { $unset: { workspaceId: '' } }, { session })
    await Whiteboard.updateMany({ workspaceId: { $in: ids } }, { $unset: { workspaceId: '' } }, { session })
    await Activity.updateMany({ workspaceId: { $in: ids } }, { $unset: { workspaceId: '' } }, { session })
    await Membership.deleteMany({ workspaceId: { $in: ids } }, { session })
    await User.updateMany({ personalWorkspaceId: { $in: ids } }, { $set: { personalWorkspaceId: null } }, { session })
    await Workspace.deleteMany({ _id: { $in: ids } }, { session })
  })
  return counts
}
