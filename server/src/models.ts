import mongoose, { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose'

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
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

const taskSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true },
    completed: { type: Boolean, default: false, required: true },
    dueDate: { type: String, default: null },
    order: { type: Number, required: true },
  },
  { timestamps: true },
)
taskSchema.index({ projectId: 1, completed: 1 })
taskSchema.index({ userId: 1, projectId: 1 })
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

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>
export type ProjectDoc = HydratedDocument<InferSchemaType<typeof projectSchema>>
export type TaskDoc = HydratedDocument<InferSchemaType<typeof taskSchema>>
export type NoteDoc = HydratedDocument<InferSchemaType<typeof noteSchema>>

function compile<T>(name: string, factory: () => T): T {
  const existing = mongoose.models[name]
  if (existing) return existing as T
  return factory()
}

export const User = compile('User', () => model('User', userSchema))
export const Project = compile('Project', () => model('Project', projectSchema))
export const Task = compile('Task', () => model('Task', taskSchema))
export const Note = compile('Note', () => model('Note', noteSchema))
