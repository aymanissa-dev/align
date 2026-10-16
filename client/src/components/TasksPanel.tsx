import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { Label, Task, TaskPriority } from '../api/types.ts'
import { api } from '../api/index.ts'
import { ApiError } from '../api/errors.ts'
import { useToast } from './toast-context.ts'
import { IconPencil, IconTrash } from './icons.tsx'
import { Button, CheckButton, ConfirmDialog, ErrorState, Input, ListSkeleton, ProgressBar, Select } from './ui.tsx'
import { DueBadge, PriorityBadge } from './chrome.tsx'
import { useToggleTask } from '../hooks/useToggleTask.ts'
import { cn } from '../lib/cn.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { LABEL_COLORS, PRIORITIES, sortTasks, type TaskSort } from '../lib/priority.ts'
import { taskProgress } from '../lib/tasks.ts'
import { dropQueuedWrite, pendingTaskCreates, QUEUE_EVENT } from '../lib/offline.ts'
import { invalidateWorkspace } from '../queryClient.ts'

export function TasksPanel({ projectId }: { projectId: string }) {
  const toast = useToast()
  const toggle = useToggleTask()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [picked, setPicked] = useState<string[]>([])
  const [sort, setSort] = useState<TaskSort>('manual')
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all')
  const [labelFilter, setLabelFilter] = useState('all')
  const [labelName, setLabelName] = useState('')
  const [labelColor, setLabelColor] = useState<string>(LABEL_COLORS[0])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftDue, setDraftDue] = useState('')
  const [draftPriority, setDraftPriority] = useState<TaskPriority>('medium')
  const [draftLabels, setDraftLabels] = useState<string[]>([])
  const [queueTick, setQueueTick] = useState(0)

  useEffect(() => {
    const sync = () => setQueueTick((value) => value + 1)
    window.addEventListener(QUEUE_EVENT, sync)
    return () => window.removeEventListener(QUEUE_EVENT, sync)
  }, [])

  const tasks = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => api.listTasks(projectId),
  })
  const labels = useQuery({
    queryKey: ['labels'],
    queryFn: () => api.listLabels(),
  })

  const create = useMutation({
    mutationFn: () =>
      api.createTask(projectId, {
        title,
        dueDate: due || null,
        priority,
        labelIds: picked,
      }),
    onSuccess: async () => {
      setTitle('')
      setDue('')
      setPriority('medium')
      setPicked([])
      await invalidateWorkspace()
    },
    onError: (error) => {
      if (error instanceof ApiError && error.queued) {
        setTitle('')
        setDue('')
        setPriority('medium')
        setPicked([])
        toast('Saved on this device. It will sync when you reconnect.')
        return
      }
      toast(errorMessage(error))
    },
  })

  const update = useMutation({
    mutationFn: (input: { id: string; title: string; dueDate: string | null; priority: TaskPriority; labelIds: string[] }) =>
      api.updateTask(input.id, {
        title: input.title,
        dueDate: input.dueDate,
        priority: input.priority,
        labelIds: input.labelIds,
      }),
    onSuccess: async () => {
      setEditingId(null)
      await invalidateWorkspace()
    },
    onError: (error) => toast(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (taskId: string) => api.deleteTask(taskId),
    onSuccess: () => invalidateWorkspace(),
    onError: (error) => toast(errorMessage(error)),
  })

  const createLabel = useMutation({
    mutationFn: () => api.createLabel({ name: labelName, color: labelColor }),
    onSuccess: async () => {
      setLabelName('')
      await invalidateWorkspace()
    },
    onError: (error) => toast(errorMessage(error)),
  })

  const removeLabel = useMutation({
    mutationFn: (id: string) => api.deleteLabel(id),
    onSuccess: async (_data, id) => {
      setPicked((current) => current.filter((item) => item !== id))
      if (labelFilter === id) setLabelFilter('all')
      await invalidateWorkspace()
    },
    onError: (error) => toast(errorMessage(error)),
  })

  function onCreate(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    create.mutate()
  }

  function onCreateLabel(event: FormEvent) {
    event.preventDefault()
    if (!labelName.trim()) return
    createLabel.mutate()
  }

  function startEdit(task: Task) {
    setEditingId(task.id)
    setDraftTitle(task.title)
    setDraftDue(task.dueDate ?? '')
    setDraftPriority(task.priority)
    setDraftLabels(task.labelIds)
  }

  function saveEdit(taskId: string) {
    if (!draftTitle.trim()) {
      toast('Task title is required.')
      return
    }
    update.mutate({
      id: taskId,
      title: draftTitle,
      dueDate: draftDue || null,
      priority: draftPriority,
      labelIds: draftLabels,
    })
  }

  if (tasks.isLoading || labels.isLoading) return <ListSkeleton rows={4} />
  if (tasks.isError || !tasks.data || labels.isError || !labels.data) {
    return (
      <div className="mt-8">
        <ErrorState onRetry={() => void Promise.all([tasks.refetch(), labels.refetch()])} />
      </div>
    )
  }

  const catalog = labels.data
  const byId = new Map(catalog.map((label) => [label.id, label]))
  void queueTick
  const queuedTasks: Task[] = pendingTaskCreates()
    .filter((task) => task.projectId === projectId)
    .map((task) => ({
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      completed: false,
      dueDate: task.dueDate,
      priority: task.priority,
      labelIds: task.labelIds,
      plannedFor: task.plannedFor,
      completedOn: null,
      order: -1,
      createdAt: '',
      updatedAt: '',
    }))
  const visibleTasks = [...queuedTasks, ...tasks.data]
  const filtered = visibleTasks.filter((task) => {
    if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false
    if (labelFilter !== 'all' && !task.labelIds.includes(labelFilter)) return false
    return true
  })
  const sorted = sortTasks(filtered, sort)
  const progress = taskProgress(visibleTasks)

  return (
    <div className="mt-8">
      <form onSubmit={onCreateLabel} className="border border-neutral-200">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Labels</h2>
        </div>
        <div className="flex flex-col gap-3 px-4 py-3">
          {catalog.length === 0 ? (
            <p className="text-sm text-neutral-500">Create a label, then attach it to a task.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {catalog.map((label) => (
                <li key={label.id} className="inline-flex items-center gap-2 border border-neutral-300 px-2 py-1">
                  <LabelSwatch label={label} />
                  <span className="text-sm text-neutral-950">{label.name}</span>
                  <button
                    type="button"
                    className="focus-ring inline-flex h-11 w-11 items-center justify-center text-neutral-400 hover:text-neutral-950"
                    aria-label={`Delete label ${label.name}`}
                    onClick={() => removeLabel.mutate(label.id)}
                  >
                    <IconTrash />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={labelName}
              onChange={(event) => setLabelName(event.target.value)}
              placeholder="New label"
              aria-label="Label name"
              className="sm:max-w-xs"
            />
            <Button type="submit" variant="secondary" disabled={createLabel.isPending || !labelName.trim()}>
              Add label
            </Button>
          </div>
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-1 border border-t-0 border-neutral-200 px-4 py-2" role="radiogroup" aria-label="Label color">
            {LABEL_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={labelColor === color}
                aria-label={color}
                className={cn(
                  'focus-ring h-11 w-11 shrink-0 border min-h-[44px] min-w-[44px]',
                  labelColor === color ? 'border-neutral-950' : 'border-neutral-300',
                )}
                style={{ backgroundColor: color }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.preventDefault()
                  setLabelColor(color)
                }}
              />
            ))}
      </div>

      <form onSubmit={onCreate} className="mt-4 flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a task"
            aria-label="Task title"
            className="sm:flex-1"
          />
          <Input type="date" value={due} onChange={(event) => setDue(event.target.value)} aria-label="Due date" className="sm:w-40" />
          <Select
            aria-label="Priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority)}
            className="sm:w-36"
          >
            {PRIORITIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={create.isPending || !title.trim()}>
            {create.isPending ? 'Adding…' : 'Add'}
          </Button>
        </div>
        {catalog.length > 0 ? (
          <LabelPicker labels={catalog} selected={picked} onChange={setPicked} />
        ) : null}
      </form>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Select aria-label="Sort tasks" value={sort} onChange={(event) => setSort(event.target.value as TaskSort)}>
          <option value="manual">Sort: Manual</option>
          <option value="due">Sort: Due date</option>
          <option value="priority">Sort: Priority</option>
        </Select>
        <Select
          aria-label="Filter by priority"
          value={priorityFilter}
          onChange={(event) => setPriorityFilter(event.target.value as TaskPriority | 'all')}
        >
          <option value="all">All priorities</option>
          {PRIORITIES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter by label" value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)}>
          <option value="all">All labels</option>
          {catalog.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </Select>
      </div>

      {visibleTasks.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500">Tasks you add will show up here.</p>
      ) : (
        <>
          <div className="mt-8">
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <p className="text-neutral-500">
                {progress.completed} of {progress.total} complete
              </p>
              <p className="text-neutral-900 tabular-nums">{progress.percent}%</p>
            </div>
            <ProgressBar value={progress.percent} label="Task progress" />
          </div>
          {sorted.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">No tasks match these filters.</p>
          ) : (
            <ul className="mt-4 divide-y divide-neutral-200 border border-neutral-200">
              {sorted.map((task) =>
                editingId === task.id ? (
                  <li key={task.id} className="px-4 py-3">
                    <form
                      className="flex flex-col gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        saveEdit(task.id)
                      }}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          value={draftTitle}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          aria-label="Task title"
                          autoFocus
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') setEditingId(null)
                          }}
                          className="sm:flex-1"
                        />
                        <Input
                          type="date"
                          value={draftDue}
                          onChange={(event) => setDraftDue(event.target.value)}
                          aria-label="Due date"
                          className="sm:w-40"
                        />
                        <Select
                          aria-label="Priority"
                          value={draftPriority}
                          onChange={(event) => setDraftPriority(event.target.value as TaskPriority)}
                          className="sm:w-36"
                        >
                          {PRIORITIES.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {catalog.length > 0 ? (
                        <LabelPicker labels={catalog} selected={draftLabels} onChange={setDraftLabels} />
                      ) : null}
                      <div className="flex gap-2">
                        <Button type="submit" disabled={update.isPending}>
                          Save
                        </Button>
                        <Button variant="secondary" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  </li>
                ) : (
                  <li key={task.id} className="flex items-start gap-2 px-3 py-3 sm:gap-3 sm:px-4">
                    <CheckButton
                      checked={task.completed}
                      label={task.completed ? `Mark “${task.title}” incomplete` : `Mark “${task.title}” complete`}
                      onChange={() => {
                        if (task.id.startsWith('queued:')) return
                        toggle.mutate(
                          { id: task.id, projectId: task.projectId, completed: task.completed },
                          { onError: (error) => toast(errorMessage(error)) },
                        )
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className={cn('text-sm break-words', task.completed ? 'text-neutral-400 line-through' : 'text-neutral-950')}>
                          {task.title}
                        </p>
                        <PriorityBadge priority={task.priority} />
                        {task.id.startsWith('queued:') ? (
                          <span className="font-pixel text-[10px] tracking-[0.14em] text-neutral-500 uppercase">Queued</span>
                        ) : null}
                        {task.labelIds.map((id) => {
                          const label = byId.get(id)
                          if (!label) return null
                          return <LabelSwatch key={id} label={label} named />
                        })}
                      </div>
                      {task.completed ? null : (
                        <div className="mt-1">
                          <DueBadge dueDate={task.dueDate} />
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0">
                      {task.id.startsWith('queued:') ? null : (
                        <button
                          type="button"
                          className="focus-ring inline-flex h-11 w-11 items-center justify-center text-neutral-400 hover:text-neutral-950"
                          aria-label={`Edit “${task.title}”`}
                          onClick={() => startEdit(task)}
                        >
                          <IconPencil />
                        </button>
                      )}
                      <button
                        type="button"
                        className="focus-ring inline-flex h-11 w-11 items-center justify-center text-neutral-400 hover:text-neutral-950"
                        aria-label={`Delete “${task.title}”`}
                        onClick={() => {
                          if (task.id.startsWith('queued:')) {
                            dropQueuedWrite(task.id.slice('queued:'.length))
                            return
                          }
                          setPendingDelete(task)
                        }}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete task"
        body={pendingDelete ? `Delete “${pendingDelete.title}”? This cannot be undone.` : ''}
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => {
          if (!pendingDelete) return
          remove.mutate(pendingDelete.id, { onSuccess: () => setPendingDelete(null) })
        }}
        onClose={() => {
          if (!remove.isPending) setPendingDelete(null)
        }}
      />
    </div>
  )
}

function LabelSwatch({ label, named = false }: { label: Label; named?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 border border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-700">
      <span className="inline-block h-2.5 w-2.5" style={{ backgroundColor: label.color }} aria-hidden />
      {named ? label.name : null}
    </span>
  )
}

function LabelPicker({
  labels,
  selected,
  onChange,
}: {
  labels: Label[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Task labels">
      {labels.map((label) => {
        const on = selected.includes(label.id)
        return (
          <button
            key={label.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter((id) => id !== label.id) : [...selected, label.id])}
            className={cn(
              'focus-ring inline-flex min-h-11 items-center gap-1.5 border px-3 text-xs',
              on ? 'border-neutral-950 bg-neutral-950 text-white' : 'border-neutral-300 text-neutral-700',
            )}
          >
            <span className="inline-block h-2.5 w-2.5" style={{ backgroundColor: label.color }} aria-hidden />
            {label.name}
          </button>
        )
      })}
    </div>
  )
}
