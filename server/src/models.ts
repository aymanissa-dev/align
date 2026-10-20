import mongoose, { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose'
import { wordList } from '../../shared/search.ts'
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
    personalWorkspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
    membershipVersion: { type: Number, default: 0 },
    totpSecret: { type: String, select: false, default: null },
    totpEnabledAt: { type: Date, default: null },
    recoveryCodes: {
      type: [{ hash: { type: String, required: true }, usedAt: { type: Date, default: null } }],
      default: [],
      select: false,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
userSchema.index({ googleId: 1 }, { unique: true, sparse: true })

const projectSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['active', 'archived'], default: 'active', required: true },
    deletedAt: { type: Date, default: null },
    purgeAt: { type: Date, default: null },
    searchWords: { type: [String] },
  },
  { timestamps: true, optimisticConcurrency: true },
)
projectSchema.pre('save', function () {
  this.searchWords = wordList(this.name, this.description)
})
projectSchema.index({ userId: 1, status: 1, updatedAt: -1 })
projectSchema.index({ workspaceId: 1, status: 1, deletedAt: 1, updatedAt: -1 }, { name: 'ProjectWorkspace' })
projectSchema.index(
  { purgeAt: 1 },
  { name: 'ProjectPurge', expireAfterSeconds: 0, partialFilterExpression: { purgeAt: { $type: 'date' } } },
)
projectSchema.index({ userId: 1, searchWords: 1 }, { name: 'ProjectSearchWords' })
projectSchema.index(
  { userId: 1, name: 'text', description: 'text' },
  { weights: { name: 5, description: 1 }, name: 'ProjectTextIndex' },
)

const labelSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
    name: { type: String, required: true },
    color: { type: String, required: true },
  },
  { timestamps: true, optimisticConcurrency: true },
)
labelSchema.index({ userId: 1, name: 1 }, { unique: true })
labelSchema.index({ workspaceId: 1, name: 1 }, { name: 'LabelWorkspace' })

const taskSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true },
    deletedAt: { type: Date, default: null },
    purgeAt: { type: Date, default: null },
    deletedWithProject: { type: Boolean, default: false },
    completed: { type: Boolean, default: false, required: true },
    dueDate: { type: String, default: null },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium', required: true },
    labelIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Label' }], default: [] },
    plannedFor: { type: String, default: null },
    completedOn: { type: String, default: null },
    order: { type: Number, required: true },
    // Client-generated id so a retried or replayed create returns the same task.
    clientId: { type: String },
    searchWords: { type: [String] },
  },
  { timestamps: true, optimisticConcurrency: true },
)
taskSchema.pre('save', function () {
  this.searchWords = wordList(this.title)
})
taskSchema.index(
  { userId: 1, clientId: 1 },
  {
    name: 'TaskClientId',
    unique: true,
    partialFilterExpression: { clientId: { $type: 'string' }, deletedAt: null },
  },
)
taskSchema.index(
  { workspaceId: 1, projectId: 1, deletedAt: 1, order: 1, createdAt: 1, _id: 1 },
  { name: 'TaskProjectOrder' },
)
taskSchema.index({ workspaceId: 1, deletedAt: 1, completed: 1, dueDate: 1 }, { name: 'TaskDue' })
taskSchema.index(
  { purgeAt: 1 },
  { name: 'TaskPurge', expireAfterSeconds: 0, partialFilterExpression: { purgeAt: { $type: 'date' } } },
)
taskSchema.index({ projectId: 1, completed: 1 })
taskSchema.index({ userId: 1, plannedFor: 1 })
taskSchema.index({ userId: 1, completedOn: 1 })
taskSchema.index({ userId: 1, projectId: 1, order: 1, createdAt: 1, _id: 1 })
taskSchema.index({ userId: 1, completed: 1, dueDate: 1 })
taskSchema.index({ userId: 1, title: 'text' }, { name: 'TaskTextIndex' })
taskSchema.index({ userId: 1, searchWords: 1 }, { name: 'TaskSearchWords' })

const noteSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    searchWords: { type: [String] },
  },
  { timestamps: true, optimisticConcurrency: true },
)
noteSchema.pre('save', function () {
  this.searchWords = wordList(this.title, this.body)
})
noteSchema.index({ userId: 1, projectId: 1, updatedAt: -1 })
noteSchema.index({ workspaceId: 1, projectId: 1, updatedAt: -1 }, { name: 'NoteWorkspace' })
noteSchema.index({ userId: 1, updatedAt: -1 })
noteSchema.index({ userId: 1, searchWords: 1 }, { name: 'NoteSearchWords' })
noteSchema.index(
  { userId: 1, title: 'text', body: 'text' },
  { weights: { title: 5, body: 1 }, name: 'NoteTextIndex' },
)

const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60
const YEAR_SECONDS = 365 * 24 * 60 * 60

const activitySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    type: { type: String, enum: ['create', 'update', 'delete', 'complete'], required: true },
    summary: { type: String, required: true },
    expireAt: { type: Date, default: () => new Date(Date.now() + NINETY_DAYS_SECONDS * 1000) },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
activitySchema.index({ projectId: 1, createdAt: -1, _id: -1 }, { name: 'ActivityProject' })
activitySchema.index({ expireAt: 1 }, { name: 'ActivityExpire', expireAfterSeconds: 0 })

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
notificationSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

const whiteboardSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
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
    deviceName: { type: String, default: '' },
    ipCoarse: { type: String, default: '' },
    location: { type: String, default: '' },
    lastSeenAt: { type: Date, required: true },
    stepUpAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
sessionSchema.index({ tokenHash: 1 }, { unique: true, name: 'SessionToken' })
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
rateLimitSchema.index({ key: 1 }, { unique: true, name: 'RateLimitKey' })
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const workspaceSchema = new Schema(
  {
    name: { type: String, required: true },
    personal: { type: Boolean, default: false, required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    membershipVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
)
workspaceSchema.index({ ownerId: 1, personal: 1 }, { unique: true, partialFilterExpression: { personal: true }, name: 'PersonalWorkspace' })

const membershipSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'admin', 'member', 'viewer'], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true, name: 'MembershipUser' })
membershipSchema.index({ userId: 1, workspaceId: 1 }, { name: 'MembershipByUser' })

const passkeySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    credentialId: { type: String, required: true },
    publicKey: { type: Buffer, required: true },
    counter: { type: Number, required: true, default: 0 },
    transports: { type: [String], default: [] },
    name: { type: String, default: 'Passkey' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
passkeySchema.index({ credentialId: 1 }, { unique: true, name: 'PasskeyId' })
passkeySchema.index({ userId: 1, createdAt: -1 }, { name: 'PasskeyUser' })

const securityEventSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    summary: { type: String, required: true },
    ipCoarse: { type: String, default: '' },
    read: { type: Boolean, default: false, required: true },
    expireAt: { type: Date, default: () => new Date(Date.now() + YEAR_SECONDS * 1000) },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
securityEventSchema.index({ userId: 1, createdAt: -1 }, { name: 'SecurityEventUser' })
securityEventSchema.index({ expireAt: 1 }, { name: 'SecurityEventExpire', expireAfterSeconds: 0 })

const challengeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    challenge: { type: String, required: true },
    kind: { type: String, enum: ['register', 'login', 'stepup'], required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false },
)
challengeSchema.index({ challenge: 1 }, { unique: true, name: 'ChallengeValue' })
challengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

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
slowQueries(workspaceSchema, 'Workspace')
slowQueries(membershipSchema, 'Membership')
slowQueries(passkeySchema, 'Passkey')
slowQueries(securityEventSchema, 'SecurityEvent')
slowQueries(challengeSchema, 'Challenge')

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
export const Workspace = compile('Workspace', () => model('Workspace', workspaceSchema))
export const Membership = compile('Membership', () => model('Membership', membershipSchema))
export const Passkey = compile('Passkey', () => model('Passkey', passkeySchema))
export const SecurityEvent = compile('SecurityEvent', () => model('SecurityEvent', securityEventSchema))
export const WebAuthnChallenge = compile('WebAuthnChallenge', () => model('WebAuthnChallenge', challengeSchema))
