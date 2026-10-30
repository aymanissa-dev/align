import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import type { Label, Recurrence, Task, TaskPatch, TaskPriority } from '../api/types.ts'
import { api } from '../api/index.ts'
import { ApiError } from '../api/errors.ts'
import { ConflictDialog } from './ConflictDialog.tsx'
import { useToast } from './toast-context.ts'
import { isConflict } from '../lib/conflict.ts'
import { taskFieldPatch } from '../lib/patch.ts'
import { LinkedNoteChips } from './LinkedNotes.tsx'
import { IconPencil, IconTrash } from './icons.tsx'
import { Button, CheckButton, ConfirmDialog, ErrorState, Input, ListSkeleton, OfflineState, ProgressBar, Select } from './ui.tsx'
import { DueBadge, PriorityBadge, RecurrenceBadge } from './chrome.tsx'
import { SubtaskEditor } from './Subtasks.tsx'
import { useToggleTask } from '../hooks/useToggleTask.ts'
import { cn } from '../lib/cn.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { LABEL_COLORS, PRIORITIES, sortTasks, type TaskSort } from '../lib/priority.ts'
import { taskProgress } from '../lib/tasks.ts'
import { checklistLabel, freshTaskFields, recurrenceOf, subtasksOf } from '../lib/taskFields.ts'
import { dropQueuedWrite, getQueueVersion, pendingTaskCreates, subscribeQueue } from '../lib/offline.ts'
import { useQueryMiss } from '../lib/queryMiss.ts'
import { invalidateWorkspace } from '../queryClient.ts'

function recurrenceFrom(value: string): Recurrence | null {
  if (value === 'daily' || value === 'weekly' || value === 'monthly') return value
  return null
}

