import { randomBytes } from 'node:crypto'
import { AuthToken } from './models.ts'
import { hashToken } from './session.ts'

const HOUR_MS = 60 * 60 * 1000

export async function issueAuthToken(userId: string, type: 'verify' | 'reset'): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const ttl = type === 'verify' ? 24 * HOUR_MS : HOUR_MS
  await AuthToken.deleteMany({ userId, type, usedAt: null })
  await AuthToken.create({
    userId,
    type,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttl),
  })
  return token
}

export async function consumeAuthToken(token: string, type: 'verify' | 'reset'): Promise<string | null> {
  const found = await AuthToken.findOne({
    tokenHash: hashToken(token),
    type,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  })
  if (!found) return null
  found.usedAt = new Date()
  await found.save()
  return found.userId.toString()
}
