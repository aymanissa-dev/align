import mongoose from 'mongoose'
import { HttpError } from './errors.ts'
import { Activity, AuthToken, Label, Note, Notification, Project, RateLimit, Session, Task, User, Whiteboard } from './models.ts'

type Cache = {
  conn: typeof mongoose | null
  promise: Promise<typeof mongoose> | null
}

const globalCache = globalThis as typeof globalThis & { __alignMongoose?: Cache }

function cache(): Cache {
  globalCache.__alignMongoose ??= { conn: null, promise: null }
  return globalCache.__alignMongoose
}

let indexesReady: Promise<void> | null = null

/** A collection can hold one text index. Drop the unscoped copy before creating the user-prefixed one. */
async function dropUnscopedText(collection: mongoose.Collection, name: string): Promise<void> {
  let indexes: { name?: string; key?: Record<string, unknown> }[]
  try {
    indexes = await collection.indexes()
  } catch {
    return
  }
  const found = indexes.find((index) => index.name === name)
  if (!found || found.key?.userId === 1) return
  await collection.dropIndex(name)
}

function ensureIndexes(): Promise<void> {
  indexesReady ??= Promise.all([
    dropUnscopedText(Project.collection, 'ProjectTextIndex'),
    dropUnscopedText(Task.collection, 'TaskTextIndex'),
    dropUnscopedText(Note.collection, 'NoteTextIndex'),
  ])
    .then(() =>
      Promise.all([
        User.syncIndexes(),
        Project.syncIndexes(),
        Label.syncIndexes(),
        Task.syncIndexes(),
        Note.syncIndexes(),
        Activity.syncIndexes(),
        Notification.syncIndexes(),
        Whiteboard.syncIndexes(),
        Session.syncIndexes(),
        AuthToken.syncIndexes(),
        RateLimit.syncIndexes(),
      ]),
    )
    .then(() => undefined)
    .catch((error: unknown) => {
      indexesReady = null
      throw error
    })
  return indexesReady
}

function databaseFailure(error: unknown): HttpError {
  console.error(error)
  return new HttpError(500, 'Database connection failed.')
}

function shouldSync(options?: { indexes?: boolean }): boolean {
  return options?.indexes === true || process.env.NODE_ENV === 'test'
}

export async function connectDb(options?: { indexes?: boolean }): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI
  if (!uri || uri === 'memory') {
    throw new HttpError(500, 'Database is not configured.')
  }

  const state = cache()
  if (state.conn) {
    if (shouldSync(options)) await ensureIndexes()
    return state.conn
  }

  if (!state.promise) {
    mongoose.set('bufferCommands', false)
    state.promise = mongoose
      .connect(uri, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 5,
        minPoolSize: 1,
        maxIdleTimeMS: 60_000,
        socketTimeoutMS: 20_000,
      })
      .then((connection) => {
        state.conn = connection
        return connection
      })
      .catch((error: unknown) => {
        state.promise = null
        throw error
      })
  }

  try {
    state.conn = await state.promise
  } catch (error) {
    state.conn = null
    state.promise = null
    throw error instanceof HttpError ? error : databaseFailure(error)
  }
  if (shouldSync(options)) await ensureIndexes()
  return state.conn
}

export async function disconnectDb(): Promise<void> {
  indexesReady = null
  const state = cache()
  state.conn = null
  state.promise = null
  await mongoose.disconnect()
}
