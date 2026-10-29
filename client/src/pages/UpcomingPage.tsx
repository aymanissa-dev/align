import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/index.ts'
import type { OpenTask } from '../api/types.ts'
import { useAuth } from '../auth/auth-context.ts'
import { Badge, DueBadge, PageHeader, PriorityBadge, RecurrenceBadge } from '../components/chrome.tsx'
import { CheckButton, EmptyState, ErrorState, ListSkeleton, OfflineState } from '../components/ui.tsx'
import { buttonClass } from '../lib/buttonClass.ts'
import { useToast } from '../components/toast-context.ts'
import { useToggleTask } from '../hooks/useToggleTask.ts'
import { isConflict } from '../lib/conflict.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { useQueryMiss } from '../lib/queryMiss.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function UpcomingPage() {
  const { user } = useAuth()
  const toast = useToast()
  const toggle = useToggleTask()
  useDocumentTitle('All dated')

  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: ({ signal }) => api.getDashboard({ signal }),
  })
  const miss = useQueryMiss(dashboard)

  if (!user) return null
  if (!dashboard.data) {
    if (miss === 'loading') return <ListSkeleton />
    if (miss === 'offline') return <OfflineState />
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
  }

  const dated = dashboard.data.openTasks.filter((task) => task.dueDate)
  const count = dashboard.data.datedOpenCount ?? dated.length

  function onToggle(task: OpenTask) {
    toggle.mutate(
      { id: task.id, projectId: task.projectId, completed: task.completed },
      { onError: (error) => { if (!isConflict(error)) toast(errorMessage(error)) } },
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="All dated"
        description="Every open task that has a due date."
        action={
          <Link to="/" className={buttonClass('secondary')}>
            Dashboard
          </Link>
        }
      />
      <section className="mt-8 border border-neutral-200">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">All dated</h2>
          <Badge>{count}</Badge>
        </div>
        {dated.length === 0 ? (
          <EmptyState title="No dated tasks" body="Tasks with a due date show up here." />
        ) : (
          <ul>
            {dated.map((task) => (
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
                    <RecurrenceBadge recurrence={task.recurrence} />
                  </div>
                  <Link to={`/projects/${task.projectId}`} className="focus-ring text-sm text-neutral-600 hover:text-neutral-950">
                    {task.projectName}
                  </Link>
                  <div className="mt-1">
                    <DueBadge dueDate={task.dueDate} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
