import { Types } from 'mongoose'

export const PAGE_SIZE = 50

export function pageLimit(value: unknown, fallback = PAGE_SIZE): number {
  const parsed = typeof value === 'string' ? Number(value) : fallback
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(100, Math.max(1, Math.floor(parsed)))
}

export function encodeCursor(parts: string[]): string {
  return Buffer.from(parts.join('|'), 'utf8').toString('base64url')
}

export function decodeCursor(value: unknown): string[] | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const text = Buffer.from(value, 'base64url').toString('utf8')
    const parts = text.split('|')
    return parts.length > 0 && parts.every((part) => part.length > 0) ? parts : null
  } catch {
    return null
  }
}

export function objectIdFromCursor(value: string): Types.ObjectId | null {
  if (!/^[a-f\d]{24}$/i.test(value)) return null
  return new Types.ObjectId(value)
}

/** Descending createdAt + _id cursor, for activity and notifications. */
export function beforeCursor(value: unknown): { createdAt: Date; id: Types.ObjectId } | null {
  const parts = decodeCursor(value)
  if (!parts || parts.length !== 2) return null
  const createdAt = new Date(parts[0] ?? '')
  const id = objectIdFromCursor(parts[1] ?? '')
  if (Number.isNaN(createdAt.getTime()) || !id) return null
  return { createdAt, id }
}

export function beforeFilter(cursor: { createdAt: Date; id: Types.ObjectId }) {
  return {
    $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: cursor.id } }],
  }
}

export function nextDateCursor(items: Array<{ createdAt: Date; _id: Types.ObjectId }>, limit: number): string | null {
  if (items.length <= limit) return null
  const last = items[limit - 1]
  if (!last) return null
  return encodeCursor([last.createdAt.toISOString(), last._id.toString()])
}

/** Ascending order + createdAt + _id cursor, for a project's task list. */
export function afterTaskCursor(value: unknown): { order: number; createdAt: Date; id: Types.ObjectId } | null {
  const parts = decodeCursor(value)
  if (!parts || parts.length !== 3) return null
  const order = Number(parts[0])
  const createdAt = new Date(parts[1] ?? '')
  const id = objectIdFromCursor(parts[2] ?? '')
  if (!Number.isInteger(order) || Number.isNaN(createdAt.getTime()) || !id) return null
  return { order, createdAt, id }
}

export function afterTaskFilter(cursor: { order: number; createdAt: Date; id: Types.ObjectId }) {
  return {
    $or: [
      { order: { $gt: cursor.order } },
      { order: cursor.order, createdAt: { $gt: cursor.createdAt } },
      { order: cursor.order, createdAt: cursor.createdAt, _id: { $gt: cursor.id } },
    ],
  }
}

export function nextTaskCursor(
  items: Array<{ order: number; createdAt: Date; _id: Types.ObjectId }>,
  limit: number,
): string | null {
  if (items.length <= limit) return null
  const last = items[limit - 1]
  if (!last) return null
  return encodeCursor([String(last.order), last.createdAt.toISOString(), last._id.toString()])
}
