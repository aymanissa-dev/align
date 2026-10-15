import mongoose, { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose'

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    accent: { type: String, default: '#171717' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

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

const taskSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true },
    completed: { type: Boolean, default: false, required: true },
    dueDate: { type: String, default: null },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium', required: true },
    labelIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Label' }], default: [] },
    order: { type: Number, required: true },
  },
  { timestamps: true },
)
taskSchema.index({ projectId: 1, completed: 1 })
taskSchema.index({ userId: 1, projectId: 1 })
taskSchema.index({ userId: 1, dueDate: 1 })
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
noteSchema.index({ projectId: 1 })
noteSchema.index({ userId: 1, updatedAt: -1 })
noteSchema.index(
  { title: 'text', body: 'text' },
  { weights: { title: 5, body: 1 }, name: 'NoteTextIndex' },
)

const activitySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    type: { type: String, enum: ['create', 'update', 'delete', 'complete'], required: true },
    summary: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
activitySchema.index({ projectId: 1, createdAt: -1 })
activitySchema.index({ userId: 1, projectId: 1 })

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
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
notificationSchema.index({ userId: 1, key: 1 }, { unique: true })
notificationSchema.index({ userId: 1, createdAt: -1 })

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>
export type ProjectDoc = HydratedDocument<InferSchemaType<typeof projectSchema>>
export type LabelDoc = HydratedDocument<InferSchemaType<typeof labelSchema>>
export type TaskDoc = HydratedDocument<InferSchemaType<typeof taskSchema>>
export type NoteDoc = HydratedDocument<InferSchemaType<typeof noteSchema>>
export type ActivityDoc = HydratedDocument<InferSchemaType<typeof activitySchema>>
export type NotificationDoc = HydratedDocument<InferSchemaType<typeof notificationSchema>>

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
