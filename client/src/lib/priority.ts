import type { Task, TaskPriority } from '../api/types.ts'

export const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function priorityRank(priority: TaskPriority): number {
  return RANK[priority]
}

export type TaskSort = 'manual' | 'due' | 'priority'

export function sortTasks(tasks: Task[], mode: TaskSort): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1
    if (mode === 'priority') {
      const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
      if (byPriority !== 0) return byPriority
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
      if (a.dueDate && !b.dueDate) return -1
      if (!a.dueDate && b.dueDate) return 1
    }
    if (mode === 'due') {
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
      if (a.dueDate && !b.dueDate) return -1
      if (!a.dueDate && b.dueDate) return 1
      const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
      if (byPriority !== 0) return byPriority
    }
    if (a.order !== b.order) return a.order - b.order
    return a.createdAt.localeCompare(b.createdAt)
  })
}

export const LABEL_COLORS = ['#171717', '#b91c1c', '#b45309', '#047857', '#1d4ed8', '#6d28d9', '#be185d'] as const
