import { SecurityEvent } from '../models.ts'

export async function recordSecurity(input: {
  userId: string
  type: string
  summary: string
  ipCoarse?: string
  device?: string
  deviceType?: string
  location?: string
}): Promise<void> {
  await SecurityEvent.create({
    userId: input.userId,
    type: input.type,
    summary: input.summary.slice(0, 240),
    ipCoarse: input.ipCoarse ?? '',
    device: (input.device ?? '').slice(0, 120),
    deviceType: (input.deviceType ?? '').slice(0, 16),
    location: (input.location ?? '').slice(0, 80),
    read: false,
  })
}
