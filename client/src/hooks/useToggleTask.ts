import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/index.ts'
import type { DashboardData, OpenTask, Task } from '../api/types.ts'

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

export function useToggleTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (target: ToggleTarget) => api.updateTask(target.id, { completed: !target.completed }),
    onMutate: async (target) => {
      await queryClient.cancelQueries({ queryKey: ['tasks', target.projectId] })
      await queryClient.cancelQueries({ queryKey: ['dashboard'] })

      const previousTasks = queryClient.getQueryData<Task[]>(['tasks', target.projectId])
      const previousDashboard = queryClient.getQueryData<DashboardData>(['dashboard'])
      const nextCompleted = !target.completed

      if (previousTasks) {
        queryClient.setQueryData<Task[]>(
          ['tasks', target.projectId],
          previousTasks.map((task) => (task.id === target.id ? { ...task, completed: nextCompleted } : task)),
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
                completed: false,
              },
            ].sort(byDue)
          }
        }

        queryClient.setQueryData<DashboardData>(['dashboard'], { projects, openTasks })
      }

      return { previousTasks, previousDashboard }
    },
    onError: (_error, target, context) => {
      if (context?.previousTasks) queryClient.setQueryData(['tasks', target.projectId], context.previousTasks)
      if (context?.previousDashboard) queryClient.setQueryData(['dashboard'], context.previousDashboard)
    },
    onSettled: (_data, _error, target) => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', target.projectId] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
