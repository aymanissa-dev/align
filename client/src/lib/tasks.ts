import type { Task } from '../api/types.ts'

export function compareTasks(a: Task, b: Task): number {
  if (a.completed !== b.completed) return a.completed ? 1 : -1
  if (a.order !== b.order) return a.order - b.order
  return a.createdAt.localeCompare(b.createdAt)
}

export function taskProgress(tasks: Task[]): {
  completed: number
  total: number
  percent: number
} {
  const total = tasks.length
  const completed = tasks.filter((task) => task.completed).length
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)
  return { completed, total, percent }
}
