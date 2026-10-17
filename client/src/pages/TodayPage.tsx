import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/index.ts'
import { ApiError } from '../api/errors.ts'
import type { TodayData, TodayTask } from '../api/types.ts'
import { useToast } from '../components/toast-context.ts'
import { DueBadge, PageHeader, PriorityBadge } from '../components/chrome.tsx'
import { Button, CheckButton, ErrorState, Field, Input, ListSkeleton, Select } from '../components/ui.tsx'
import { buttonClass } from '../lib/buttonClass.ts'
import { localISODate, shiftISODate } from '../lib/due.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { getQueueVersion, pendingTaskCreates, subscribeQueue } from '../lib/offline.ts'
import { groupToday } from '../lib/todayGroups.ts'
import { useToggleTask } from '../hooks/useToggleTask.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'
import { invalidateWorkspace } from '../queryClient.ts'
import { cn } from '../lib/cn.ts'

export function TodayPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const toggle = useToggleTask()
  const date = localISODate()
  const tomorrow = shiftISODate(date, 1)
  useDocumentTitle('Today')
  const queueVersion = useSyncExternalStore(subscribeQueue, getQueueVersion, getQueueVersion)

  const today = useQuery({
    queryKey: ['today', date],
    queryFn: ({ signal }) => api.getToday(date, { signal }),
  })
  const projects = useQuery({
    queryKey: ['projects', 'active'],
    queryFn: () => api.listProjects({ status: 'active' }),
  })

  const plan = useMutation({
    mutationFn: (input: { id: string; plannedFor: string | null; version?: number }) =>
      api.updateTask(input.id, { plannedFor: input.plannedFor }, { version: input.version }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['today', date] })
      const previous = queryClient.getQueryData<TodayData>(['today', date])
      if (previous) queryClient.setQueryData(['today', date], stampPlan(previous, input.id, input.plannedFor))
      return { previous }
    },
    onSuccess: (task) => {
      queryClient.setQueryData<TodayData>(['today', date], (current) =>
        current ? stampPlan(current, task.id, task.plannedFor) : current,
      )
    },
    onError: (error, _input, context) => {
      if (error instanceof ApiError && error.queued) return
      if (context?.previous) queryClient.setQueryData(['today', date], context.previous)
      toast(errorMessage(error))
    },
    onSettled: (_task, error) => {
      if (error instanceof ApiError && error.queued) return
      void queryClient.invalidateQueries({ queryKey: ['today', date] })
    },
  })

  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const selectedProject = projectId || projects.data?.[0]?.id || ''

  const create = useMutation({
    mutationFn: (plannedFor: string) => api.createTask(selectedProject, { title: title.trim(), plannedFor }),
    onSuccess: async (_task, plannedFor) => {
      setTitle('')
      toast(plannedFor === tomorrow ? 'Added for tomorrow' : 'Added for today')
      await invalidateWorkspace()
    },
    onError: (error) => {
      if (error instanceof ApiError && error.queued) {
        setTitle('')
        toast('Saved on this device. It will sync when you reconnect.')
        return
      }
      toast(errorMessage(error))
    },
  })

  if (!today.data) {
    if (today.isLoading) return <ListSkeleton />
    return <ErrorState onRetry={() => void today.refetch()} />
  }

  const names = new Map((projects.data ?? []).map((project) => [project.id, project.name]))
  void queueVersion
  const known = new Set(
    [...today.data.planned, ...today.data.carried, ...(today.data.overdue ?? []), ...today.data.available, ...(today.data.finished ?? [])].map(
      (task) => task.id,
    ),
  )
  const queued: TodayTask[] = pendingTaskCreates()
    .filter((task) => !known.has(task.id))
    .map((task) => ({
    id: task.id,
    projectId: task.projectId,
    projectName: names.get(task.projectId) ?? 'Queued',
    title: task.title,
    completed: false,
    dueDate: task.dueDate,
    priority: task.priority,
    labelIds: task.labelIds,
    plannedFor: task.plannedFor,
    completedOn: null,
    order: -1,
    version: 0,
    createdAt: '',
    updatedAt: '',
  }))
  const grouped = groupToday(
    {
      ...today.data,
      available: [...today.data.available, ...queued],
    },
    date,
  )

  function onToggle(task: TodayTask) {
    if (task.id.startsWith('queued:')) return
    toggle.mutate(
      { id: task.id, projectId: task.projectId, completed: task.completed, version: task.version },
      { onError: (error) => toast(errorMessage(error)) },
    )
  }

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedProject || !title.trim()) return
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    const plannedFor = submitter instanceof HTMLButtonElement && submitter.dataset.when === 'tomorrow' ? tomorrow : date
    create.mutate(plannedFor)
  }

  return (
    <div>
      <PageHeader
        eyebrow="Today"
        title="Today"
        description="Finish what’s on today’s list. Overdue work stays visible, and you can schedule the rest for tomorrow."
      />

      <form onSubmit={onCreate} className="mt-6 flex flex-col gap-3 border border-neutral-200 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:flex-1">
            <Field label="Task" htmlFor="today-task">
              <Input
                id="today-task"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Task title"
                aria-label="New task title"
              />
            </Field>
          </div>
          <div className="sm:w-56">
            <label htmlFor="today-project" className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">
              Project
            </label>
            <Select
              id="today-project"
              className="mt-1.5"
              aria-label="Project"
              value={selectedProject}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={!projects.data?.length}
            >
              {(projects.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" data-when="today" disabled={create.isPending || !title.trim() || !selectedProject} className="min-h-11">
            Add for today
          </Button>
          <Button
            type="submit"
            data-when="tomorrow"
            variant="secondary"
            disabled={create.isPending || !title.trim() || !selectedProject}
            className="min-h-11"
          >
            Add for tomorrow
          </Button>
        </div>
      </form>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="space-y-8">
          <Section title="On today’s list" count={grouped.open.length}>
            <TaskList
              tasks={grouped.open}
              empty="Nothing chosen yet."
              onToggle={onToggle}
              action={(task) =>
                task.id.startsWith('queued:') ? null : (
                  <button
                    type="button"
                    className="focus-ring inline-flex min-h-11 items-center px-2 text-xs text-neutral-800 hover:text-neutral-950"
                    onClick={() => plan.mutate({ id: task.id, plannedFor: null, version: task.version })}
                  >
                    Remove
                  </button>
                )
              }
            />
          </Section>
          <Section title="Done" count={grouped.done.length}>
            <TaskList tasks={grouped.done} empty="Nothing finished yet." onToggle={onToggle} />
          </Section>
        </div>
        <div className="space-y-8">
          <Section title="Overdue" count={grouped.overdue.length}>
            <TaskList
              tasks={grouped.overdue}
              empty="Nothing overdue."
              onToggle={onToggle}
              action={(task) => (
                <button
                  type="button"
                  className="focus-ring inline-flex min-h-11 items-center px-2 text-xs text-neutral-800 hover:text-neutral-950"
                  onClick={() => plan.mutate({ id: task.id, plannedFor: date, version: task.version })}
                >
                  Today
                </button>
              )}
            />
          </Section>
          <Section title="Carried over" count={grouped.carried.length}>
            <TaskList
              tasks={grouped.carried}
              empty="Nothing left from earlier days."
              onToggle={onToggle}
              action={(task) => (
                <button
                  type="button"
                  className="focus-ring inline-flex min-h-11 items-center px-2 text-xs text-neutral-800 hover:text-neutral-950"
                  onClick={() => plan.mutate({ id: task.id, plannedFor: date, version: task.version })}
                >
                  Keep today
                </button>
              )}
            />
          </Section>
          <Section title="Tomorrow" count={grouped.tomorrow.length}>
            <TaskList
              tasks={grouped.tomorrow}
              empty="Nothing scheduled for tomorrow."
              onToggle={onToggle}
              action={(task) =>
                task.id.startsWith('queued:') ? null : (
                  <button
                    type="button"
                    className="focus-ring inline-flex min-h-11 items-center px-2 text-xs text-neutral-800 hover:text-neutral-950"
                    onClick={() => plan.mutate({ id: task.id, plannedFor: date, version: task.version })}
                  >
                    Move to today
                  </button>
                )
              }
            />
          </Section>
          <Section title="Add for tomorrow" count={grouped.available.length}>
            <TaskList
              tasks={grouped.available}
              empty="No other open tasks."
              onToggle={onToggle}
              action={(task) =>
                task.id.startsWith('queued:') ? null : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={cn(buttonClass('secondary'), 'min-h-11 px-3 text-xs')}
                      onClick={() => plan.mutate({ id: task.id, plannedFor: date, version: task.version })}
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      className={cn(buttonClass('primary'), 'min-h-11 px-3 text-xs')}
                      aria-label={`Add “${task.title}” for tomorrow`}
                      onClick={() => plan.mutate({ id: task.id, plannedFor: tomorrow, version: task.version })}
                    >
                      Add for tomorrow
                    </button>
                  </div>
                )
              }
            />
          </Section>
        </div>
      </div>
    </div>
  )
}