export function TasksPanel({ projectId }: { projectId: string }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const toggle = useToggleTask()
  const [params, setParams] = useSearchParams()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null)
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
  const [draftRecurrence, setDraftRecurrence] = useState<Recurrence | null>(null)
  const [draftLabels, setDraftLabels] = useState<string[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const patchChain = useRef(Promise.resolve())
  const [editBase, setEditBase] = useState<Task | null>(null)
  const [conflict, setConflict] = useState<{ id: string; patch: TaskPatch; version: number } | null>(null)
  const queueVersion = useSyncExternalStore(subscribeQueue, getQueueVersion, getQueueVersion)

  const tasks = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: ({ signal }) => api.listTasks(projectId, { signal }),
  })
  const labels = useQuery({
    queryKey: ['labels'],
    queryFn: () => api.listLabels(),
  })
  const projectNotes = useQuery({
    queryKey: ['notes', projectId],
    queryFn: () => api.listProjectNotes(projectId),
  })
  const miss = useQueryMiss(tasks)

  const create = useMutation({
    mutationFn: (input: { title: string; dueDate: string | null; priority: TaskPriority; labelIds: string[]; recurrence: Recurrence | null }) =>
      api.createTask(projectId, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['tasks', projectId] })
      const previous = queryClient.getQueryData<Task[]>(['tasks', projectId])
      const optimistic: Task = {
        id: `optimistic:${crypto.randomUUID()}`,
        projectId,
        title: input.title,
        completed: false,
        dueDate: input.dueDate,
        priority: input.priority,
        labelIds: input.labelIds,
        plannedFor: null,
        completedOn: null,
        order: (previous ?? []).reduce((max, task) => Math.max(max, task.order), 0) + 1,
        version: 0,
        createdAt: '',
        updatedAt: '',
        ...freshTaskFields(),
        recurrence: input.recurrence,
      }
      queryClient.setQueryData<Task[]>(['tasks', projectId], [...(previous ?? []), optimistic])
      return { previous, optimisticId: optimistic.id }
    },
    onSuccess: (task, _input, context) => {
      queryClient.setQueryData<Task[]>(['tasks', projectId], (current) =>
        current?.map((item) => (item.id === context?.optimisticId ? task : item)),
      )
      void queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['today'] })
    },
    onError: (error, input, context) => {
      if (context?.previous) queryClient.setQueryData(['tasks', projectId], context.previous)
      if (error instanceof ApiError && error.queued) {
        toast('Saved on this device. It will sync when you reconnect.')
        return
      }
      setTitle(input.title)
      setDue(input.dueDate ?? '')
      setPriority(input.priority)
      setRecurrence(input.recurrence)
      setPicked(input.labelIds)
      toast(errorMessage(error))
    },
  })

  const update = useMutation({
    mutationFn: (input: { id: string; patch: TaskPatch; version: number; overwrite?: boolean }) =>
      api.updateTask(input.id, input.patch, { version: input.version, overwrite: input.overwrite }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['tasks', projectId] })
      const previous = queryClient.getQueryData<Task[]>(['tasks', projectId])
      if (previous) {
        queryClient.setQueryData<Task[]>(
          ['tasks', projectId],
          previous.map((task) => (task.id === input.id ? { ...task, ...input.patch } : task)),
        )
      }
      return { previous }
    },
    onSuccess: async (task, input) => {
      queryClient.setQueryData<Task[]>(['tasks', projectId], (current) => current?.map((item) => (item.id === task.id ? task : item)))
      const closesEditor =
        input.patch.title !== undefined ||
        input.patch.dueDate !== undefined ||
        input.patch.priority !== undefined ||
        input.patch.labelIds !== undefined ||
        input.patch.recurrence !== undefined
      if (closesEditor) {
        setEditingId(null)
        setEditBase(null)
      }
      setConflict(null)
      await invalidateWorkspace()
    },
    onError: (error, input, context) => {
      if (error instanceof ApiError && error.queued) return
      if (context?.previous) queryClient.setQueryData(['tasks', projectId], context.previous)
      if (isConflict(error)) {
        setConflict({ id: input.id, patch: input.patch, version: input.version })
        return
      }
      toast(errorMessage(error))
    },
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
    const nextTitle = title.trim()
    if (!nextTitle) return
    const input = { title: nextTitle, dueDate: due || null, priority, labelIds: [...picked], recurrence }
    setTitle('')
    setDue('')
    setPriority('medium')
    setRecurrence(null)
    setPicked([])
    create.mutate(input)
  }

  function onCreateLabel(event: FormEvent) {
    event.preventDefault()
    if (!labelName.trim()) return
    createLabel.mutate()
  }

  function startEdit(task: Task) {
    setEditingId(task.id)
    setEditBase(task)
    setDraftTitle(task.title)
    setDraftDue(task.dueDate ?? '')
    setDraftPriority(task.priority)
    setDraftRecurrence(recurrenceOf(task))
    setDraftLabels(task.labelIds)
  }

  function patchTask(id: string, patch: TaskPatch) {
    const run = patchChain.current.then(async () => {
      const current = queryClient.getQueryData<Task[]>(['tasks', projectId])?.find((task) => task.id === id)
      await update.mutateAsync({ id, patch, version: current?.version ?? 0 })
    })
    patchChain.current = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  function saveEdit(taskId: string) {
    if (!editBase || editBase.id !== taskId) return
    if (!draftTitle.trim()) {
      toast('Task title is required.')
      return
    }
    const patch = taskFieldPatch(
      { ...editBase, recurrence: recurrenceOf(editBase) },
      {
        title: draftTitle.trim(),
        dueDate: draftDue || null,
        priority: draftPriority,
        labelIds: draftLabels,
        recurrence: draftRecurrence,
      },
    )
    if (Object.keys(patch).length === 0) {
      setEditingId(null)
      setEditBase(null)
      return
    }
    void patchTask(taskId, patch)
  }

  const compose = params.get('compose') === '1'
  const focusTask = params.get('task')
  const focusReady = Boolean(focusTask && tasks.data?.some((task) => task.id === focusTask))
  const [openedFocus, setOpenedFocus] = useState<string | null>(null)
  if (focusReady && focusTask && openedFocus !== focusTask) {
    setOpenedFocus(focusTask)
    setExpandedId(focusTask)
  }
  useEffect(() => {
    if (!compose) return
    document.getElementById('task-title')?.focus()
    const next = new URLSearchParams(params)
    next.delete('compose')
    setParams(next, { replace: true })
  }, [compose, params, setParams])
  useEffect(() => {
    if (!focusTask || openedFocus !== focusTask) return
    document.getElementById(`task-${focusTask}`)?.scrollIntoView({ block: 'center' })
  }, [focusTask, openedFocus])

  if (!tasks.data) {
    if (miss === 'loading') return <ListSkeleton rows={4} />
    if (miss === 'offline') {
      return (
        <div className="mt-8">
          <OfflineState />
        </div>
      )
    }
    return (
      <div className="mt-8">
        <ErrorState error={tasks.error ?? labels.error} onRetry={() => void Promise.all([tasks.refetch(), labels.refetch()])} />
      </div>
    )
  }

  const catalog = labels.data ?? []
  const byId = new Map(catalog.map((label) => [label.id, label]))
  void queueVersion
  const pending = pendingTaskCreates()
  const pendingIds = new Set(pending.map((task) => task.id))
  const cachedIds = new Set(tasks.data.map((task) => task.id))
  const queuedTasks: Task[] = pending
    .filter((task) => task.projectId === projectId && !cachedIds.has(task.id))
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
      version: 0,
      order: -1,
      createdAt: '',
      updatedAt: '',
      ...freshTaskFields(),
      recurrence: recurrenceOf(task),
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
      <ConflictDialog
        open={conflict !== null}
        pending={update.isPending}
        onClose={() => setConflict(null)}
        onReload={() => {
          setConflict(null)
          setEditingId(null)
          setEditBase(null)
          void tasks.refetch()
        }}
        onOverwrite={() => {
          if (!conflict) return
          update.mutate({ ...conflict, overwrite: true })
        }}
      />
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
              id="label-name"
              name="name"
              autoComplete="off"
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
                  'color-swatch focus-ring h-11 w-11 shrink-0 border min-h-[44px] min-w-[44px]',
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
            id="task-title"
            name="title"
            autoComplete="off"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a task"
            aria-label="Task title"
            className="sm:flex-1"
          />
          <Input id="task-due" name="due" type="date" autoComplete="off" value={due} onChange={(event) => setDue(event.target.value)} aria-label="Due date" className="sm:w-40" />
          <Select
            id="task-priority"
            name="priority"
            autoComplete="off"
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
          <Select
            id="task-recurrence"
            name="recurrence"
            autoComplete="off"
            aria-label="Repeat"
            value={recurrence ?? ''}
            onChange={(event) => setRecurrence(recurrenceFrom(event.target.value))}
            className="sm:w-40"
          >
            <option value="">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
          <Button type="submit" disabled={!title.trim()}>
            Add
          </Button>
        </div>
        {catalog.length > 0 ? (
          <LabelPicker labels={catalog} selected={picked} onChange={setPicked} />
        ) : null}
      </form>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Select id="task-sort" name="sort" autoComplete="off" aria-label="Sort tasks" value={sort} onChange={(event) => setSort(event.target.value as TaskSort)}>
          <option value="manual">Sort: Manual</option>
          <option value="due">Sort: Due date</option>
          <option value="priority">Sort: Priority</option>
        </Select>
        <Select
          id="task-priority-filter"
          name="priority-filter"
          autoComplete="off"
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
        <Select id="task-label-filter" name="label-filter" autoComplete="off" aria-label="Filter by label" value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)}>
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
                          id="task-title-edit"
                          name="title"
                          autoComplete="off"
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
                          id="task-due-edit"
                          name="due"
                          type="date"
                          autoComplete="off"
                          value={draftDue}
                          onChange={(event) => setDraftDue(event.target.value)}
                          aria-label="Due date"
                          className="sm:w-40"
                        />
                        <Select
                          id="task-priority-edit"
                          name="priority"
                          autoComplete="off"
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
                        <Select
                          id="task-recurrence-edit"
                          name="recurrence"
                          autoComplete="off"
                          aria-label="Repeat"
                          value={draftRecurrence ?? ''}
                          onChange={(event) => setDraftRecurrence(recurrenceFrom(event.target.value))}
                          className="sm:w-40"
                        >
                          <option value="">Does not repeat</option>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
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
                  <li key={task.id} id={`task-${task.id}`} className="px-3 py-3 sm:px-4">
                    <div className="flex items-start gap-2 sm:gap-3">
                    <CheckButton
                      checked={task.completed}
                      label={task.completed ? `Mark “${task.title}” incomplete` : `Mark “${task.title}” complete`}
                      onChange={() => {
                        if (task.id.startsWith('queued:') || task.id.startsWith('optimistic:')) return
                        toggle.mutate(
                          { id: task.id, projectId: task.projectId, completed: task.completed, version: task.version },
                          { onError: (error) => { if (!isConflict(error)) toast(errorMessage(error)) } },
                        )
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className={cn('text-sm break-words', task.completed ? 'text-neutral-400 line-through' : 'text-neutral-950')}>
                          {task.title}
                        </p>
                        <PriorityBadge priority={task.priority} />
                        <RecurrenceBadge recurrence={recurrenceOf(task)} />
                        {checklistLabel(subtasksOf(task)) ? (
                          <span className="font-mono text-[11px] text-neutral-500">{checklistLabel(subtasksOf(task))}</span>
                        ) : null}
                        {pendingIds.has(task.id) ? (
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
                      {task.id.startsWith('queued:') || task.id.startsWith('optimistic:') ? null : (
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
                          if (task.id.startsWith('optimistic:')) return
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
                    </div>
                    {task.id.startsWith('queued:') || task.id.startsWith('optimistic:') ? null : (
                      <div className="pl-11">
                        <LinkedNoteChips notes={projectNotes.data} taskId={task.id} />
                        <button
                          type="button"
                          className="focus-ring inline-flex min-h-11 items-center text-xs text-neutral-600 hover:text-neutral-950"
                          aria-expanded={expandedId === task.id}
                          onClick={() => setExpandedId((current) => (current === task.id ? null : task.id))}
                        >
                          {expandedId === task.id ? 'Hide checklist' : 'Checklist'}
                        </button>
                        {expandedId === task.id ? (
                          <SubtaskEditor
                            subtasks={subtasksOf(task)}
                            disabled={update.isPending}
                            onCommit={(next) => {
                              void patchTask(task.id, { subtasks: next })
                            }}
                          />
                        ) : null}
                      </div>
                    )}
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
        body={pendingDelete ? `Delete “${pendingDelete.title}”? Moved to Trash. You can restore it for 30 days.` : ''}
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
      <span className="color-swatch inline-block h-2.5 w-2.5" style={{ backgroundColor: label.color }} aria-hidden />
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
            <span className="color-swatch inline-block h-2.5 w-2.5" style={{ backgroundColor: label.color }} aria-hidden />
            {label.name}
          </button>
        )
      })}
    </div>
  )
}
