import { afterAll, beforeAll, beforeEach, inject } from 'vitest'
import { connectDb, disconnectDb } from '../src/db.ts'
import { Activity, AuthToken, Label, Note, Notification, Project, RateLimit, Session, Task, User, Whiteboard } from '../src/models.ts'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET ??= 'test-jwt-secret-value'
process.env.BCRYPT_ROUNDS = '4'

beforeAll(async () => {
  process.env.MONGODB_URI = inject('mongoUri')
  await connectDb()
})

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Project.deleteMany({}),
    Label.deleteMany({}),
    Task.deleteMany({}),
    Note.deleteMany({}),
    Activity.deleteMany({}),
    Notification.deleteMany({}),
    Whiteboard.deleteMany({}),
    Session.deleteMany({}),
    AuthToken.deleteMany({}),
    RateLimit.deleteMany({}),
  ])
})

afterAll(async () => {
  await disconnectDb()
})

declare module 'vitest' {
  interface ProvidedContext {
    mongoUri: string
  }
}
