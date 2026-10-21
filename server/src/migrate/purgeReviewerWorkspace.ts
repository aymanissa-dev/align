import { Types } from 'mongoose'
import {
  Activity,
  Invite,
  Label,
  Membership,
  Note,
  Notification,
  Project,
  Task,
  Whiteboard,
  Workspace,
} from '../models.ts'
import type { MigrationCounts } from './personalWorkspaces.ts'

export const PURGE_REVIEWER_WORKSPACE = '003_purge_reviewer_workspace'

const WORKSPACE_ID = '6ad897539bb929a182fb6e47'
const PROJECT_ID = '6ad897539bb929a182fb6e54'

/**
 * Remove the security reviewer's leftover shared workspace and project.
 * Nothing else is selected: the ids are exact.
 */
export async function upPurgeReviewerWorkspace(dryRun: boolean): Promise<MigrationCounts> {
  const workspaceId = new Types.ObjectId(WORKSPACE_ID)
  const projectId = new Types.ObjectId(PROJECT_ID)
  const projects = await Project.find({ $or: [{ _id: projectId }, { workspaceId }] }).select('_id')
  const projectIds = projects.map((project) => project._id)
  if (!projectIds.some((id) => id.equals(projectId))) projectIds.push(projectId)
  const counts: MigrationCounts = {
    workspaces: await Workspace.countDocuments({ _id: workspaceId }),
    projects: await Project.countDocuments({ _id: { $in: projectIds } }),
    tasks: await Task.countDocuments({ $or: [{ workspaceId }, { projectId: { $in: projectIds } }] }),
    notes: await Note.countDocuments({ $or: [{ workspaceId }, { projectId: { $in: projectIds } }] }),
    whiteboards: await Whiteboard.countDocuments({ $or: [{ workspaceId }, { projectId: { $in: projectIds } }] }),
    activity: await Activity.countDocuments({ $or: [{ workspaceId }, { projectId: { $in: projectIds } }] }),
    notifications: await Notification.countDocuments({ projectId: { $in: projectIds } }),
    memberships: await Membership.countDocuments({ workspaceId }),
    invites: await Invite.countDocuments({ workspaceId }),
    labels: await Label.countDocuments({ workspaceId }),
  }
  if (!dryRun) {
    await Notification.deleteMany({ projectId: { $in: projectIds } })
    await Task.deleteMany({ $or: [{ workspaceId }, { projectId: { $in: projectIds } }] })
    await Note.deleteMany({ $or: [{ workspaceId }, { projectId: { $in: projectIds } }] })
    await Whiteboard.deleteMany({ $or: [{ workspaceId }, { projectId: { $in: projectIds } }] })
    await Activity.deleteMany({ $or: [{ workspaceId }, { projectId: { $in: projectIds } }] })
    await Label.deleteMany({ workspaceId })
    await Project.deleteMany({ _id: { $in: projectIds } })
    await Membership.deleteMany({ workspaceId })
    await Invite.deleteMany({ workspaceId })
    await Workspace.deleteMany({ _id: workspaceId })
  }
  return counts
}

export async function downPurgeReviewerWorkspace(_dryRun: boolean): Promise<MigrationCounts> {
  return { workspaces: 0, projects: 0 }
}
