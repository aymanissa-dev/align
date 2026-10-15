import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/auth-context.ts'
import { api } from '../api/index.ts'
import type { OpenTask } from '../api/types.ts'
import { Badge, DueBadge, PageHeader, PriorityBadge, Stat } from '../components/chrome.tsx'
import { CheckButton, EmptyState, ErrorState, ListSkeleton, ProgressBar } from '../components/ui.tsx'
import { buttonClass } from '../lib/buttonClass.ts'
import { useToast } from '../components/toast-context.ts'
import { useToggleTask } from '../hooks/useToggleTask.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { isUpcoming } from '../lib/due.ts'
import { firstName, greeting } from '../lib/format.ts'
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

  const completed = projects.reduce((sum, project) => sum + project.completedCount, 0)
  const upcoming = openTasks.filter((task) => isUpcoming(task.dueDate))

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title={`${greeting()}, ${firstName(user.name)}`}
        description="Active projects and open tasks."
        action={
          <Link to="/projects" className={buttonClass('primary')}>
            Projects
          </Link>
        }
      />

      <div className="mt-6 grid divide-y divide-neutral-200 border border-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat label="Active projects" value={projects.length} />
        <Stat label="Open tasks" value={openTasks.length} />
        <Stat label="Tasks done" value={completed} />
      </div>

      {empty ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing in motion"
            body="Create a project, then add the tasks you actually intend to finish."
            action={
              <Link to="/projects" className={buttonClass('primary')}>
                Go to projects
              </Link>
            }
          />
        </div>
      ) : (
        <>
        <section className="mt-8 border border-neutral-200">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
            <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Upcoming</h2>
            <Badge>{upcoming.length}</Badge>
          </div>
          {upcoming.length === 0 ? (
            <p className="px-4 py-6 text-sm text-neutral-500">Nothing overdue or due in the next week.</p>
          ) : (
            <ul>
              {upcoming.map((task) => (
                <li key={task.id} className="flex items-start gap-3 border-b border-neutral-200 px-4 py-3 last:border-b-0">
                  <CheckButton
                    checked={task.completed}
                    label={`Mark “${task.title}” complete`}
                    onChange={() => onToggle(task)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm text-neutral-950">{task.title}</p>
                      <PriorityBadge priority={task.priority} />
                    </div>
                    <Link to={`/projects/${task.projectId}`} className="focus-ring text-sm text-neutral-500 hover:text-neutral-950">
                      {task.projectName}
                    </Link>
                  </div>
                  <DueBadge dueDate={task.dueDate} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <section className="border border-neutral-200">
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
              <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Active projects</h2>
              <Link to="/projects" className="focus-ring text-sm text-neutral-500 hover:text-neutral-950">
                All projects
              </Link>
            </div>
            {projects.length === 0 ? (
              <p className="px-4 py-6 text-sm text-neutral-500">No active projects.</p>
            ) : (
              <ul>
                {projects.map((project) => (
                  <li key={project.id} className="border-b border-neutral-200 last:border-b-0">
                    <Link to={`/projects/${project.id}`} className="focus-ring block px-4 py-4 hover:bg-neutral-50">
                      <div className="flex items-baseline justify-between gap-4">
                        <h3 className="font-medium text-neutral-950">{project.name}</h3>
                        <span className="font-mono text-xs text-neutral-500 tabular-nums">{project.percentComplete}%</span>
                      </div>
                      {project.description ? (
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-neutral-600">{project.description}</p>
                      ) : null}
                      <div className="mt-3">
                        <ProgressBar value={project.percentComplete} label={`${project.name} progress`} />
                      </div>
                      <p className="mt-2 text-xs text-neutral-500">
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

          <section className="border border-neutral-200">
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
              <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Open tasks</h2>
              <Badge>{openTasks.length}</Badge>
            </div>
            {openTasks.length === 0 ? (
              <p className="px-4 py-6 text-sm text-neutral-500">Nothing outstanding.</p>
            ) : (
              <ul>
                {openTasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-3 border-b border-neutral-200 px-4 py-3 last:border-b-0">
                    <CheckButton
                      checked={task.completed}
                      label={`Mark “${task.title}” complete`}
                      onChange={() => onToggle(task)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-neutral-950">{task.title}</p>
                      <Link to={`/projects/${task.projectId}`} className="focus-ring text-sm text-neutral-500 hover:text-neutral-950">
                        {task.projectName}
                      </Link>
                    </div>
                    <DueBadge dueDate={task.dueDate} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        </>
      )}
    </div>
  )
}
