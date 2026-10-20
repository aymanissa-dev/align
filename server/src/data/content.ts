import { Types, type FilterQuery } from 'mongoose'
import { HttpError } from '../errors.ts'
import {
  Activity,
  AuthToken,
  Label,
  Membership,
  Note,
  Notification,
  Passkey,
  Project,
  SecurityEvent,
  Session,
  Task,
  User,
  WebAuthnChallenge,
  Whiteboard,
  Workspace,
  type NoteDoc,
  type ProjectDoc,
  type TaskDoc,
} from '../models.ts'
import type { Tenant } from './tenant.ts'
import { withTransaction } from './txn.ts'

const TRASH_MS = 30 * 24 * 60 * 60 * 1000

export function objectId(id: string): Types.ObjectId | null {
  if (!/^[a-f\d]{24}$/i.test(id)) return null
  return new Types.ObjectId(id)
}

type Loose = FilterQuery<Record<string, unknown>>

export function bind(tenant: Tenant) {
  const workspaceId = new Types.ObjectId(tenant.workspaceId)
  const userId = new Types.ObjectId(tenant.userId)
  const alive = { deletedAt: null }

  function wid(filter: Loose = {}): Loose {
    return { workspaceId, ...filter }
  }

  return {
    workspaceId,
    userId,
    projects: {
      find(filter: Loose = {}) {
        return Project.find(wid({ ...alive, ...filter }))
      },
      create(doc: Record<string, unknown>) {
        return Project.create({ ...doc, userId, workspaceId, deletedAt: null, purgeAt: null })
      },
    },
    tasks: {
      find(filter: Loose = {}) {
        return Task.find(wid({ ...alive, ...filter }))
      },
      findOne(filter: Loose) {
        return Task.findOne(wid({ ...alive, ...filter }))
      },
      create(doc: Record<string, unknown>) {
        return Task.create({ ...doc, userId, workspaceId, deletedAt: null, deletedWithProject: false })
      },
      aggregate<T>(pipeline: Parameters<typeof Task.aggregate>[0]) {
        return Task.aggregate<T>([{ $match: { workspaceId, deletedAt: null } }, ...pipeline])
      },
      updateMany(filter: Loose, update: Record<string, unknown>) {
        return Task.updateMany(wid(filter), update)
      },
    },
    notes: {
      find(filter: Loose = {}) {
        return Note.find(wid(filter))
      },
      create(doc: Record<string, unknown>) {
        return Note.create({ ...doc, userId, workspaceId })
      },
    },
    labels: {
      find(filter: Loose = {}) {
        return Label.find(wid(filter))
      },
      findOne(filter: Loose) {
        return Label.findOne(wid(filter))
      },
      create(doc: Record<string, unknown>) {
        return Label.create({ ...doc, userId, workspaceId })
      },
    },
    activity: {
      find(filter: Loose = {}) {
        return Activity.find(wid(filter))
      },
      deleteMany(filter: Loose) {
        return Activity.deleteMany(wid(filter))
      },
    },
    notifications: {
      find(filter: Loose = {}) {
        return Notification.find({ userId, ...filter })
      },
      deleteMany(filter: Loose) {
        return Notification.deleteMany({ userId, ...filter })
      },
      updateMany(filter: Loose, update: Record<string, unknown>) {
        return Notification.updateMany({ userId, ...filter }, update)
      },
      findOneAndUpdate(filter: Loose, update: Record<string, unknown>, options: Record<string, unknown>) {
        return Notification.findOneAndUpdate({ userId, ...filter }, update, options)
      },
      bulkWrite(ops: Parameters<typeof Notification.bulkWrite>[0]) {
        return Notification.bulkWrite(ops)
      },
    },
    whiteboards: {
      findOne(filter: Loose) {
        return Whiteboard.findOne(wid(filter))
      },
      deleteMany(filter: Loose) {
        return Whiteboard.deleteMany(wid(filter))
      },
      save(projectId: Types.ObjectId, scene: unknown) {
        return Whiteboard.findOneAndUpdate(
          { workspaceId, projectId },
          { userId, workspaceId, projectId, scene },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        )
      },
    },
    async requireProject(id: string): Promise<ProjectDoc> {
      const projectId = objectId(id)
      if (!projectId) throw new HttpError(404, 'Project not found.')
      const project = await Project.findOne({ _id: projectId, workspaceId, deletedAt: null })
      if (!project) throw new HttpError(404, 'Project not found.')
      return project
    },
    async requireTask(id: string): Promise<TaskDoc> {
      const taskId = objectId(id)
      if (!taskId) throw new HttpError(404, 'Task not found.')
      const task = await Task.findOne({ _id: taskId, workspaceId, deletedAt: null })
      if (!task) throw new HttpError(404, 'Task not found.')
      return task
    },
    async requireNote(id: string): Promise<NoteDoc> {
      const noteId = objectId(id)
      if (!noteId) throw new HttpError(404, 'Note not found.')
      const note = await Note.findOne({ _id: noteId, workspaceId })
      if (!note) throw new HttpError(404, 'Note not found.')
      const project = await Project.findOne({ _id: note.projectId, workspaceId, deletedAt: null }).select('_id')
      if (!project) throw new HttpError(404, 'Note not found.')
      return note
    },
    async ownedLabelIds(ids: string[]): Promise<Types.ObjectId[]> {
      const unique = [...new Set(ids)]
      const objectIds = unique.map(objectId)
      if (objectIds.some((id) => !id)) throw new HttpError(400, 'Unknown label.')
      const found = await Label.find({ workspaceId, _id: { $in: objectIds } }).select('_id')
      if (found.length !== objectIds.length) throw new HttpError(400, 'Unknown label.')
      return objectIds.filter((id): id is Types.ObjectId => id !== null)
    },
    async touchProject(projectId: Types.ObjectId): Promise<void> {
      await Project.updateOne({ _id: projectId, workspaceId }, { $currentDate: { updatedAt: true } })
    },
    async activeProjectIds(): Promise<Types.ObjectId[]> {
      const rows = await Project.find({ workspaceId, deletedAt: null }).select('_id')
      return rows.map((row) => row._id)
    },
    async softDeleteProject(project: ProjectDoc): Promise<void> {
      const now = new Date()
      const purgeAt = new Date(now.getTime() + TRASH_MS)
      await withTransaction(async (session) => {
        const taskIds = await Task.find({ workspaceId, projectId: project._id, deletedAt: null })
          .session(session)
          .distinct('_id')
        await Notification.deleteMany({ userId, taskId: { $in: taskIds } }, { session })
        await Task.updateMany(
          { workspaceId, projectId: project._id, deletedAt: null },
          { $set: { deletedAt: now, purgeAt, deletedWithProject: true } },
          { session },
        )
        project.deletedAt = now
        project.purgeAt = purgeAt
        await project.save({ session })
      })
    },
    async softDeleteTask(task: TaskDoc): Promise<void> {
      const now = new Date()
      task.deletedAt = now
      task.purgeAt = new Date(now.getTime() + TRASH_MS)
      task.deletedWithProject = false
      await task.save()
    },
    async trash() {
      const [projects, tasks] = await Promise.all([
        Project.find({ workspaceId, deletedAt: { $ne: null } }).sort({ deletedAt: -1 }).lean(),
        Task.find({ workspaceId, deletedAt: { $ne: null } }).sort({ deletedAt: -1 }).lean(),
      ])
      return { projects, tasks }
    },
    async restoreProject(id: string): Promise<ProjectDoc> {
      const projectId = objectId(id)
      if (!projectId) throw new HttpError(404, 'Project not found.')
      const project = await Project.findOne({ _id: projectId, workspaceId, deletedAt: { $ne: null } })
      if (!project) throw new HttpError(404, 'Project not found.')
      await withTransaction(async (session) => {
        project.deletedAt = null
        project.purgeAt = null
        await project.save({ session })
        await Task.updateMany(
          { workspaceId, projectId: project._id, deletedWithProject: true },
          { $set: { deletedAt: null, purgeAt: null, deletedWithProject: false } },
          { session },
        )
      })
      return project
    },
    async restoreTask(id: string): Promise<TaskDoc> {
      const taskId = objectId(id)
      if (!taskId) throw new HttpError(404, 'Task not found.')
      const task = await Task.findOne({ _id: taskId, workspaceId, deletedAt: { $ne: null } })
      if (!task) throw new HttpError(404, 'Task not found.')
      const project = await Project.findOne({ _id: task.projectId, workspaceId, deletedAt: null }).select('_id')
      if (!project) throw new HttpError(409, 'Restore the project before restoring this task.')
      task.deletedAt = null
      task.purgeAt = null
      task.deletedWithProject = false
      await task.save()
      return task
    },
  }
}

export async function deleteAccount(userId: string): Promise<void> {
  await withTransaction(async (session) => {
    const id = new Types.ObjectId(userId)
    await Task.deleteMany({ userId: id }, { session })
    await Note.deleteMany({ userId: id }, { session })
    await Label.deleteMany({ userId: id }, { session })
    await Activity.deleteMany({ userId: id }, { session })
    await Notification.deleteMany({ userId: id }, { session })
    await Whiteboard.deleteMany({ userId: id }, { session })
    await Project.deleteMany({ userId: id }, { session })
    await Session.deleteMany({ userId: id }, { session })
    await AuthToken.deleteMany({ userId: id }, { session })
    await Passkey.deleteMany({ userId: id }, { session })
    await SecurityEvent.deleteMany({ userId: id }, { session })
    await WebAuthnChallenge.deleteMany({ userId: id }, { session })
    const owned = await Workspace.find({ ownerId: id, personal: true }).session(session).select('_id')
    const ids = owned.map((workspace) => workspace._id)
    await Membership.deleteMany({ $or: [{ userId: id }, { workspaceId: { $in: ids } }] }, { session })
    await Workspace.deleteMany({ _id: { $in: ids } }, { session })
    await User.deleteOne({ _id: id }, { session })
  })
}
