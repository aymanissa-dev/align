import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/index.ts'
import { ApiError } from '../api/errors.ts'
import type { DashboardData, OpenTask, Task, TodayData, TodayTask } from '../api/types.ts'
import { localISODate } from '../lib/due.ts'

type ToggleTarget = {
  id: string
  projectId: string
  completed: boolean
}

function byDue(a: OpenTask, b: OpenTask): number {
  if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
  if (a.dueDate) return -1
  if (b.dueDate) return 1
  return a.title.localeCompare(b.title)
}

function patchToday(data: TodayData, target: ToggleTarget): TodayData {
  const nextCompleted = !target.completed
  const stamp = nextCompleted ? data.date : null
  const apply = (task: TodayTask): TodayTask =>
    task.id === target.id ? { ...task, completed: nextCompleted, completedOn: stamp } : task
  return {
    ...data,
    planned: data.planned.map(apply),
    carried: data.carried.map(apply),
    overdue: (data.overdue ?? []).map(apply),
    available: data.available.map(apply),
    finished: (data.finished ?? []).map(apply),
  }
}

export function useToggleTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (target: ToggleTarget) =>
      api.updateTask(target.id, {
        completed: !target.completed,
        completedOn: target.completed ? null : localISODate(),
      }),
    onMutate: async (target) => {
      await queryClient.cancelQueries({ queryKey: ['tasks', target.projectId] })
      await queryClient.cancelQueries({ queryKey: ['dashboard'] })
      await queryClient.cancelQueries({ queryKey: ['today'] })

      const previousTasks = queryClient.getQueryData<Task[]>(['tasks', target.projectId])
      const previousDashboard = queryClient.getQueryData<DashboardData>(['dashboard'])
      const previousToday = queryClient.getQueriesData<TodayData>({ queryKey: ['today'] })
      const nextCompleted = !target.completed

      if (previousTasks) {
        queryClient.setQueryData<Task[]>(
          ['tasks', target.projectId],
          previousTasks.map((task) =>
            task.id === target.id
              ? { ...task, completed: nextCompleted, completedOn: nextCompleted ? localISODate() : null }
              : task,
          ),
        )
      }

      if (previousDashboard) {
        const projects = previousDashboard.projects.map((project) => {
          if (project.id !== target.projectId) return project
          const completedCount = Math.min(
            project.taskCount,
            Math.max(0, project.completedCount + (nextCompleted ? 1 : -1)),
          )
          return {
            ...project,
            completedCount,
            percentComplete: project.taskCount === 0 ? 0 : Math.round((completedCount / project.taskCount) * 100),
          }
        })

        let openTasks = previousDashboard.openTasks
        if (nextCompleted) {
          openTasks = openTasks.filter((task) => task.id !== target.id)
        } else {
          const task = previousTasks?.find((item) => item.id === target.id)
          const project = previousDashboard.projects.find((item) => item.id === target.projectId)
          if (task && project && !openTasks.some((item) => item.id === task.id)) {
            openTasks = [
              ...openTasks,
              {
                id: task.id,
                projectId: task.projectId,
                projectName: project.name,
                title: task.title,
                dueDate: task.dueDate,
                priority: task.priority,
                completed: false,
              },
            ].sort(byDue)
          }
        }

        queryClient.setQueryData<DashboardData>(['dashboard'], {
          ...previousDashboard,
          projects,
          openTasks,
          openTaskCount: Math.max(
            0,
            (previousDashboard.openTaskCount ?? previousDashboard.openTasks.length) + (nextCompleted ? -1 : 1),
          ),
        })
      }

      for (const [key, data] of previousToday) {
        if (data) queryClient.setQueryData(key, patchToday(data, target))
      }

      return { previousTasks, previousDashboard, previousToday }
    },
    onError: (error, target, context) => {
      if (error instanceof ApiError && error.queued) return
      if (context?.previousTasks) queryClient.setQueryData(['tasks', target.projectId], context.previousTasks)
      if (context?.previousDashboard) queryClient.setQueryData(['dashboard'], context.previousDashboard)
      for (const [key, data] of context?.previousToday ?? []) queryClient.setQueryData(key, data)
    },
    onSettled: (_data, _error, target) => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', target.projectId] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['today'] })
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      void queryClient.invalidateQueries({ queryKey: ['activity'] })
    },
  })
}
