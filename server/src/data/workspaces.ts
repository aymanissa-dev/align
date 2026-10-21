import { Types } from 'mongoose'
import { HttpError } from '../errors.ts'
import { Invite, Membership, User, Workspace } from '../models.ts'
import { isRole, type Role } from '../authz.ts'
import type { Tenant } from './tenant.ts'
import { withTransaction } from './txn.ts'

export type AccessClaims = {
  workspaceId: string
  role: Role
  membershipVersion: number
}

const CACHE_MS = 60_000
const cache = new Map<string, { tenant: Tenant; expires: number }>()

function cacheKey(userId: string, workspaceId: string, version: number): string {
  return `${userId}:${workspaceId}:${version}`
}

export function ownerClaims(user: {
  personalWorkspaceId?: { toString(): string } | null
  membershipVersion?: number | null
}): AccessClaims | null {
  if (!user.personalWorkspaceId) return null
  return {
    workspaceId: user.personalWorkspaceId.toString(),
    role: 'owner',
    membershipVersion: user.membershipVersion ?? 0,
  }
}

function cachedTenant(userId: string, workspaceId: string, version: number): Tenant | null {
  const hit = cache.get(cacheKey(userId, workspaceId, version))
  if (!hit) return null
  if (hit.expires <= Date.now()) {
    cache.delete(cacheKey(userId, workspaceId, version))
    return null
  }
  return hit.tenant
}

function rememberTenant(userId: string, version: number, tenant: Tenant): void {
  cache.set(cacheKey(userId, tenant.workspaceId, version), { tenant, expires: Date.now() + CACHE_MS })
  if (cache.size <= 500) return
  const oldest = cache.keys().next().value
  if (oldest) cache.delete(oldest)
}

function dropTenantCache(userId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key)
  }
}

async function bumpMembership(userId: string, workspaceId: string): Promise<void> {
  dropTenantCache(userId)
  await Promise.all([
    User.updateOne({ _id: userId }, { $inc: { membershipVersion: 1 } }),
    Workspace.updateOne({ _id: workspaceId }, { $inc: { membershipVersion: 1 } }),
  ])
}

export function personalWorkspaceName(name: string): string {
  const trimmed = name.trim() || 'Personal'
  return `${trimmed}'s workspace`.slice(0, 80)
}

export async function ensurePersonalWorkspace(userId: string): Promise<Tenant> {
  const user = await User.findById(userId)
  if (!user) throw new HttpError(401, 'Sign in to continue.')
  if (user.personalWorkspaceId) {
    const member = await Membership.findOne({ userId: user._id, workspaceId: user.personalWorkspaceId })
    if (member) {
      return { userId: user.id, workspaceId: member.workspaceId.toString(), role: member.role as Role }
    }
  }
  const existing = await Workspace.findOne({ ownerId: user._id, personal: true })
  if (existing) {
    const member = await Membership.findOneAndUpdate(
      { workspaceId: existing._id, userId: user._id },
      { $setOnInsert: { role: 'owner' } },
      { upsert: true, new: true },
    )
    if (!user.personalWorkspaceId?.equals(existing._id)) {
      user.personalWorkspaceId = existing._id
      await user.save()
    }
    return { userId: user.id, workspaceId: existing.id, role: (member?.role ?? 'owner') as Role }
  }
  return withTransaction(async (session) => {
    const created = await Workspace.create(
      [{ name: personalWorkspaceName(user.name), personal: true, ownerId: user._id }],
      { session },
    )
    const workspace = created[0]
    if (!workspace) throw new HttpError(500, 'Could not create a workspace.')
    await Membership.create([{ workspaceId: workspace._id, userId: user._id, role: 'owner' }], { session })
    user.personalWorkspaceId = workspace._id
    await user.save({ session })
    return { userId: user.id, workspaceId: workspace.id, role: 'owner' as const }
  })
}

