import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/index.ts'
import type { LinkedTask } from '../api/types.ts'
import { cn } from '../lib/cn.ts'
import { useQueryMiss } from '../lib/queryMiss.ts'

const MAX_LINKS = 40
const RESULT_CAP = 8

type KnownTask = { id: string; title: string }

export function NoteTaskLinks({
  projectId,
  taskIds,
  linkedTasks,
  pending,
  onChange,
}: {
  projectId: string
  taskIds: string[]
  linkedTasks: LinkedTask[]
  pending: boolean
  onChange: (next: string[], known: KnownTask[]) => void
}) {
  const listId = useId()
  const inputId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const tasks = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: ({ signal }) => api.listTasks(projectId, { signal }),
  })
  const miss = useQueryMiss(tasks)
  const known = (tasks.data ?? []).map((task) => ({ id: task.id, title: task.title }))
  const byId = new Map(linkedTasks.map((task) => [task.id, task]))
  const chips = taskIds.map((id) => byId.get(id) ?? { id, title: 'Removed', trashed: true, gone: true as const })
  const needle = query.trim().toLowerCase()
  const projectTasks = (tasks.data ?? []).filter((task) => !task.id.startsWith('optimistic:') && !task.id.startsWith('queued:'))
  const available = projectTasks.filter((task) => !taskIds.includes(task.id))
  const filtered = needle ? available.filter((task) => task.title.toLowerCase().includes(needle)) : available
  const matches = filtered.slice(0, RESULT_CAP)
  const matchKey = matches.map((task) => task.id).join('\n')
  const [seenKey, setSeenKey] = useState(matchKey)
  if (seenKey !== matchKey) {
    setSeenKey(matchKey)
    setActive(0)
  }
  const index = matches.length === 0 ? 0 : Math.min(active, matches.length - 1)
  const full = taskIds.length >= MAX_LINKS
  const busy = useRef(false)
  useEffect(() => {
    if (!pending) busy.current = false
  }, [pending])

  function link(id: string) {
    if (pending || busy.current || full || taskIds.includes(id)) return
    busy.current = true
    onChange([...taskIds, id], known)
  }

  function unlink(id: string) {
    if (pending || busy.current) return
    busy.current = true
    onChange(
      taskIds.filter((item) => item !== id),
      known,
    )
  }

  return (
    <section className="mt-6 border border-neutral-200" aria-label="Linked tasks">
      <div className="border-b border-neutral-200 px-3 py-2">
        <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Linked tasks</h2>
      </div>
      <div className="px-3 py-3">
        {chips.length > 0 ? (
          <ul className="mb-3 flex flex-wrap gap-1.5">
            {chips.map((task) => {
              const label = task.title || 'Untitled'
              return (
                <li key={task.id} className="inline-flex max-w-full items-stretch border border-neutral-300">
                  {task.trashed ? (
                    <span className="inline-flex min-h-11 max-w-xs items-center gap-2 px-2 text-xs text-neutral-500">
                      {'gone' in task ? (
                        <span>Removed</span>
                      ) : (
                        <>
                          <span className="truncate">{label}</span>
                          <span className="shrink-0 font-pixel text-[10px] tracking-[0.14em] uppercase">In Trash</span>
                        </>
                      )}
                    </span>
                  ) : (
                    <Link
                      to={`/projects/${projectId}?task=${task.id}`}
                      className="focus-ring inline-flex min-h-11 max-w-xs items-center px-2 text-xs text-neutral-950 hover:bg-neutral-50"
                    >
                      <span className="truncate">{label}</span>
                    </Link>
                  )}
                  <button
                    type="button"
                    className="focus-ring border-l border-neutral-300 px-2 text-xs text-neutral-600 hover:text-neutral-950"
                    aria-label={`Unlink ${label}`}
                    disabled={pending}
                    onClick={() => unlink(task.id)}
                  >
                    Unlink
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-neutral-500">No tasks linked yet.</p>
        )}
        {full ? (
          <p className="text-sm text-neutral-500">Unlink a task to add another.</p>
        ) : (
          <div>
            <label htmlFor={inputId} className="sr-only">
              Search tasks to link
            </label>
            <input
              id={inputId}
              name="task-link"
              role="combobox"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-activedescendant={open && matches[index] ? `${listId}-${matches[index].id}` : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              value={query}
              disabled={pending}
              placeholder="Search tasks to link"
              className="focus-ring min-h-11 w-full border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400"
              onChange={(event) => {
                setQuery(event.target.value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setOpen(true)
                  setActive((current) => Math.min(matches.length - 1, (open ? current : -1) + 1))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setOpen(true)
                  setActive((current) => Math.max(0, current - 1))
                } else if (event.key === 'Enter' && open) {
                  event.preventDefault()
                  const task = matches[index]
                  if (task) link(task.id)
                } else if (event.key === 'Escape') {
                  setOpen(false)
                }
              }}
            />
            {open ? (
              <ul id={listId} role="listbox" aria-label="Tasks in this project" className="border border-t-0 border-neutral-300">
                {tasks.isPending && !tasks.data ? (
                  <li className="px-3 py-3 text-sm text-neutral-500">{miss === 'offline' ? 'Tasks will load when you’re back online.' : 'Loading tasks…'}</li>
                ) : tasks.isError && !tasks.data ? (
                  <li className="px-3 py-3 text-sm text-neutral-500">
                    Couldn’t load tasks.{' '}
                    <button type="button" className="focus-ring underline" onMouseDown={(event) => event.preventDefault()} onClick={() => void tasks.refetch()}>
                      Retry
                    </button>
                  </li>
                ) : matches.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-neutral-500">
                    {projectTasks.length === 0
                      ? 'This project has no tasks yet.'
                      : available.length === 0
                        ? 'Every task in this project is already linked.'
                        : 'No matching tasks.'}
                  </li>
                ) : (
                  matches.map((task, taskIndex) => {
                    const selected = taskIndex === index
                    return (
                      <li key={task.id} role="presentation">
                        <button
                          id={`${listId}-${task.id}`}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={cn(
                            'focus-ring flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm',
                            selected ? 'bg-neutral-50 text-neutral-950' : 'text-neutral-800 hover:bg-neutral-50',
                          )}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setActive(taskIndex)}
                          onClick={() => link(task.id)}
                        >
                          <span className="truncate">{task.title}</span>
                          {task.completed ? <span className="shrink-0 font-pixel text-[10px] tracking-[0.14em] text-neutral-500 uppercase">Done</span> : null}
                        </button>
                      </li>
                    )
                  })
                )}
                {filtered.length > matches.length ? (
                  <li className="border-t border-neutral-200 px-3 py-2 font-mono text-[11px] text-neutral-500">Keep typing to narrow the list.</li>
                ) : null}
              </ul>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}
