import mongoose from 'mongoose'
import type { MigrationCounts } from './personalWorkspaces.ts'

export const FULL_WIPE = '004_full_wipe'
export const BACKUP_DB = 'align_backup_20261021'

const LOCK_ID = '004_full_wipe'
const MANIFEST_ID = '004_full_wipe'
const STALE_MS = 2 * 60 * 1000
const KEEP = new Set(['migrations', 'migration_locks'])

/** Collections that hold accounts or anything derived from them. Recovery keys live on users. */
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
]

type CountMap = Record<string, number>

type Manifest = {
  id: string
  verified: true
  before: CountMap
  backup: CountMap
}

type LockPhase = 'copying' | 'verified' | 'done'

/** Test-only seam. Production never sets this. */
export const wipeTest: { afterCopy: (() => Promise<void>) | null } = { afterCopy: null }

function duplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
}

function prefix(kind: 'before' | 'backup' | 'after', counts: CountMap): MigrationCounts {
  const out: MigrationCounts = {}
  for (const [name, count] of Object.entries(counts)) out[`${kind}_${name}`] = count
  return out
}

async function collectionNames(db: mongoose.mongo.Db): Promise<string[]> {
  const listed = await db.listCollections().toArray()
  const found = listed
    .filter((entry) => entry.type !== 'view' && !entry.name.startsWith('system.') && entry.name !== 'migration_locks')
    .map((entry) => entry.name)
  return [...new Set([...found, ...KNOWN])].sort()
}

async function countAll(db: mongoose.mongo.Db, names: string[]): Promise<CountMap> {
  const counts: CountMap = {}
  for (const name of names) counts[name] = await db.collection(name).countDocuments()
  return counts
}

function backupDb(): mongoose.mongo.Db {
  const client = mongoose.connection.getClient()
  return client.db(BACKUP_DB)
}

async function claim(db: mongoose.mongo.Db): Promise<'copy' | 'delete'> {
  const locks = db.collection<{ key: string; phase: LockPhase; heartbeat: Date }>('migration_locks')
  await locks.createIndex({ key: 1 }, { unique: true })
  const now = new Date()
  try {
    await locks.insertOne({ key: LOCK_ID, phase: 'copying', heartbeat: now })
    return 'copy'
  } catch (error) {
    if (!duplicateKey(error)) throw error
  }
  const current = await locks.findOne({ key: LOCK_ID })
  if (!current) throw new Error('wipe already running')
  const age = now.getTime() - new Date(current.heartbeat).getTime()
  if (current.phase === 'done') return 'delete'
  if (current.phase === 'verified') {
    if (age < STALE_MS) throw new Error('wipe already running')
    return 'delete'
  }
  if (age < STALE_MS) throw new Error('wipe already running')
  const taken = await locks.findOneAndUpdate(
    { key: LOCK_ID, phase: 'copying', heartbeat: current.heartbeat },
    { $set: { heartbeat: now } },
    { returnDocument: 'after' },
  )
  if (!taken) throw new Error('wipe already running')
  return 'copy'
}

async function copyAll(db: mongoose.mongo.Db, names: string[]): Promise<void> {
  const locks = db.collection('migration_locks')
  const backup = backupDb()
  for (const name of names) {
    await locks.updateOne({ key: LOCK_ID }, { $set: { heartbeat: new Date() } })
    const exists = (await db.listCollections({ name }).toArray()).length > 0
    if (!exists) {
      if ((await backup.collection(name).countDocuments()) !== 0) await backup.collection(name).deleteMany({})
      continue
    }
    await db.collection(name).aggregate([{ $match: {} }, { $out: { db: BACKUP_DB, coll: name } }]).toArray()
  }
}

async function deleteUserData(db: mongoose.mongo.Db, names: string[]): Promise<void> {
  for (const name of names) {
    if (KEEP.has(name)) continue
    await db.collection(name).deleteMany({})
  }
}

export async function upFullWipe(dryRun: boolean): Promise<MigrationCounts> {
  const db = mongoose.connection.db
  if (!db) return {}
  const names = await collectionNames(db)
  const before = await countAll(db, names)
  if (dryRun) return prefix('before', before)

  await claim(db)
  const backup = backupDb()
  try {
    const manifest = await backup.collection<Manifest>('wipe_manifest').findOne({ id: MANIFEST_ID })
    let beforeCounts = before
    let backupCounts: CountMap
    if (manifest?.verified === true) {
      beforeCounts = manifest.before
      backupCounts = manifest.backup
    } else {
      await copyAll(db, names)
      if (process.env.NODE_ENV === 'test' && wipeTest.afterCopy) await wipeTest.afterCopy()
      backupCounts = await countAll(backup, names)
      for (const name of names) {
        if (before[name] !== backupCounts[name]) {
          throw new Error(`wipe backup mismatch for ${name}: source ${before[name]} backup ${backupCounts[name]}`)
        }
      }
      await backup.collection('wipe_manifest').replaceOne(
        { id: MANIFEST_ID },
        { id: MANIFEST_ID, verified: true, before: beforeCounts, backup: backupCounts },
        { upsert: true },
      )
      await db.collection('migration_locks').updateOne(
        { key: LOCK_ID },
        { $set: { phase: 'verified', heartbeat: new Date() } },
      )
    }
    await deleteUserData(db, names)
    const after = await countAll(db, names)
    await db.collection('migration_locks').updateOne(
      { key: LOCK_ID },
      { $set: { phase: 'done', heartbeat: new Date() } },
    )
    return { ...prefix('before', beforeCounts), ...prefix('backup', backupCounts), ...prefix('after', after) }
  } catch (error) {
    const lock = await db.collection<{ phase?: string }>('migration_locks').findOne({ key: LOCK_ID })
    if (lock?.phase === 'copying') await db.collection('migration_locks').deleteOne({ key: LOCK_ID, phase: 'copying' })
    throw error
  }
}

export async function downFullWipe(_dryRun: boolean): Promise<MigrationCounts> {
  throw new Error('004_full_wipe cannot be rolled back')
}
