import { useEffect, useId, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '../lib/cn.ts'
import { cycleTheme } from '../lib/theme.ts'
import { useToast } from './toast-context.ts'

type Command = {
  id: string
  label: string
  hint?: string
  run: () => void
}

const THEME_LABEL = { light: 'light', dark: 'dark', system: 'system' } as const

export function CommandPalette() {
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const listId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [seenQuery, setSeenQuery] = useState('')

  if (seenQuery !== query) {
    setSeenQuery(query)
    setIndex(0)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
        setQuery('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    const previously = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = dialogRef.current
    root?.querySelector('input')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab' || !root) return
      const items = [...root.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])')].filter(
        (item) => !item.hasAttribute('disabled'),
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = previousOverflow
      previously?.focus()
    }
  }, [open])

  if (!open) return null

  const projectId = /^\/projects\/([^/]+)$/.exec(location.pathname)?.[1]
  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }
  const commands: Command[] = [
    { id: 'dashboard', label: 'Go to Dashboard', run: () => go('/') },
    { id: 'today', label: 'Go to Today', run: () => go('/today') },
    { id: 'upcoming', label: 'Go to Upcoming', run: () => go('/upcoming') },
    { id: 'calendar', label: 'Go to Calendar', run: () => go('/calendar') },
    { id: 'projects', label: 'Go to Projects', run: () => go('/projects') },
    { id: 'notes', label: 'Go to Notes', run: () => go('/notes') },
    { id: 'search', label: 'Go to Search', run: () => go('/search') },
    { id: 'settings', label: 'Go to Settings', run: () => go('/settings') },
    { id: 'trash', label: 'Go to Trash', run: () => go('/trash') },
    { id: 'new-project', label: 'Create project', run: () => go('/projects?new=1') },
  ]
  if (projectId) {
    commands.push({
      id: 'new-task',
      label: 'Create task in this project',
      run: () => go(`/projects/${projectId}?compose=1`),
    })
  }
  commands.push({
    id: 'theme',
    label: 'Cycle theme',
    hint: 'Light, dark, system',
    run: () => {
      const next = cycleTheme()
      setOpen(false)
      toast(`Theme set to ${THEME_LABEL[next]}.`)
    },
  })

  const needle = query.trim().toLowerCase()
  const filtered = needle ? commands.filter((command) => command.label.toLowerCase().includes(needle)) : commands
  const active = filtered.length === 0 ? 0 : Math.min(index, filtered.length - 1)
  const activeId = filtered[active] ? `${listId}-${filtered[active].id}` : undefined

  function runActive() {
    filtered[active]?.run()
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-neutral-900/30 px-4 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg border border-neutral-200 bg-white shadow-md"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-neutral-200 p-3">
          <label htmlFor={`${listId}-input`} className="sr-only">
            Command
          </label>
          <input
            id={`${listId}-input`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to, or create…"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            autoComplete="off"
            className="focus-ring w-full border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setIndex((current) => Math.min(filtered.length - 1, current + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setIndex((current) => Math.max(0, current - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                runActive()
              }
            }}
          />
        </div>
        <ul id={listId} role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-sm text-neutral-500">No matching commands.</li>
          ) : (
            filtered.map((command, commandIndex) => {
              const selected = commandIndex === active
              return (
                <li key={command.id} role="presentation">
                  <button
                    id={`${listId}-${command.id}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={cn(
                      'focus-ring flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left text-sm',
                      selected ? 'bg-neutral-50 text-neutral-950' : 'text-neutral-800 hover:bg-neutral-50',
                    )}
                    onMouseEnter={() => setIndex(commandIndex)}
                    onClick={() => command.run()}
                  >
                    <span>{command.label}</span>
                    {command.hint ? <span className="text-xs text-neutral-500">{command.hint}</span> : null}
                  </button>
                </li>
              )
            })
          )}
        </ul>
        <p className="border-t border-neutral-200 px-4 py-2 font-mono text-[11px] text-neutral-500">
          Ctrl+K or ⌘K opens · Esc closes · ↑↓ move · Enter runs
        </p>
      </div>
    </div>
  )
}
