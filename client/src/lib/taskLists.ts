import type { QueryClient } from '@tanstack/react-query'
import type { DashboardData, OpenTask, Task } from '../api/types.ts'

function byDue(a: OpenTask, b: OpenTask): number {
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
  if (a.dueDate) return -1
  if (b.dueDate) return 1
  return a.title.localeCompare(b.title)
}

export function readSpawned(task: Task): Task | null {
  const extra = task as Task & { spawned?: unknown }
  const spawned = extra.spawned
  if (!spawned || typeof spawned !== 'object') return null
  const row = spawned as Partial<Task>
  if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.projectId !== 'string') return null
  return spawned as Task
}

/** Show the next occurrence immediately, then let the refetch reconcile the lists. */
export function insertSpawned(queryClient: QueryClient, projectId: string, spawned: Task): void {
  queryClient.setQueryData<Task[]>(['tasks', projectId], (current) => {
    if (!current) return current
    if (current.some((item) => item.id === spawned.id)) return current
    return [...current, spawned].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
  })
  queryClient.setQueryData<DashboardData>(['dashboard'], (current) => {
    if (!current || spawned.completed) return current
    if (current.openTasks.some((item) => item.id === spawned.id)) return current
    const projectName =
      current.projects.find((project) => project.id === spawned.projectId)?.name ??
      current.openTasks.find((item) => item.projectId === spawned.projectId)?.projectName ??
      ''
    const openTasks = [
      ...current.openTasks,
      {
        id: spawned.id,
        projectId: spawned.projectId,
        projectName,
        title: spawned.title,
        dueDate: spawned.dueDate,
        priority: spawned.priority,
        completed: false as const,
        recurrence: spawned.recurrence ?? null,
      },
    ].sort(byDue)
    return {
      ...current,
      openTasks,
      openTaskCount: current.openTaskCount + 1,
      datedOpenCount: current.datedOpenCount + (spawned.dueDate ? 1 : 0),
      projects: current.projects.map((project) => {
        if (project.id !== projectId) return project
        const taskCount = project.taskCount + 1
        return {
          ...project,
          taskCount,
          percentComplete: taskCount === 0 ? 0 : Math.round((project.completedCount / taskCount) * 100),
        }
      }),
    }
  })
}

export function refreshTaskLists(queryClient: QueryClient, projectId: string): Promise<void> {
  return Promise.all([
    queryClient.refetchQueries({ queryKey: ['tasks', projectId] }),
    queryClient.refetchQueries({ queryKey: ['dashboard'] }),
    queryClient.refetchQueries({ queryKey: ['today'] }),
    queryClient.refetchQueries({ queryKey: ['calendar'] }),
  ]).then(() => undefined)
}
