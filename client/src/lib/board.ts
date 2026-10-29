import type { Task, TaskPatch, TaskStatus } from '../api/types.ts'
import { localISODate } from './due.ts'
import { statusOf } from './taskFields.ts'

function byOrder(a: Task, b: Task): number {
  if (a.order !== b.order) return a.order - b.order
  return a.createdAt.localeCompare(b.createdAt)
}

function orderBetween(prev: number | null, next: number | null, fallback: number): number {
  if (prev == null && next == null) return fallback
  if (prev == null) return (next as number) - 1
  if (next == null) return prev + 1
  if (next - prev > 1e-6) return (prev + next) / 2
  return prev + 1
}

/** Where to put `taskId` inside a column. Returns null when nothing changes. */
export function boardMove(tasks: Task[], taskId: string, status: TaskStatus, index: number): { id: string; patch: TaskPatch } | null {
  const moving = tasks.find((task) => task.id === taskId)
  if (!moving) return null
  const column = tasks.filter((task) => task.id !== taskId && statusOf(task) === status).sort(byOrder)
  const clamped = Math.max(0, Math.min(index, column.length))
  const currentColumn = tasks.filter((task) => statusOf(task) === status).sort(byOrder)
  const currentIndex = currentColumn.findIndex((task) => task.id === taskId)
  if (statusOf(moving) === status && currentIndex === clamped) return null

  const prev = column[clamped - 1]?.order ?? null
  const next = column[clamped]?.order ?? null
  const order = orderBetween(prev, next, moving.order)
  const completed = status === 'done'
  const patch: TaskPatch = {}
  if (statusOf(moving) !== status) patch.status = status
  if (moving.completed !== completed) {
    patch.completed = completed
    patch.completedOn = completed ? localISODate() : null
  }
  if (order !== moving.order) patch.order = order
  if (Object.keys(patch).length === 0) return null
  return { id: taskId, patch }
}
