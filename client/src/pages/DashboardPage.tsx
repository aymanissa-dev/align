import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/auth-context.ts'
import { api } from '../api/index.ts'
import type { OpenTask } from '../api/types.ts'
import { CheckButton, ErrorState, ListSkeleton, ProgressBar } from '../components/ui.tsx'
import { useToast } from '../components/toast-context.ts'
import { useToggleTask } from '../hooks/useToggleTask.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { firstName, formatDate, greeting } from '../lib/format.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function DashboardPage() {
  const { user } = useAuth()
  const toast = useToast()
  const toggle = useToggleTask()
  useDocumentTitle('Dashboard')

  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.getDashboard(),
  })

  if (!user) return null
  if (dashboard.isLoading) return <ListSkeleton />
  if (dashboard.isError || !dashboard.data) {
    return <ErrorState onRetry={() => void dashboard.refetch()} />
  }

  const { projects, openTasks } = dashboard.data
  const empty = projects.length === 0 && openTasks.length === 0

  function onToggle(task: OpenTask) {
    toggle.mutate(
      { id: task.id, projectId: task.projectId, completed: task.completed },
      { onError: (error) => toast(errorMessage(error)) },
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-medium tracking-tight text-neutral-950">
        {greeting()}, {firstName(user.name)}
      </h1>
      <p className="mt-2 text-sm text-neutral-500">Active projects and open tasks.</p>

      {empty ? (
        <div className="mt-10">
          <EmptyWorkspace />
        </div>
      ) : (
        <>
          <section className="mt-12">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-sm font-medium text-neutral-950">Active projects</h2>
              <Link to="/projects" className="focus-ring rounded-sm text-sm text-neutral-500 hover:text-neutral-900">
                All projects
              </Link>
            </div>
            {projects.length === 0 ? (
              <p className="mt-4 text-sm text-neutral-500">No active projects.</p>
            ) : (
              <ul className="mt-2">
                {projects.map((project) => (
                  <li key={project.id}>
                    <Link
                      to={`/projects/${project.id}`}
                      className="focus-ring -mx-3 block rounded-md px-3 py-4 hover:bg-neutral-50"
                    >
                      <div className="flex items-baseline justify-between gap-4">
                        <h3 className="font-medium text-neutral-950">{project.name}</h3>
                        <span className="text-sm text-neutral-400 tabular-nums">{project.percentComplete}%</span>
                      </div>
                      {project.description ? (
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-neutral-500">{project.description}</p>
                      ) : null}
                      <div className="mt-3">
                        <ProgressBar value={project.percentComplete} label={`${project.name} progress`} />
                      </div>
                      <p className="mt-2 text-xs text-neutral-400">
                        {project.taskCount === 0
                          ? 'No tasks yet'
                          : `${project.completedCount} of ${project.taskCount} tasks`}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-12">
            <h2 className="text-sm font-medium text-neutral-950">Outstanding</h2>
            {openTasks.length === 0 ? (
              <p className="mt-4 text-sm text-neutral-500">Nothing outstanding.</p>
            ) : (
              <ul className="mt-2 divide-y divide-neutral-200 border-y border-neutral-200">
                {openTasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-3 py-3">
                    <CheckButton
                      checked={task.completed}
                      label={`Mark “${task.title}” complete`}
                      onChange={() => onToggle(task)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-neutral-950">{task.title}</p>
                      <Link
                        to={`/projects/${task.projectId}`}
                        className="focus-ring rounded-sm text-sm text-neutral-500 hover:text-neutral-900"
                      >
                        {task.projectName}
                      </Link>
                    </div>
                    {task.dueDate ? (
                      <span className="shrink-0 text-sm text-neutral-400">{formatDate(task.dueDate)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function EmptyWorkspace() {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 px-6 py-14 text-center">
      <h2 className="text-base font-medium text-neutral-950">Nothing in motion</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-neutral-500">
        Create a project, then add the tasks you actually intend to finish.
      </p>
      <Link
        to="/projects"
        className="focus-ring mt-5 inline-flex items-center justify-center rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
      >
        Go to projects
      </Link>
    </div>
  )
}
