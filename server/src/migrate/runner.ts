import mongoose from 'mongoose'
import { downPersonalWorkspaces, PERSONAL_WORKSPACES, upPersonalWorkspaces, type MigrationCounts } from './personalWorkspaces.ts'

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
]

let running: Promise<MigrationResult[]> | null = null

export async function runMigrations(options?: {
  dryRun?: boolean
  direction?: 'up' | 'down'
  only?: string
}): Promise<MigrationResult[]> {
  if (!options?.dryRun && !options?.direction && !options?.only) {
    running ??= runMigrations({ ...options, direction: 'up' }).finally(() => {
      running = null
    })
    return running
  }
  const db = mongoose.connection.db
  if (!db) return []
  const collection = db.collection<{ id: string; appliedAt: Date; counts: MigrationCounts }>('migrations')
  const applied = new Set((await collection.find({}, { projection: { id: 1 } }).toArray()).map((doc) => doc.id))
  const dryRun = options.dryRun === true
  const direction = options.direction ?? 'up'
  const selected = options.only ? MIGRATIONS.filter((migration) => migration.id === options.only) : MIGRATIONS
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
