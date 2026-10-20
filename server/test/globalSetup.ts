import { MongoMemoryReplSet } from 'mongodb-memory-server'
import type { TestProject } from 'vitest/node'

let memory: MongoMemoryReplSet | undefined

export async function setup(project: TestProject): Promise<void> {
  memory = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  project.provide('mongoUri', memory.getUri('align'))
}

export async function teardown(): Promise<void> {
  await memory?.stop()
}
