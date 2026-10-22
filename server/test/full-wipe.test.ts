import mongoose from 'mongoose'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { RateLimit, User } from '../src/models.ts'
import { hashPassword } from '../src/password.ts'
import { BACKUP_DB, FULL_WIPE, upFullWipe, wipeTest } from '../src/migrate/fullWipe.ts'
import { LAUNCH_WIPE } from '../src/migrate/launchWipe.ts'
import { runMigrations } from '../src/migrate/runner.ts'
import { wipeFailure } from '../src/app.ts'
import { app } from './helpers.ts'

async function resetWipe(): Promise<void> {
  const db = mongoose.connection.db
  if (!db) throw new Error('no database')
  await db.collection('migrations').deleteOne({ id: FULL_WIPE })
  await db.collection('migration_locks').deleteMany({})
  await mongoose.connection.getClient().db(BACKUP_DB).dropDatabase()
  wipeTest.afterCopy = null
}

describe('full wipe migration', () => {
  it('redacts secrets from a wipe failure', () => {
    const error = Object.assign(new Error('auth failed mongodb+srv://user:secret@cluster.mongodb.net/align for keep@align.test'), {
      code: 13,
      codeName: 'Unauthorized',
    })
    expect(wipeFailure(error)).toEqual({
      name: 'Error',
      code: 13,
      codeName: 'Unauthorized',
      message: 'auth failed [redacted] for [redacted]',
    })
  })

  it('copies every collection, checks the counts, then deletes user data once', async () => {
    await resetWipe()
    const email = `wipe-${crypto.randomUUID()}@align.test`
    await User.create({
      name: 'Wipe',
      email,
      passwordHash: await hashPassword('password12'),
      recoveryKeyHash: 'hashed-recovery-key',
    })
    await RateLimit.create({
      key: 'register:ip:203.0.113.10',
      windowStart: Date.now(),
      count: 2,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const indexesBefore = (await User.collection.indexes()).map((index) => index.name).sort()
    const migrationsBefore = await mongoose.connection.db!.collection('migrations').countDocuments()

    const dry = await runMigrations({ dryRun: true, direction: 'up', only: FULL_WIPE })
    expect(dry[0]?.dryRun).toBe(true)
    expect(dry[0]?.counts.before_users).toBeGreaterThanOrEqual(1)
    expect(await User.countDocuments({ email })).toBe(1)

    const applied = await runMigrations({ direction: 'up', only: FULL_WIPE })
    const counts = applied[0]?.counts ?? {}
    expect(counts.before_users).toBe(counts.backup_users)
    expect(counts.before_ratelimits).toBe(counts.backup_ratelimits)
    expect(counts.before_migrations).toBe(counts.backup_migrations)
    expect(counts.after_users).toBe(0)
    expect(counts.after_ratelimits).toBe(0)
    expect(counts.after_migrations).toBe(migrationsBefore)
    expect(await User.countDocuments()).toBe(0)
    expect(await RateLimit.countDocuments()).toBe(0)

    const backup = mongoose.connection.getClient().db(BACKUP_DB)
    expect(await backup.collection('users').countDocuments()).toBe(counts.backup_users)
    const stored = await backup.collection('users').findOne({ email })
    expect(stored?.recoveryKeyHash).toBe('hashed-recovery-key')
    expect(await mongoose.connection.db!.collection('migrations').countDocuments({ id: FULL_WIPE })).toBe(1)
    const record = await mongoose.connection.db!.collection('migrations').findOne({ id: FULL_WIPE })
    expect(record?.counts).toMatchObject({ after_users: 0, backup_users: counts.backup_users })
    expect(JSON.stringify(record?.counts)).not.toContain(email)
    expect((await User.collection.indexes()).map((index) => index.name).sort()).toEqual(indexesBefore)

    expect(await runMigrations({ direction: 'up', only: FULL_WIPE })).toEqual([])
    expect(await backup.collection('users').countDocuments({ email })).toBe(1)

    await mongoose.connection.db!.collection('migrations').deleteOne({ id: FULL_WIPE })
    await mongoose.connection.db!.collection('migration_locks').deleteMany({})
    await User.create({
      name: 'Later',
      email: `later-${crypto.randomUUID()}@align.test`,
      passwordHash: await hashPassword('password12'),
    })
    const again = await runMigrations({ direction: 'up', only: FULL_WIPE })
    expect(again[0]?.counts.backup_users).toBe(counts.backup_users)
    expect(await backup.collection('users').countDocuments()).toBe(counts.backup_users)
    expect(await backup.collection('users').countDocuments({ email })).toBe(1)
    expect(await User.countDocuments()).toBe(0)

    await expect(runMigrations({ direction: 'down', only: FULL_WIPE })).rejects.toThrow(/cannot be rolled back/)
    expect(await mongoose.connection.db!.collection('migrations').countDocuments({ id: FULL_WIPE })).toBe(1)

    await mongoose.connection.db!.collection('migrations').deleteOne({ id: LAUNCH_WIPE })
    const status = await request(app).get('/api/maintenance/wipe')
    expect(status.status).toBe(200)
    expect(status.body.applied).toBe(true)
    expect(status.body.counts.after_users).toBe(0)
    expect(JSON.stringify(status.body)).not.toContain(email)
    expect((await request(app).get('/api/health')).body).toEqual({ ok: true, db: 'up' })
  })

  it('aborts without deleting when the backup count does not match', async () => {
    await resetWipe()
    const email = `keep-${crypto.randomUUID()}@align.test`
    await User.create({
      name: 'Keep',
      email,
      passwordHash: await hashPassword('password12'),
    })
    wipeTest.afterCopy = async () => {
      const backup = mongoose.connection.getClient().db(BACKUP_DB)
      await backup.collection('users').deleteMany({})
    }
    await expect(runMigrations({ direction: 'up', only: FULL_WIPE })).rejects.toThrow(/wipe backup mismatch for users/)
    expect(await User.countDocuments({ email })).toBe(1)
    expect(await mongoose.connection.db!.collection('migrations').countDocuments({ id: FULL_WIPE })).toBe(0)
    expect(await mongoose.connection.db!.collection('migration_locks').countDocuments({ key: '004_full_wipe' })).toBe(0)
  })

  it('does not start a second copy while a wipe holds the lock', async () => {
    await resetWipe()
    await User.create({
      name: 'Busy',
      email: `busy-${crypto.randomUUID()}@align.test`,
      passwordHash: await hashPassword('password12'),
    })
    await mongoose.connection.db!.collection('migration_locks').insertOne({
      key: '004_full_wipe',
      phase: 'copying',
      heartbeat: new Date(),
    })
    await expect(upFullWipe(false)).rejects.toThrow(/wipe already running/)
    expect(await User.countDocuments()).toBe(1)
  })
})
