import mongoose from 'mongoose'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { RateLimit, User } from '../src/models.ts'
import { hashPassword } from '../src/password.ts'
import { BACKUP_DB, LAUNCH_WIPE, upLaunchWipe } from '../src/migrate/launchWipe.ts'
import { runMigrations } from '../src/migrate/runner.ts'
import { app } from './helpers.ts'

async function resetLaunch(): Promise<void> {
  const db = mongoose.connection.db
  if (!db) throw new Error('no database')
  await db.collection('migrations').deleteOne({ id: LAUNCH_WIPE })
  await db.collection('migration_locks').deleteMany({})
  await mongoose.connection.getClient().db(BACKUP_DB).dropDatabase()
  delete process.env.BLOB_READ_WRITE_TOKEN
}

describe('launch wipe migration', () => {
  it('deletes user data, drops the backup database, and keeps migrations', async () => {
    await resetLaunch()
    const email = `launch-${crypto.randomUUID()}@align.test`
    await User.create({
      name: 'Launch',
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
    const backup = mongoose.connection.getClient().db(BACKUP_DB)
    await backup.collection('users').insertOne({ email, recoveryKeyHash: 'saved-copy' })
    await mongoose.connection.db!.collection('fs.files').insertOne({ filename: 'avatar' })
    await mongoose.connection.db!.collection('fs.chunks').insertOne({ files_id: 'avatar', n: 0, data: 'bytes' })
    const indexesBefore = (await User.collection.indexes()).map((index) => index.name).sort()
    const migrationsBefore = await mongoose.connection.db!.collection('migrations').countDocuments()

    const dry = await runMigrations({ dryRun: true, direction: 'up', only: LAUNCH_WIPE })
    expect(dry[0]?.dryRun).toBe(true)
    expect(dry[0]?.counts.before_users).toBeGreaterThanOrEqual(1)
    expect(await User.countDocuments({ email })).toBe(1)
    expect(await backup.collection('users').countDocuments({ email })).toBe(1)

    const applied = await runMigrations({ direction: 'up', only: LAUNCH_WIPE })
    const counts = applied[0]?.counts ?? {}
    expect(counts.before_users).toBeGreaterThanOrEqual(1)
    expect(counts.before_ratelimits).toBeGreaterThanOrEqual(1)
    expect(counts.after_users).toBe(0)
    expect(counts.after_ratelimits).toBe(0)
    expect(counts.after_migration_locks).toBe(0)
    expect(counts.after_migrations).toBe(migrationsBefore)
    expect(counts.backup_exists).toBe(0)
    expect(counts.gridfs_files).toBe(0)
    expect(counts.gridfs_chunks).toBe(0)
    expect(counts.vercel_blob_configured).toBe(0)
    expect(await User.countDocuments()).toBe(0)
    expect(await RateLimit.countDocuments()).toBe(0)
    expect(await mongoose.connection.db!.collection('fs.files').countDocuments()).toBe(0)
    expect(await mongoose.connection.db!.collection('fs.chunks').countDocuments()).toBe(0)
    const databases = (await mongoose.connection.getClient().db().admin().listDatabases({ nameOnly: true })).databases.map(
      (entry) => entry.name,
    )
    expect(databases).not.toContain(BACKUP_DB)
    expect(await mongoose.connection.db!.collection('migrations').countDocuments({ id: LAUNCH_WIPE })).toBe(1)
    const record = await mongoose.connection.db!.collection('migrations').findOne({ id: LAUNCH_WIPE })
    expect(record?.counts).toMatchObject({ after_users: 0, backup_exists: 0 })
    expect(JSON.stringify(record?.counts)).not.toContain(email)
    expect(JSON.stringify(record?.counts)).not.toContain('hashed-recovery-key')
    expect((await User.collection.indexes()).map((index) => index.name).sort()).toEqual(indexesBefore)

    expect(await runMigrations({ direction: 'up', only: LAUNCH_WIPE })).toEqual([])
    await expect(runMigrations({ direction: 'down', only: LAUNCH_WIPE })).rejects.toThrow(/cannot be rolled back/)
    expect(await mongoose.connection.db!.collection('migrations').countDocuments({ id: LAUNCH_WIPE })).toBe(1)

    const status = await request(app).get('/api/maintenance/wipe')
    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({
      id: LAUNCH_WIPE,
      applied: true,
      backupExists: false,
      live: { users: 0, ratelimits: 0, migrations: expect.any(Number) },
      blobs: { gridfsFiles: 0, gridfsChunks: 0, vercelBlobConfigured: false },
    })
    expect(status.body.databases).not.toContain(BACKUP_DB)
    expect(status.body.live.migrations).toBeGreaterThan(0)
    expect(JSON.stringify(status.body)).not.toContain(email)
    expect((await request(app).get('/api/health')).body).toEqual({ ok: true, db: 'up' })
  })

  it('empties a configured Vercel blob store without recording the token', async () => {
    await resetLaunch()
    const token = 'blob-test-token-value'
    process.env.BLOB_READ_WRITE_TOKEN = token
    const original = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push(String(url))
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe(`Bearer ${token}`)
      expect(String(url)).not.toContain(token)
      if (String(url).includes('/delete')) return new Response('{}', { status: 200 })
      return new Response(
        JSON.stringify({ blobs: [{ url: 'https://example.blob.vercel-storage.com/file' }], hasMore: false }),
        { status: 200 },
      )
    }) as typeof fetch
    try {
      const applied = await runMigrations({ direction: 'up', only: LAUNCH_WIPE })
      expect(applied[0]?.counts.vercel_blob_configured).toBe(1)
      expect(applied[0]?.counts.vercel_blob_deleted).toBe(1)
      expect(calls.some((url) => url.includes('/delete'))).toBe(true)
      const record = await mongoose.connection.db!.collection('migrations').findOne({ id: LAUNCH_WIPE })
      expect(JSON.stringify(record?.counts)).not.toContain(token)
    } finally {
      globalThis.fetch = original
      delete process.env.BLOB_READ_WRITE_TOKEN
    }
  })

  it('does not delete while another launch wipe holds the lock', async () => {
    await resetLaunch()
    const email = `busy-${crypto.randomUUID()}@align.test`
    await User.create({
      name: 'Busy',
      email,
      passwordHash: await hashPassword('password12'),
    })
    await mongoose.connection.db!.collection('migration_locks').insertOne({
      key: '005_launch_wipe',
      phase: 'running',
      heartbeat: new Date(),
    })
    await expect(upLaunchWipe(false)).rejects.toThrow(/launch wipe already running/)
    expect(await User.countDocuments({ email })).toBe(1)
    expect(await mongoose.connection.db!.collection('migration_locks').countDocuments({ key: '005_launch_wipe' })).toBe(1)
  })
})
