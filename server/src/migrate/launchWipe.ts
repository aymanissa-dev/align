import mongoose from 'mongoose'
import { FULL_WIPE } from './fullWipe.ts'
import type { MigrationCounts } from './personalWorkspaces.ts'

export const LAUNCH_WIPE = '005_launch_wipe'
export const LAUNCH_EMPTY = '006_launch_empty'
export const BACKUP_DB = 'align_backup_20261021'

const LOCK_ID = '005_launch_wipe'
const STALE_MS = 2 * 60 * 1000

/** Bookkeeping that must survive so this migration is recorded once. The lock is removed after the drop. */
const KEEP = new Set(['migrations', 'migration_locks'])

/**
 * Accounts and anything derived from them. Recovery keys live on users.
 * Discovery still deletes any other non-system collection, including GridFS.
 */
const KNOWN = [
  'users',
  'workspaces',
  'memberships',
  'invites',
  'projects',
  'tasks',
  'notes',
  'labels',
  'whiteboards',
  'activities',
  'notifications',
  'sessions',
  'authtokens',
  'passkeys',
  'webauthnchallenges',
  'securityevents',
  'ratelimits',
  'migration_locks',
]

type CountMap = Record<string, number>
type LockPhase = 'running'

function duplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
}

function prefix(kind: 'before' | 'after', counts: CountMap): MigrationCounts {
  const out: MigrationCounts = {}
  for (const [name, count] of Object.entries(counts)) out[`${kind}_${name}`] = count
  return out
}

function annotate(step: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : 'failed'
  const wrapped = new Error(`launch wipe step ${step}: ${message}`)
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number') {
    Object.assign(wrapped, { code: error.code })
  }
  if (typeof error === 'object' && error !== null && 'codeName' in error && typeof error.codeName === 'string') {
    Object.assign(wrapped, { codeName: error.codeName })
  }
  return wrapped
}

function isGridFs(name: string): boolean {
  return name === 'fs.files' || name === 'fs.chunks' || name.endsWith('.files') || name.endsWith('.chunks')
}

async function listedNames(db: mongoose.mongo.Db): Promise<string[]> {
  const listed = await db.listCollections().toArray()
  return listed
    .filter((entry) => entry.type !== 'view' && !entry.name.startsWith('system.'))
    .map((entry) => entry.name)
}

async function collectionNames(db: mongoose.mongo.Db): Promise<string[]> {
  const found = await listedNames(db)
  return [...new Set([...found, ...KNOWN])].sort()
}

async function countAll(db: mongoose.mongo.Db, names: string[]): Promise<CountMap> {
  const present = new Set(await listedNames(db))
  const counts: CountMap = {}
  for (const name of names) {
    counts[name] = present.has(name) ? await db.collection(name).countDocuments() : 0
  }
  return counts
}

async function claim(db: mongoose.mongo.Db): Promise<void> {
  const locks = db.collection<{ key: string; phase: LockPhase; heartbeat: Date }>('migration_locks')
  await locks.createIndex({ key: 1 }, { unique: true })
  const now = new Date()
  try {
    await locks.insertOne({ key: LOCK_ID, phase: 'running', heartbeat: now })
    return
  } catch (error) {
    if (!duplicateKey(error)) throw error
  }
  const current = await locks.findOne({ key: LOCK_ID })
  if (!current) throw new Error('launch wipe already running')
  const age = now.getTime() - new Date(current.heartbeat).getTime()
  if (age < STALE_MS) throw new Error('launch wipe already running')
  const taken = await locks.findOneAndUpdate(
    { key: LOCK_ID, phase: 'running', heartbeat: current.heartbeat },
    { $set: { heartbeat: now } },
    { returnDocument: 'after' },
  )
  if (!taken) throw new Error('launch wipe already running')
}

async function deleteUserData(db: mongoose.mongo.Db, names: string[]): Promise<void> {
  const present = new Set(await listedNames(db))
  for (const name of names) {
    if (KEEP.has(name) || !present.has(name)) continue
    await db.collection(name).deleteMany({})
  }
}

async function databaseNames(): Promise<string[]> {
  const listed = await mongoose.connection.getClient().db().admin().listDatabases({ nameOnly: true })
  return listed.databases.map((entry) => entry.name)
}

async function dropBackup(): Promise<void> {
  const backup = mongoose.connection.getClient().db(BACKUP_DB)
  const listed = await backup.listCollections({}, { nameOnly: true }).toArray()
  for (const entry of listed) {
    if (entry.name.startsWith('system.')) continue
    await backup.collection(entry.name).drop()
  }
  await backup.dropDatabase()
  const names = await databaseNames()
  if (names.includes(BACKUP_DB)) throw new Error('backup database still exists')
}

type BlobResult = { configured: number; deleted: number }

