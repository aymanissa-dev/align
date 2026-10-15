import type { Types } from 'mongoose'
import { Activity } from './models.ts'

export type ActivityType = 'create' | 'update' | 'delete' | 'complete'

export function quoteTitle(title: string): string {
  return `“${title.replaceAll('“', '').replaceAll('”', '')}”`
}

export async function recordActivity(input: {
  userId: string
  projectId: Types.ObjectId | string
  type: ActivityType
  summary: string
}): Promise<void> {
  await Activity.create({
    userId: input.userId,
    projectId: input.projectId,
    type: input.type,
    summary: input.summary.slice(0, 240),
  })
}
