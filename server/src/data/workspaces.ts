import { Types } from 'mongoose'
import { HttpError } from '../errors.ts'
import { Membership, User, Workspace } from '../models.ts'
import { isRole, type Role } from '../authz.ts'
import type { Tenant } from './tenant.ts'
import { withTransaction } from './txn.ts'

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

export async function resolveTenant(userId: string, requested: string | undefined): Promise<Tenant> {
  if (requested && Types.ObjectId.isValid(requested)) {
    const member = await Membership.findOne({ userId, workspaceId: requested })
    if (!member) throw new HttpError(403, 'You are not a member of that workspace.')
    const workspace = await Workspace.findById(member.workspaceId).select('_id')
    if (!workspace) throw new HttpError(403, 'You are not a member of that workspace.')
    return { userId, workspaceId: workspace.id, role: member.role as Role }
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
  const user = await User.findOne({ email })
  if (!user) throw new HttpError(404, 'No account uses that email.')
  const existing = await Membership.findOne({ workspaceId: actor.workspaceId, userId: user._id })
  if (existing) throw new HttpError(409, 'That person is already in this workspace.')
  await Membership.create({ workspaceId: actor.workspaceId, userId: user._id, role })
  return { userId: user.id, email: user.email, name: user.name, role }
}

export async function changeMemberRole(actor: Tenant, memberId: string, role: Role) {
  if (role === 'owner') throw new HttpError(400, 'Choose admin, member, or viewer.')
  const member = await Membership.findOne({ workspaceId: actor.workspaceId, userId: memberId })
  if (!member) throw new HttpError(404, 'Member not found.')
  if (member.role === 'owner') throw new HttpError(403, 'The owner role cannot be changed here.')
  member.role = role
  await member.save()
  return { userId: member.userId.toString(), role }
}

export async function removeMember(actor: Tenant, memberId: string) {
  const member = await Membership.findOne({ workspaceId: actor.workspaceId, userId: memberId })
  if (!member) throw new HttpError(404, 'Member not found.')
  if (member.role === 'owner') throw new HttpError(403, 'The owner cannot be removed.')
  await member.deleteOne()
}
