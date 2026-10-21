import mongoose from 'mongoose'
import { downPersonalWorkspaces, PERSONAL_WORKSPACES, upPersonalWorkspaces, type MigrationCounts } from './personalWorkspaces.ts'
import { downRevokeExposedTokens, REVOKE_EXPOSED_TOKENS, upRevokeExposedTokens } from './revokeExposedTokens.ts'
import { downPurgeReviewerWorkspace, PURGE_REVIEWER_WORKSPACE, upPurgeReviewerWorkspace } from './purgeReviewerWorkspace.ts'
import { downFullWipe, FULL_WIPE, upFullWipe } from './fullWipe.ts'

export type MigrationResult = {
  id: string
  direction: 'up' | 'down'
  dryRun: boolean
  counts: MigrationCounts
}

type Migration = {
  id: string
  up: (dryRun: boolean) => Promise<MigrationCounts>
  down: (dryRun: boolean) => Promise<MigrationCounts>
}

const MIGRATIONS: Migration[] = [
  { id: PERSONAL_WORKSPACES, up: upPersonalWorkspaces, down: downPersonalWorkspaces },
  { id: REVOKE_EXPOSED_TOKENS, up: upRevokeExposedTokens, down: downRevokeExposedTokens },
  { id: PURGE_REVIEWER_WORKSPACE, up: upPurgeReviewerWorkspace, down: downPurgeReviewerWorkspace },
  { id: FULL_WIPE, up: upFullWipe, down: downFullWipe },
]

let appliedOnce: Promise<MigrationResult[]> | null = null

export function runMigrations(options?: {
  dryRun?: boolean
  direction?: 'up' | 'down'
  only?: string
}): Promise<MigrationResult[]> {
  if (!options?.dryRun && !options?.direction && !options?.only) {
    appliedOnce ??= execute({ direction: 'up' }).catch((error: unknown) => {
      appliedOnce = null
      throw error
    })
    return appliedOnce
  }
  return execute(options)
}

async function execute(options?: {
  dryRun?: boolean
  direction?: 'up' | 'down'
  only?: string
}): Promise<MigrationResult[]> {
  const db = mongoose.connection.db
  if (!db) return []
  const collection = db.collection<{ id: string; appliedAt: Date; counts: MigrationCounts }>('migrations')
  const applied = new Set((await collection.find({}, { projection: { id: 1 } }).toArray()).map((doc) => doc.id))
  const dryRun = options?.dryRun === true
  const direction = options?.direction ?? 'up'
  const selected = options?.only ? MIGRATIONS.filter((migration) => migration.id === options.only) : MIGRATIONS
  const results: MigrationResult[] = []
  const list = direction === 'down' ? [...selected].reverse() : selected
  for (const migration of list) {
    if (direction === 'up' && applied.has(migration.id)) continue
    if (direction === 'down' && !applied.has(migration.id) && !dryRun) continue
    const counts = direction === 'down' ? await migration.down(dryRun) : await migration.up(dryRun)
    if (!dryRun && direction === 'up') {
      await collection.insertOne({ id: migration.id, appliedAt: new Date(), counts })
      console.info(JSON.stringify({ msg: 'migration', id: migration.id, counts }))
    }
    if (!dryRun && direction === 'down') {
      await collection.deleteOne({ id: migration.id })
      console.info(JSON.stringify({ msg: 'migration-down', id: migration.id, counts }))
    }
    results.push({ id: migration.id, direction, dryRun, counts })
  }
  return results
}
