import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/index.ts'
import type { TodayData, TodayTask } from '../api/types.ts'
import { useToast } from '../components/toast-context.ts'
import { DueBadge, PageHeader, PriorityBadge } from '../components/chrome.tsx'
import { Button, CheckButton, EmptyState, ErrorState, Field, Input, ListSkeleton, Select } from '../components/ui.tsx'
import { buttonClass } from '../lib/buttonClass.ts'
import { localISODate, shiftISODate } from '../lib/due.ts'
import { isEvening } from '../lib/format.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { useToggleTask } from '../hooks/useToggleTask.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'
import { cn } from '../lib/cn.ts'

export function TodayPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const toggle = useToggleTask()
  const date = localISODate()
  const evening = isEvening()
  const scheduleDate = evening ? shiftISODate(date, 1) : date
  useDocumentTitle('Today')

  const today = useQuery({
    queryKey: ['today', date],
    queryFn: () => api.getToday(date),
  })
  const projects = useQuery({
    queryKey: ['projects', 'active'],
    queryFn: () => api.listProjects({ status: 'active' }),
  })

  const plan = useMutation({
    mutationFn: (input: { id: string; plannedFor: string | null }) =>
      api.updateTask(input.id, { plannedFor: input.plannedFor }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['today', date] })
      const previous = queryClient.getQueryData<TodayData>(['today', date])
      if (previous) queryClient.setQueryData(['today', date], movePlanned(previous, input.id, input.plannedFor, date))
      return { previous }
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(['today', date], context.previous)
      toast(errorMessage(error))
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['today', date] }),
  })

  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const selectedProject = projectId || projects.data?.[0]?.id || ''

  const create = useMutation({
    mutationFn: () => api.createTask(selectedProject, { title: title.trim(), plannedFor: scheduleDate }),
    onSuccess: async () => {
      setTitle('')
      toast(evening ? 'Added for tomorrow' : 'Added for today')
      await queryClient.invalidateQueries({ queryKey: ['today', date] })
    },
    onError: (error) => toast(errorMessage(error)),
  })

  if (today.isLoading) return <ListSkeleton />
  if (today.isError || !today.data) return <ErrorState onRetry={() => void today.refetch()} />

  const { planned, carried, available } = today.data
  const finished = today.data.finished ?? []
  const done = [...planned.filter((task) => task.completed), ...finished.filter((task) => !planned.some((item) => item.id === task.id))]
  const open = planned.filter((task) => !task.completed)
  const empty = planned.length === 0 && carried.length === 0 && available.length === 0 && finished.length === 0
  const nothingPlanned = planned.length === 0

  function onToggle(task: TodayTask) {
    toggle.mutate(
      { id: task.id, projectId: task.projectId, completed: task.completed },
      { onError: (error) => toast(errorMessage(error)) },
    )
  }

  function onCreate(event: FormEvent) {
    event.preventDefault()
    if (!selectedProject || !title.trim()) return
    create.mutate()
  }

  return (
    <div>
      <PageHeader
        eyebrow={evening ? 'Evening' : 'Morning'}
        title="Today"
        description={
          evening ? 'What got done, and what carries into tomorrow.' : 'Pick the tasks you intend to finish today.'
        }
      />

      <form onSubmit={onCreate} className="mt-6 flex flex-col gap-2 border border-neutral-200 p-4 sm:flex-row sm:items-end">
        <div className="sm:flex-1">
        <Field label={evening ? 'Add a task for tomorrow' : 'Add a task for today'} htmlFor="today-task">
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
        <Button type="submit" disabled={create.isPending || !title.trim() || !selectedProject}>
          {create.isPending ? 'Adding…' : 'Add task'}
        </Button>
      </form>

      {empty ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing planned"
            body="Add a task above, or open a project and choose work for today."
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
              empty={evening ? (nothingPlanned && finished.length === 0 ? 'Nothing planned for today.' : 'Nothing finished yet.') : 'Nothing chosen yet.'}
              onToggle={onToggle}
              action={
                evening
                  ? undefined
                  : (task) =>
                      task.completed ? null : (
                        <button
                          type="button"
                          className="focus-ring inline-flex min-h-11 items-center px-2 text-xs text-neutral-800 hover:text-neutral-950"
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
                <TaskList
                  tasks={open}
                  empty={nothingPlanned ? 'Nothing planned for today.' : 'Everything on today’s list is done.'}
                  onToggle={onToggle}
                />
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
                    className="focus-ring inline-flex min-h-11 items-center px-2 text-xs text-neutral-800 hover:text-neutral-950"
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
                    className={cn(buttonClass('secondary'), 'min-h-11 px-3 text-xs')}
                    onClick={() => plan.mutate({ id: task.id, plannedFor: scheduleDate })}
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

function movePlanned(data: TodayData, id: string, plannedFor: string | null, date: string): TodayData {
  const all = [...data.planned, ...data.carried, ...data.available, ...(data.finished ?? [])]
  const task = all.find((item) => item.id === id)
  if (!task) return data
  const next = { ...task, plannedFor }
  const without = (items: TodayTask[]) => items.filter((item) => item.id !== id)
  const planned = without(data.planned)
  const carried = without(data.carried)
  const available = without(data.available)
  const finished = without(data.finished ?? [])
  if (plannedFor === date) planned.push(next)
  else if (plannedFor && plannedFor < date && !next.completed) carried.push(next)
  else if (!next.completed) available.push(next)
  else if (next.completedOn === date) finished.push(next)
  return { ...data, planned, carried, available, finished }
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
        <li key={task.id} className="flex items-center gap-2 border-b border-neutral-200 px-3 py-1 last:border-b-0">
          <CheckButton
            checked={task.completed}
            label={task.completed ? `Mark “${task.title}” incomplete` : `Mark “${task.title}” complete`}
            onChange={() => onToggle(task)}
          />
          <div className="min-w-0 flex-1 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn('text-sm', task.completed ? 'text-neutral-400 line-through' : 'text-neutral-950')}>{task.title}</p>
              <PriorityBadge priority={task.priority} />
            </div>
            <Link to={`/projects/${task.projectId}`} className="focus-ring text-sm text-neutral-500 hover:text-neutral-950">
              {task.projectName}
            </Link>
          </div>
          {task.completed ? null : <DueBadge dueDate={task.dueDate} />}
          {action ? <div className="shrink-0">{action(task)}</div> : null}
        </li>
      ))}
    </ul>
  )
}
