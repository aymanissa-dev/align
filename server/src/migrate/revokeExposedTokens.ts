import { AuthToken, User } from '../models.ts'
import type { MigrationCounts } from './personalWorkspaces.ts'

export const REVOKE_EXPOSED_TOKENS = '002_revoke_exposed_auth_tokens'

const tokenFilter = { type: { $in: ['reset', 'verify'] } }
const legacyFilter = {
  $or: [{ resetTokenHash: { $type: 'string' } }, { resetTokenExpires: { $type: 'date' } }],
}

/** Delete every reset and verification token issued while responses revealed them. */
export async function upRevokeExposedTokens(dryRun: boolean): Promise<MigrationCounts> {
  const tokens = await AuthToken.countDocuments(tokenFilter)
  const accounts = await User.countDocuments(legacyFilter)
  if (!dryRun) {
    await AuthToken.deleteMany(tokenFilter)
    await User.updateMany(legacyFilter, { $unset: { resetTokenHash: 1, resetTokenExpires: 1 } })
  }
  return { tokens, accounts }
}

export async function downRevokeExposedTokens(_dryRun: boolean): Promise<MigrationCounts> {
  return { tokens: 0, accounts: 0 }
}
