import { config } from 'dotenv'
import { resolve } from 'node:path'

const envPath = resolve(import.meta.dirname, '../../.env')
config({ path: envPath })

async function main(): Promise<void> {
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is required. Copy .env.example to .env and set it.')
    process.exit(1)
  }
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is required. Copy .env.example to .env and set it.')
    process.exit(1)
  }

  if (process.env.MONGODB_URI === 'memory') {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server')
    const memory = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
    process.env.MONGODB_URI = memory.getUri('align')
    console.log('Using an in-memory MongoDB. Data is discarded when the API stops.')
  }

  const { connectDb } = await import('./db.ts')
  const { createApp } = await import('./app.ts')
  await connectDb()

  if (process.env.SEED_DEMO === 'true') {
    const { seedDemo } = await import('./demo.ts')
    const created = await seedDemo()
    if (created) console.log('Seeded demo account demo@align.app')
  }

  const port = Number(process.env.PORT ?? 3001)
  const app = createApp()
  app.listen(port, '0.0.0.0', () => {
    console.log(`API listening on http://localhost:${port}`)
  })
}

void main()
