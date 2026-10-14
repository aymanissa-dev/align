import { MongoMemoryServer } from 'mongodb-memory-server'
import type { TestProject } from 'vitest/node'

let memory: MongoMemoryServer | undefined

export async function setup(project: TestProject): Promise<void> {
  memory = await MongoMemoryServer.create()
  project.provide('mongoUri', memory.getUri('align'))
}

export async function teardown(): Promise<void> {
  await memory?.stop()
}