function stampPlan(data: TodayData, id: string, plannedFor: string | null): TodayData {
  const apply = (task: TodayTask): TodayTask => (task.id === id ? { ...task, plannedFor } : task)
  return {
    ...data,
    planned: data.planned.map(apply),
    carried: data.carried.map(apply),
    overdue: (data.overdue ?? []).map(apply),
    available: data.available.map(apply),
    finished: (data.finished ?? []).map(apply),
  }
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="border border-neutral-200">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">{title}</h2>
        <span className="font-mono text-xs text-neutral-800 tabular-nums">{count}</span>
      </header>
      {children}
    </section>
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
  if (tasks.length === 0) return <p className="px-4 py-6 text-sm text-neutral-600">{empty}</p>
  return (
    <ul>
      {tasks.map((task) => (
        <li
          key={task.id}
          className="flex flex-col gap-2 border-b border-neutral-200 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <CheckButton
              checked={task.completed}
              label={task.completed ? `Mark “${task.title}” incomplete` : `Mark “${task.title}” complete`}
              onChange={() => onToggle(task)}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className={cn('text-sm break-words', task.completed ? 'text-neutral-400 line-through' : 'text-neutral-950')}>
                  {task.title}
                </p>
                <PriorityBadge priority={task.priority} />
                {pendingTaskCreates().some((item) => item.id === task.id) ? (
                  <span className="font-pixel text-[10px] tracking-[0.14em] text-neutral-500 uppercase">Queued</span>
                ) : null}
              </div>
              <Link to={`/projects/${task.projectId}`} className="focus-ring text-sm text-neutral-600 hover:text-neutral-950">
                {task.projectName}
              </Link>
              {task.completed ? null : (
                <div className="mt-1">
                  <DueBadge dueDate={task.dueDate} />
                </div>
              )}
            </div>
          </div>
          {action ? <div className="shrink-0 sm:pl-2">{action(task)}</div> : null}
        </li>
      ))}
    </ul>
  )
}
