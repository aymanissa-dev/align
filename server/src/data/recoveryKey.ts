import { randomBytes, timingSafeEqual } from 'node:crypto'
import mongoose, { Types } from 'mongoose'
import { recoveryHash } from './factors.ts'
import { User } from '../models.ts'
import { hashToken } from '../session.ts'
import { verifyTotp } from '../totp.ts'

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

export async function issueRecoveryKey(userId: string): Promise<string> {
  const key = generateRecoveryKey()
  await User.updateOne({ _id: userId }, { $set: { recoveryKeyHash: hashRecoveryKey(key) } })
  return key
}

class ResetRejected extends Error {}

const DUMMY_TOTP = 'JBSWY3DPEHPK3PXP'

/**
 * Rotate the recovery key and save the new password only when the recovery key
 * matches. A 2FA account also needs a current authenticator code or an unused
 * 2FA recovery code, consumed in the same transaction. TOTP and passkeys stay.
 */
export async function resetWithRecoveryKey(input: {
  userId: string
  presentedKey: string
  passwordHash: string
  code: string
}): Promise<string | null> {
  const session = await mongoose.startSession()
  const nextKey = generateRecoveryKey()
  try {
    await session.withTransaction(async () => {
      const fresh = await User.findOne({ _id: input.userId, recoveryKeyHash: hashRecoveryKey(input.presentedKey) })
        .select('+passwordHash +totpSecret +recoveryCodes +recoveryKeyHash')
        .session(session)
      if (!fresh) throw new ResetRejected()
      if (fresh.totpEnabledAt) {
        const totpOk = Boolean(fresh.totpSecret && verifyTotp(fresh.totpSecret, input.code))
        if (!totpOk) {
          const spent = await User.findOneAndUpdate(
            {
              _id: input.userId,
              recoveryCodes: { $elemMatch: { hash: recoveryHash(input.code), usedAt: null } },
            },
            { $set: { 'recoveryCodes.$.usedAt': new Date() } },
            { session },
          )
          if (!spent) throw new ResetRejected()
        }
      } else {
        verifyTotp(DUMMY_TOTP, input.code || '000000')
      }
      await User.updateOne(
        { _id: input.userId },
        {
          $set: {
            passwordHash: input.passwordHash,
            recoveryKeyHash: hashRecoveryKey(nextKey),
            failedLogins: 0,
            lockUntil: null,
            pendingVerification: false,
          },
        },
        { session },
      )
    })
    return nextKey
  } catch (error) {
    if (error instanceof ResetRejected) return null
    throw error
  } finally {
    await session.endSession()
  }
}
