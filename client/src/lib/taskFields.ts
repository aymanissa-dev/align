import type { Recurrence, Subtask, Task, TaskStatus } from '../api/types.ts'

export function freshTaskFields(status: TaskStatus = 'todo'): Pick<Task, 'subtasks' | 'recurrence' | 'status'> {
  return { subtasks: [], recurrence: null, status }
}

export function subtasksOf(task: { subtasks?: Subtask[] | null }): Subtask[] {
  return Array.isArray(task.subtasks) ? task.subtasks : []
}

export function recurrenceOf(task: { recurrence?: Recurrence | null }): Recurrence | null {
  if (task.recurrence === 'daily' || task.recurrence === 'weekly' || task.recurrence === 'monthly') return task.recurrence
  return null
}

/** Completed tasks are Done. A missing status follows that, otherwise Todo. */
export function statusOf(task: { status?: string | null; completed?: boolean }): TaskStatus {
  if (task.completed || task.status === 'done') return 'done'
  if (task.status === 'doing') return 'doing'
  return 'todo'
}

export function checklistLabel(subtasks: { completed: boolean }[]): string | null {
  if (subtasks.length === 0) return null
  const done = subtasks.filter((item) => item.completed).length
  return `${done}/${subtasks.length}`
}

export function recurrenceLabel(recurrence: Recurrence | null): string | null {
  if (recurrence === 'daily') return 'Daily'
  if (recurrence === 'weekly') return 'Weekly'
  if (recurrence === 'monthly') return 'Monthly'
  return null
}
