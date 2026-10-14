import mongoose from 'mongoose'
import { HttpError } from './errors.ts'
import { Note, Project, Task, User } from './models.ts'

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

function ensureIndexes(): Promise<void> {
  indexesReady ??= Promise.all([
    User.syncIndexes(),
    Project.syncIndexes(),
    Task.syncIndexes(),
    Note.syncIndexes(),
  ])
    .then(() => undefined)
    .catch((error: unknown) => {
      indexesReady = null
      throw error
    })
  return indexesReady
}

function databaseFailure(error: unknown): HttpError {
  const name = error instanceof Error ? error.name : 'Error'
  const message = error instanceof Error ? error.message : 'Database connection failed.'
  const redacted = message.replace(/mongodb(?:\+srv)?:\/\/\S+/gi, 'mongodb://[redacted]')
  return new HttpError(500, `${name}: ${redacted}`)
}

export async function connectDb(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI
  if (!uri || uri === 'memory') {
    throw new HttpError(500, 'Database is not configured.')
  }

  const state = cache()
  if (state.conn) {
    await ensureIndexes().catch((error: unknown) => {
      throw databaseFailure(error)
    })
    return state.conn
  }

  if (!state.promise) {
    mongoose.set('bufferCommands', false)
    state.promise = mongoose
      .connect(uri, { serverSelectionTimeoutMS: 10000 })
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
    await ensureIndexes()
  } catch (error) {
    state.conn = null
    state.promise = null
    throw error instanceof HttpError ? error : databaseFailure(error)
  }
  return state.conn
}

export async function disconnectDb(): Promise<void> {
  indexesReady = null
  const state = cache()
  state.conn = null
  state.promise = null
  await mongoose.disconnect()
}
