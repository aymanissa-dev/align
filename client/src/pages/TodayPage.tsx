import { useMutation, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/index.ts'
import type { TodayTask } from '../api/types.ts'
import { useToast } from '../components/toast-context.ts'
import { DueBadge, PageHeader, PriorityBadge } from '../components/chrome.tsx'
import { CheckButton, EmptyState, ErrorState, ListSkeleton } from '../components/ui.tsx'
import { buttonClass } from '../lib/buttonClass.ts'
import { localISODate } from '../lib/due.ts'
import { isEvening } from '../lib/format.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { useToggleTask } from '../hooks/useToggleTask.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'
import { cn } from '../lib/cn.ts'

export function TodayPage() {
  const toast = useToast()
  const toggle = useToggleTask()
  const date = localISODate()
  const evening = isEvening()
  useDocumentTitle('Today')

  const today = useQuery({
    queryKey: ['today', date],
    queryFn: () => api.getToday(date),
  })

  const plan = useMutation({
    mutationFn: (input: { id: string; plannedFor: string | null }) =>
      api.updateTask(input.id, { plannedFor: input.plannedFor }),
    onSuccess: () => today.refetch(),
    onError: (error) => toast(errorMessage(error)),
  })

  if (today.isLoading) return <ListSkeleton />
  if (today.isError || !today.data) return <ErrorState onRetry={() => void today.refetch()} />

  const { planned, carried, available } = today.data
  const done = planned.filter((task) => task.completed)
  const open = planned.filter((task) => !task.completed)
  const empty = planned.length === 0 && carried.length === 0 && available.length === 0

  function onToggle(task: TodayTask) {
    toggle.mutate(
      { id: task.id, projectId: task.projectId, completed: task.completed },
      { onError: (error) => toast(errorMessage(error)) },
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow={evening ? 'Evening' : 'Morning'}
        title="Today"
        description={
          evening
            ? 'What got done, and what carries into tomorrow.'
            : 'Pick the tasks you intend to finish today.'
        }
      />

      {empty ? (
        <div className="mt-6">
          <EmptyState
            title="No open tasks"
            body="Add a task to a project, then choose it for today."
            action={
              <Link to="/projects" className={buttonClass('primary')}>
                Go to projects
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <section className="border border-neutral-200">
            <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
              <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">
                {evening ? 'Done' : 'On today’s list'}
              </h2>
              <span className="font-mono text-xs text-neutral-500">{evening ? done.length : planned.length}</span>
            </header>
            <TaskList
              tasks={evening ? done : planned}
              empty={evening ? 'Nothing finished yet.' : 'Nothing chosen yet.'}
              onToggle={onToggle}
              action={
                evening
                  ? undefined
                  : (task) => (
                      <button
                        type="button"
                        className="focus-ring text-xs text-neutral-500 hover:text-neutral-950"
                        onClick={() => plan.mutate({ id: task.id, plannedFor: null })}
                      >
                        Remove
                      </button>
                    )
              }
            />
            {evening ? (
              <>
                <h3 className="border-t border-neutral-200 px-4 py-3 font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">
                  Still open
                </h3>
                <TaskList tasks={open} empty="Everything on today’s list is done." onToggle={onToggle} />
              </>
            ) : null}
          </section>

          <div className="space-y-8">
            <section className="border border-neutral-200">
              <header className="border-b border-neutral-200 px-4 py-3">
                <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Carried over</h2>
              </header>
              <TaskList
                tasks={carried}
                empty="Nothing left from earlier days."
                onToggle={onToggle}
                action={(task) => (
                  <button
                    type="button"
                    className="focus-ring text-xs text-neutral-500 hover:text-neutral-950"
                    onClick={() => plan.mutate({ id: task.id, plannedFor: date })}
                  >
                    Keep today
                  </button>
                )}
              />
            </section>

            <section className="border border-neutral-200">
              <header className="border-b border-neutral-200 px-4 py-3">
                <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">
                  {evening ? 'Add for tomorrow' : 'Choose for today'}
                </h2>
              </header>
              <TaskList
                tasks={available}
                empty="No other open tasks."
                onToggle={onToggle}
                action={(task) => (
                  <button
                    type="button"
                    className={cn(buttonClass('secondary'), 'px-2 py-1 text-xs')}
                    onClick={() => plan.mutate({ id: task.id, plannedFor: date })}
                  >
                    Add
                  </button>
                )}
              />
            </section>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskList({
  tasks,
  empty,
  onToggle,
  action,
}: {
  tasks: TodayTask[]
  empty: string
  onToggle: (task: TodayTask) => void
  action?: (task: TodayTask) => ReactNode
}) {
  if (tasks.length === 0) return <p className="px-4 py-6 text-sm text-neutral-500">{empty}</p>
  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.id} className="flex items-start gap-3 border-b border-neutral-200 px-4 py-3 last:border-b-0">
          <CheckButton
            checked={task.completed}
            label={task.completed ? `Mark “${task.title}” incomplete` : `Mark “${task.title}” complete`}
            onChange={() => onToggle(task)}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn('text-sm', task.completed ? 'text-neutral-400 line-through' : 'text-neutral-950')}>{task.title}</p>
              <PriorityBadge priority={task.priority} />
            </div>
            <Link to={`/projects/${task.projectId}`} className="focus-ring text-sm text-neutral-500 hover:text-neutral-950">
              {task.projectName}
            </Link>
          </div>
          <DueBadge dueDate={task.dueDate} />
          {action ? <div className="shrink-0">{action(task)}</div> : null}
        </li>
      ))}
    </ul>
  )
}
