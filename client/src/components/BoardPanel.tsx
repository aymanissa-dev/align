import { useRef, useState, type PointerEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Task, TaskPatch, TaskStatus } from '../api/types.ts'
import { api } from '../api/index.ts'
import { ApiError } from '../api/errors.ts'
import { boardMove } from '../lib/board.ts'
import { isConflict } from '../lib/conflict.ts'
import { insertSpawned, readSpawned, refreshTaskLists } from '../lib/taskLists.ts'
import { cn } from '../lib/cn.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { useQueryMiss } from '../lib/queryMiss.ts'
import { checklistLabel, recurrenceOf, statusOf, subtasksOf } from '../lib/taskFields.ts'
import { DueBadge, RecurrenceBadge } from './chrome.tsx'
import { useToast } from './toast-context.ts'
import { ErrorState, ListSkeleton, OfflineState } from './ui.tsx'

const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'Todo' },
  { id: 'doing', label: 'Doing' },
  { id: 'done', label: 'Done' },
]

function byOrder(a: Task, b: Task): number {
  if (a.order !== b.order) return a.order - b.order
  return a.createdAt.localeCompare(b.createdAt)
}

export function BoardPanel({ projectId }: { projectId: string }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const tasks = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: ({ signal }) => api.listTasks(projectId, { signal }),
  })
  const miss = useQueryMiss(tasks)
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<TaskStatus | null>(null)
  const dragging = useRef(false)

  const move = useMutation({
    mutationFn: (input: { id: string; patch: TaskPatch; version: number; retried?: boolean }) =>
      api.updateTask(input.id, input.patch, { version: input.version }),
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
    onSuccess: async (task) => {
      const spawned = readSpawned(task)
      if (spawned) insertSpawned(queryClient, projectId, spawned)
      await refreshTaskLists(queryClient, projectId)
    },
    onError: (error, input, context) => {
      if (error instanceof ApiError && error.queued) return
      if (isConflict(error) && !input.retried) {
        void api.listTasks(projectId).then((fresh) => {
          queryClient.setQueryData(['tasks', projectId], fresh)
          const task = fresh.find((item) => item.id === input.id)
          if (!task) return
          move.mutate({ id: input.id, patch: input.patch, version: task.version, retried: true })
        })
        return
      }
      if (context?.previous) queryClient.setQueryData(['tasks', projectId], context.previous)
      toast(errorMessage(error))
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['today'] })
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
    },
  })

  function applyMove(taskId: string, status: TaskStatus, index: number) {
    const current = queryClient.getQueryData<Task[]>(['tasks', projectId]) ?? tasks.data ?? []
    const task = current.find((item) => item.id === taskId)
    const next = boardMove(current, taskId, status, index)
    if (!task || !next || task.id.startsWith('queued:') || task.id.startsWith('optimistic:')) return
    move.mutate({ ...next, version: task.version })
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, taskId: string) {
    if (event.button !== 0) return
    dragging.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragId(taskId)
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!dragId) return
    if (Math.abs(event.movementX) + Math.abs(event.movementY) > 0) dragging.current = true
    const target = document.elementFromPoint(event.clientX, event.clientY)
    const column = target?.closest<HTMLElement>('[data-column]')
    const status = column?.dataset.column
    setOver(status === 'todo' || status === 'doing' || status === 'done' ? status : null)
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>, taskId: string) {
    const target = document.elementFromPoint(event.clientX, event.clientY)
    const column = target?.closest<HTMLElement>('[data-column]')
    const status = column?.dataset.column
    if (dragging.current && (status === 'todo' || status === 'doing' || status === 'done') && column) {
      const cards = [...column.querySelectorAll<HTMLElement>('[data-task-id]')].filter((card) => card.dataset.taskId !== taskId)
      let index = cards.length
      for (let i = 0; i < cards.length; i += 1) {
        const rect = cards[i].getBoundingClientRect()
        if (event.clientY < rect.top + rect.height / 2) {
          index = i
          break
        }
      }
      applyMove(taskId, status, index)
    }
    dragging.current = false
    setDragId(null)
    setOver(null)
  }

  if (!tasks.data) {
    if (miss === 'loading') return <ListSkeleton rows={3} />
    if (miss === 'offline') return <div className="mt-8"><OfflineState /></div>
    return <div className="mt-8"><ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} /></div>
  }

  const real = tasks.data.filter((task) => !task.id.startsWith('queued:') && !task.id.startsWith('optimistic:'))

  return (
    <div className="mt-8 flex gap-3 overflow-x-auto pb-2" aria-label="Board">
      {COLUMNS.map((column) => {
        const cards = real.filter((task) => statusOf(task) === column.id).sort(byOrder)
        return (
          <section
            key={column.id}
            data-column={column.id}
            aria-label={column.label}
            className={cn(
              'flex w-72 shrink-0 flex-col border bg-white',
              over === column.id ? 'border-neutral-950' : 'border-neutral-200',
            )}
          >
            <header className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
              <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">{column.label}</h2>
              <span className="font-mono text-xs text-neutral-500">{cards.length}</span>
            </header>
            <div className="flex min-h-40 flex-1 flex-col gap-2 p-2">
              {cards.length === 0 ? <p className="px-1 py-6 text-center text-sm text-neutral-400">Empty</p> : null}
              {cards.map((task) => {
                const progress = checklistLabel(subtasksOf(task))
                return (
                  <article
                    key={task.id}
                    data-task-id={task.id}
                    className={cn('border border-neutral-200 bg-white p-3', dragId === task.id && 'opacity-40')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className={cn('text-sm break-words', task.completed ? 'text-neutral-400 line-through' : 'text-neutral-950')}>
                        {task.title}
                      </h3>
                      <button
                        type="button"
                        className="focus-ring inline-flex h-11 shrink-0 items-center border border-neutral-300 px-2 font-pixel text-[10px] tracking-[0.14em] text-neutral-600 uppercase"
                        aria-label={`Drag “${task.title}”`}
                        style={{ touchAction: 'none' }}
                        onPointerDown={(event) => onPointerDown(event, task.id)}
                        onPointerMove={onPointerMove}
                        onPointerUp={(event) => onPointerUp(event, task.id)}
                        onPointerCancel={() => {
                          dragging.current = false
                          setDragId(null)
                          setOver(null)
                        }}
                      >
                        Drag
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <DueBadge dueDate={task.dueDate} />
                      <RecurrenceBadge recurrence={recurrenceOf(task)} />
                      {progress ? <span className="font-mono text-[11px] text-neutral-500">{progress}</span> : null}
                    </div>
                    <label className="mt-3 block">
                      <span className="sr-only">Column for “{task.title}”</span>
                      <select
                        className="focus-ring w-full border border-neutral-300 bg-white px-2 py-2 text-sm"
                        value={statusOf(task)}
                        aria-label={`Move “${task.title}”`}
                        onChange={(event) => {
                          const status = event.target.value
                          if (status === 'todo' || status === 'doing' || status === 'done') {
                            const columnTasks = real.filter((item) => statusOf(item) === status && item.id !== task.id)
                            applyMove(task.id, status, columnTasks.length)
                          }
                        }}
                      >
                        {COLUMNS.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </article>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
