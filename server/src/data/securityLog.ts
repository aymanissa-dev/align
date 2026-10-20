import { SecurityEvent } from '../models.ts'

export async function recordSecurity(input: {
  userId: string
  type: string
  summary: string
  ipCoarse?: string
}): Promise<void> {
  await SecurityEvent.create({
    userId: input.userId,
    type: input.type,
    summary: input.summary.slice(0, 240),
    ipCoarse: input.ipCoarse ?? '',
    read: false,
  })
}