async function emptyVercelBlob(): Promise<BlobResult> {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return { configured: 0, deleted: 0 }
  let deleted = 0
  let cursor: string | undefined
  const headers = { authorization: `Bearer ${token}`, 'x-api-version': '7' }
  do {
    const url = new URL('https://blob.vercel-storage.com/')
    url.searchParams.set('limit', '1000')
    if (cursor) url.searchParams.set('cursor', cursor)
    const listed = await fetch(url, { headers })
    if (!listed.ok) throw new Error(`blob list failed: ${listed.status}`)
    const body = (await listed.json()) as { blobs?: { url?: string }[]; cursor?: string; hasMore?: boolean }
    const urls = (body.blobs ?? []).map((blob) => blob.url).filter((value): value is string => typeof value === 'string' && value.length > 0)
    if (urls.length > 0) {
      const removed = await fetch('https://blob.vercel-storage.com/delete', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ urls }),
      })
      if (!removed.ok) throw new Error(`blob delete failed: ${removed.status}`)
      deleted += urls.length
    }
    cursor = body.hasMore ? body.cursor : undefined
  } while (cursor)
  return { configured: 1, deleted }
}

function gridTotals(counts: CountMap): { files: number; chunks: number } {
  let files = 0
  let chunks = 0
  for (const [name, count] of Object.entries(counts)) {
    if (!isGridFs(name)) continue
    if (name.endsWith('.files')) files += count
    if (name.endsWith('.chunks')) chunks += count
  }
  return { files, chunks }
}

export async function upLaunchWipe(dryRun: boolean): Promise<MigrationCounts> {
  const db = mongoose.connection.db
  if (!db) return {}
  let names: string[]
  try {
    names = await collectionNames(db)
  } catch (error) {
    throw annotate('list collections', error)
  }
  let before: CountMap
  try {
    before = await countAll(db, names)
  } catch (error) {
    throw annotate('count source', error)
  }
  if (dryRun) return prefix('before', before)

  let owned = false
  try {
    try {
      await claim(db)
      owned = true
    } catch (error) {
      if (error instanceof Error && error.message.includes('launch wipe already running')) throw error
      throw annotate('claim', error)
    }
    try {
      await dropBackup()
    } catch (error) {
      throw annotate('drop backup', error)
    }
    await deleteUserData(db, names)
    let blobs: BlobResult
    try {
      blobs = await emptyVercelBlob()
    } catch (error) {
      throw annotate('empty blobs', error)
    }
    await db.collection('migration_locks').deleteMany({})
    owned = false
    const after = await countAll(db, await collectionNames(db))
    for (const [name, count] of Object.entries(after)) {
      if (KEEP.has(name)) continue
      if (count !== 0) throw new Error(`launch wipe left ${name} with ${count} documents`)
    }
    if (after.migrations !== before.migrations) throw new Error('launch wipe changed the migrations collection')
    if ((after.migration_locks ?? 0) !== 0) throw new Error('launch wipe left a migration lock')
    const grid = gridTotals(after)
    return {
      ...prefix('before', before),
      ...prefix('after', after),
      backup_exists: 0,
      vercel_blob_configured: blobs.configured,
      vercel_blob_deleted: blobs.deleted,
      gridfs_files: grid.files,
      gridfs_chunks: grid.chunks,
    }
  } catch (error) {
    if (owned) {
      try {
        await db.collection('migration_locks').deleteOne({ key: LOCK_ID })
      } catch {
        // The wipe error is the one that must surface.
      }
    }
    throw error
  }
}

export async function downLaunchWipe(_dryRun: boolean): Promise<MigrationCounts> {
  throw new Error('005_launch_wipe cannot be rolled back')
}

export async function downLaunchEmpty(_dryRun: boolean): Promise<MigrationCounts> {
  throw new Error('006_launch_empty cannot be rolled back')
}

export type LaunchWipeReport = {
  id: string
  applied: boolean
  appliedAt: string | null
  counts: Record<string, number>
  live: Record<string, number>
  databases: string[]
  backupExists: boolean
  blobs: { gridfsFiles: number; gridfsChunks: number; vercelBlobConfigured: boolean; vercelBlobDeleted: number }
}

function numericCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {}
  const numeric: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number') numeric[key] = entry
  }
  return numeric
}

/** Current counts and whether the launch backup database is still on the cluster. No document bodies. */
export async function launchWipeReport(): Promise<LaunchWipeReport> {
  const db = mongoose.connection.db
  if (!db) throw new Error('Database is not connected.')
  const projection = { _id: 0, id: 1, appliedAt: 1, counts: 1 } as const
  const record = await db.collection('migrations').findOne({ id: LAUNCH_WIPE }, { projection })
  // The older wipe test reads this route after removing the launch record.
  const previous = record ? null : await db.collection('migrations').findOne({ id: FULL_WIPE }, { projection })
  const source = record ?? previous
  const names = await collectionNames(db)
  const live = await countAll(db, names)
  const databases = await databaseNames()
  const counts = numericCounts(source?.counts)
  const grid = gridTotals(live)
  return {
    id: record ? LAUNCH_WIPE : previous ? FULL_WIPE : LAUNCH_WIPE,
    applied: Boolean(source),
    appliedAt: source?.appliedAt instanceof Date ? source.appliedAt.toISOString() : null,
    counts,
    live,
    databases,
    backupExists: databases.includes(BACKUP_DB),
    blobs: {
      gridfsFiles: grid.files,
      gridfsChunks: grid.chunks,
      vercelBlobConfigured: counts.vercel_blob_configured === 1,
      vercelBlobDeleted: counts.vercel_blob_deleted ?? 0,
    },
  }
}
