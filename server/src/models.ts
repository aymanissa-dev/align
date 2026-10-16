import mongoose, { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose'
import { slowQueries } from './slow.ts'

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    accent: { type: String, default: '#171717' },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    emailVerifiedAt: { type: Date, default: null },
    failedLogins: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    googleId: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
userSchema.index({ googleId: 1 }, { unique: true, sparse: true })

const projectSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['active', 'archived'], default: 'active', required: true },
  },
  { timestamps: true },
)
projectSchema.index({ userId: 1, status: 1 })
projectSchema.index({ userId: 1, name: 1 })
projectSchema.index(
  { name: 'text', description: 'text' },
  { weights: { name: 5, description: 1 }, name: 'ProjectTextIndex' },
)

const labelSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    color: { type: String, required: true },
  },
  { timestamps: true },
)
labelSchema.index({ userId: 1, name: 1 }, { unique: true })
labelSchema.index({ userId: 1 })

const taskSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true },
    completed: { type: Boolean, default: false, required: true },
    dueDate: { type: String, default: null },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium', required: true },
    labelIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Label' }], default: [] },
    plannedFor: { type: String, default: null },
    completedOn: { type: String, default: null },
    order: { type: Number, required: true },
    // Client-generated id so a retried or replayed create returns the same task.
    clientId: { type: String },
  },
  { timestamps: true },
)
taskSchema.index(
  { userId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } },
)
taskSchema.index({ projectId: 1, completed: 1 })
taskSchema.index({ userId: 1, projectId: 1 })
taskSchema.index({ userId: 1, projectId: 1, completed: 1, dueDate: 1 })
taskSchema.index({ userId: 1, plannedFor: 1 })
taskSchema.index({ userId: 1, completedOn: 1 })
taskSchema.index({ userId: 1, projectId: 1, order: 1, createdAt: 1, _id: 1 })
taskSchema.index({ userId: 1, dueDate: 1 })
taskSchema.index({ userId: 1, title: 1 })
taskSchema.index({ title: 'text' }, { name: 'TaskTextIndex' })

const noteSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
  },
  { timestamps: true },
)
noteSchema.index({ userId: 1, projectId: 1, updatedAt: -1 })
noteSchema.index({ userId: 1, updatedAt: -1 })
noteSchema.index({ userId: 1, title: 1 })
noteSchema.index(
  { title: 'text', body: 'text' },
  { weights: { title: 5, body: 1 }, name: 'NoteTextIndex' },
)

const activitySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    type: { type: String, enum: ['create', 'update', 'delete', 'complete'], required: true },
    summary: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
activitySchema.index({ projectId: 1, createdAt: -1, _id: -1 })
activitySchema.index({ userId: 1, projectId: 1 })
activitySchema.index({ userId: 1, createdAt: -1 })

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    kind: { type: String, enum: ['due-soon', 'overdue'], required: true },
    title: { type: String, required: true },
    projectName: { type: String, required: true },
    dueDate: { type: String, required: true },
    read: { type: Boolean, default: false, required: true },
    key: { type: String, required: true },
    expireAt: { type: Date, default: () => new Date(Date.now() + NINETY_DAYS_MS) },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
notificationSchema.index({ userId: 1, key: 1 }, { unique: true })
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 })
notificationSchema.index({ userId: 1, createdAt: -1 })
notificationSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

const whiteboardSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    scene: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
)
whiteboardSchema.index({ userId: 1, projectId: 1 }, { unique: true })

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    familyId: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: Schema.Types.ObjectId, default: null },
    rotatedAt: { type: Date, default: null },
    userAgent: { type: String, default: '' },
    lastSeenAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
sessionSchema.index({ tokenHash: 1 }, { unique: true })
sessionSchema.index({ userId: 1, revokedAt: 1, lastSeenAt: -1 })
sessionSchema.index({ familyId: 1 })
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const tokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['verify', 'reset'], required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
tokenSchema.index({ tokenHash: 1 }, { unique: true })
tokenSchema.index({ userId: 1, type: 1 })
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const rateLimitSchema = new Schema(
  {
    key: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false },
)
rateLimitSchema.index({ key: 1 }, { unique: true })
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>
export type ProjectDoc = HydratedDocument<InferSchemaType<typeof projectSchema>>
export type LabelDoc = HydratedDocument<InferSchemaType<typeof labelSchema>>
export type TaskDoc = HydratedDocument<InferSchemaType<typeof taskSchema>>
export type NoteDoc = HydratedDocument<InferSchemaType<typeof noteSchema>>
export type ActivityDoc = HydratedDocument<InferSchemaType<typeof activitySchema>>
export type NotificationDoc = HydratedDocument<InferSchemaType<typeof notificationSchema>>
export type WhiteboardDoc = HydratedDocument<InferSchemaType<typeof whiteboardSchema>>
export type SessionDoc = HydratedDocument<InferSchemaType<typeof sessionSchema>>
export type TokenDoc = HydratedDocument<InferSchemaType<typeof tokenSchema>>

slowQueries(userSchema, 'User')
slowQueries(projectSchema, 'Project')
slowQueries(labelSchema, 'Label')
slowQueries(taskSchema, 'Task')
slowQueries(noteSchema, 'Note')
slowQueries(activitySchema, 'Activity')
slowQueries(notificationSchema, 'Notification')
slowQueries(whiteboardSchema, 'Whiteboard')
slowQueries(sessionSchema, 'Session')
slowQueries(tokenSchema, 'Token')
slowQueries(rateLimitSchema, 'RateLimit')

function compile<T>(name: string, factory: () => T): T {
  const existing = mongoose.models[name]
  if (existing) return existing as T
  return factory()
}

export const User = compile('User', () => model('User', userSchema))
export const Project = compile('Project', () => model('Project', projectSchema))
export const Label = compile('Label', () => model('Label', labelSchema))
export const Task = compile('Task', () => model('Task', taskSchema))
export const Note = compile('Note', () => model('Note', noteSchema))
export const Activity = compile('Activity', () => model('Activity', activitySchema))
export const Notification = compile('Notification', () => model('Notification', notificationSchema))
export const Whiteboard = compile('Whiteboard', () => model('Whiteboard', whiteboardSchema))
export const Session = compile('Session', () => model('Session', sessionSchema))
export const AuthToken = compile('AuthToken', () => model('AuthToken', tokenSchema))
export const RateLimit = compile('RateLimit', () => model('RateLimit', rateLimitSchema))