export async function resolveTenant(userId: string, requested: string | undefined, version = 0): Promise<Tenant> {
  if (requested && Types.ObjectId.isValid(requested)) {
    const hit = cachedTenant(userId, requested, version)
    if (hit) return hit
    const member = await Membership.findOne({ userId, workspaceId: requested }).select('workspaceId role')
    if (!member) throw new HttpError(403, 'You are not a member of that workspace.')
    const tenant: Tenant = { userId, workspaceId: member.workspaceId.toString(), role: member.role as Role }
    rememberTenant(userId, version, tenant)
    return tenant
  }
  return ensurePersonalWorkspace(userId)
}

export async function listWorkspaces(userId: string) {
  const memberships = await Membership.find({ userId }).lean()
  const ids = memberships.map((member) => member.workspaceId)
  const workspaces = await Workspace.find({ _id: { $in: ids } }).lean()
  const byId = new Map(workspaces.map((workspace) => [workspace._id.toString(), workspace]))
  return memberships.flatMap((member) => {
    const workspace = byId.get(member.workspaceId.toString())
    if (!workspace) return []
    return [
      {
        id: workspace._id.toString(),
        name: workspace.name,
        personal: workspace.personal,
        role: member.role as Role,
      },
    ]
  })
}

export async function createSharedWorkspace(userId: string, name: string) {
  return withTransaction(async (session) => {
    const created = await Workspace.create([{ name, personal: false, ownerId: userId }], { session })
    const workspace = created[0]
    if (!workspace) throw new HttpError(500, 'Could not create a workspace.')
    await Membership.create([{ workspaceId: workspace._id, userId, role: 'owner' }], { session })
    return { id: workspace.id, name: workspace.name, personal: false, role: 'owner' as const }
  })
}

export async function addMember(actor: Tenant, email: string, role: Role) {
  if (!isRole(role) || role === 'owner') throw new HttpError(400, 'Choose admin, member, or viewer.')
  const normalized = email.trim().toLowerCase()
  const user = await User.findOne({ email: normalized })
  if (!user) {
    await Invite.findOneAndUpdate(
      { workspaceId: actor.workspaceId, email: normalized },
      { $set: { role }, $setOnInsert: { workspaceId: actor.workspaceId, email: normalized } },
      { upsert: true },
    )
    return { email: normalized, role }
  }
  const existing = await Membership.findOne({ workspaceId: actor.workspaceId, userId: user._id })
  if (!existing) await Membership.create({ workspaceId: actor.workspaceId, userId: user._id, role })
  return { email: user.email, role: existing?.role ?? role }
}

/** Turn pending invites into memberships once the address has an account. */
export async function claimInvites(userId: string, email: string): Promise<void> {
  const invites = await Invite.find({ email: email.trim().toLowerCase() })
  for (const invite of invites) {
    const existing = await Membership.findOne({ workspaceId: invite.workspaceId, userId })
    if (!existing) await Membership.create({ workspaceId: invite.workspaceId, userId, role: invite.role })
    await invite.deleteOne()
  }
}

export async function changeMemberRole(actor: Tenant, memberId: string, role: Role) {
  if (role === 'owner') throw new HttpError(400, 'Choose admin, member, or viewer.')
  const member = await Membership.findOne({ workspaceId: actor.workspaceId, userId: memberId })
  if (!member) throw new HttpError(404, 'Member not found.')
  if (member.role === 'owner') throw new HttpError(403, 'The owner role cannot be changed here.')
  member.role = role
  await member.save()
  await bumpMembership(member.userId.toString(), actor.workspaceId)
  return { userId: member.userId.toString(), role }
}

export async function removeMember(actor: Tenant, memberId: string) {
  const member = await Membership.findOne({ workspaceId: actor.workspaceId, userId: memberId })
  if (!member) throw new HttpError(404, 'Member not found.')
  if (member.role === 'owner') throw new HttpError(403, 'The owner cannot be removed.')
  await member.deleteOne()
  await bumpMembership(member.userId.toString(), actor.workspaceId)
}
