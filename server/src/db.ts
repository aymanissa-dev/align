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

export async function connectDb(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI
  if (!uri || uri === 'memory') {
    throw new HttpError(500, 'Database is not configured.')
  }

  const state = cache()
  if (state.conn) {
    await ensureIndexes()
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

  state.conn = await state.promise
  await ensureIndexes()
  return state.conn
}

export async function disconnectDb(): Promise<void> {
  indexesReady = null
  const state = cache()
  state.conn = null
  state.promise = null
  await mongoose.disconnect()
}
