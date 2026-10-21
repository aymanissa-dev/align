import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Types } from 'mongoose'
import { Passkey, User } from '../models.ts'
import { hashToken } from '../session.ts'

const DUMMY_KEY = 'align-missing-recovery-key'

export function generateRecoveryKey(): string {
  const hex = randomBytes(16).toString('hex')
  return hex.match(/.{4}/g)?.join('-') ?? hex
}

export function normalizeRecoveryKey(value: string): string {
  return value.toLowerCase().replace(/[^a-f0-9]/g, '')
}

export function hashRecoveryKey(value: string): string {
  return hashToken(`account-recovery:${normalizeRecoveryKey(value)}`)
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Spend the same lookup a real key consumes, without matching an account. */
export async function rejectUnknownRecovery(presented: string): Promise<void> {
  const hash = hashRecoveryKey(presented || DUMMY_KEY)
  sameHash(hash, hashRecoveryKey(DUMMY_KEY))
  await User.findOneAndUpdate({ _id: new Types.ObjectId(), recoveryKeyHash: hash }, { $set: { failedLogins: 0 } })
}

/**
 * Replace the stored key only when `presented` matches. The new key is the
 * only copy; the caller must show it once.
 */
export async function consumeAccountRecoveryKey(
  userId: string,
  presented: string,
  passwordHash: string,
): Promise<string | null> {
  const key = generateRecoveryKey()
  const updated = await User.findOneAndUpdate(
    { _id: userId, recoveryKeyHash: hashRecoveryKey(presented) },
    {
      $set: {
        recoveryKeyHash: hashRecoveryKey(key),
        passwordHash,
        failedLogins: 0,
        lockUntil: null,
        pendingVerification: false,
      },
    },
  )
  return updated ? key : null
}

export async function saveResetPassword(userId: string, passwordHash: string): Promise<void> {
  await User.updateOne(
    { _id: userId },
    { $set: { passwordHash, failedLogins: 0, lockUntil: null, pendingVerification: false } },
  )
}

export async function issueRecoveryKey(userId: string): Promise<string> {
  const key = generateRecoveryKey()
  await User.updateOne({ _id: userId }, { $set: { recoveryKeyHash: hashRecoveryKey(key) } })
  return key
}

/** Drop every factor except the one that authorized this reset. */
export async function clearFactorsAfterReset(
  userId: string,
  method: 'recovery-key' | 'totp-code' | 'passkey',
  passkeyId?: string,
): Promise<void> {
  if (method !== 'totp-code') {
    await User.updateOne(
      { _id: userId },
      { $set: { totpSecret: null, totpEnabledAt: null, recoveryCodes: [] } },
    )
  }
  if (method === 'passkey' && passkeyId) {
    await Passkey.deleteMany({ userId, _id: { $ne: passkeyId } })
    return
  }
  await Passkey.deleteMany({ userId })
}
