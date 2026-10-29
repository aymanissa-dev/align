import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/index.ts'
import type { CalendarTask } from '../api/types.ts'
import { PageHeader, RecurrenceBadge } from '../components/chrome.tsx'
import { Button, EmptyState, ErrorState, ListSkeleton, OfflineState } from '../components/ui.tsx'
import { cn } from '../lib/cn.ts'
import { localISODate } from '../lib/due.ts'
import { formatDate } from '../lib/format.ts'
import { useQueryMiss } from '../lib/queryMiss.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function monthCells(cursor: string): { date: string; inMonth: boolean }[] {
  const [year, month] = cursor.split('-').map(Number)
  const first = new Date(year, month - 1, 1)
  const start = new Date(year, month - 1, 1 - first.getDay())
  const cells: { date: string; inMonth: boolean }[] = []
  for (let i = 0; i < 42; i += 1) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    cells.push({ date: localISODate(day), inMonth: day.getMonth() === month - 1 })
  }
  return cells
}

function shiftMonth(cursor: string, delta: number): string {
  const [year, month] = cursor.split('-').map(Number)
  const next = new Date(year, month - 1 + delta, 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(cursor: string): string {
  const [year, month] = cursor.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function CalendarPage() {
  const navigate = useNavigate()
  const today = localISODate()
  const [cursor, setCursor] = useState(() => today.slice(0, 7))
  const [selected, setSelected] = useState(today)
  useDocumentTitle('Calendar')

  const cells = useMemo(() => monthCells(cursor), [cursor])
  const from = cells[0]?.date ?? today
  const to = cells[cells.length - 1]?.date ?? today
  const calendar = useQuery({
    queryKey: ['calendar', from, to],
    queryFn: ({ signal }) => api.listCalendar(from, to, { signal }),
  })
  const miss = useQueryMiss(calendar)

  function showMonth(next: string) {
    setCursor(next)
    setSelected(today.startsWith(next) ? today : `${next}-01`)
  }

  if (!calendar.data) {
    if (miss === 'loading') return <ListSkeleton />
    if (miss === 'offline') return <OfflineState />
    return <ErrorState error={calendar.error} onRetry={() => void calendar.refetch()} />
  }

  const byDate = new Map<string, CalendarTask[]>()
  for (const task of calendar.data) {
    const list = byDate.get(task.dueDate) ?? []
    list.push(task)
    byDate.set(task.dueDate, list)
  }
  const monthCount = cells.filter((cell) => cell.inMonth).reduce((sum, cell) => sum + (byDate.get(cell.date)?.length ?? 0), 0)
  const dayTasks = [...(byDate.get(selected) ?? [])].sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div>
      <PageHeader
        eyebrow="Calendar"
        title={monthLabel(cursor)}
        description="Tasks with a due date."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => showMonth(shiftMonth(cursor, -1))}>
              Previous
            </Button>
            <Button variant="secondary" onClick={() => showMonth(today.slice(0, 7))}>
              Today
            </Button>
            <Button variant="secondary" onClick={() => showMonth(shiftMonth(cursor, 1))}>
              Next
            </Button>
          </div>
        }
      />

      <div className="mt-8 border border-neutral-200">
        <div className="grid grid-cols-7 border-b border-neutral-200">
          {WEEKDAYS.map((day) => (
            <div key={day} className="px-1 py-2 text-center font-pixel text-[10px] tracking-[0.14em] text-neutral-500 uppercase">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell) => {
            const count = byDate.get(cell.date)?.length ?? 0
            const isSelected = cell.date === selected
            const isToday = cell.date === today
            return (
              <button
                key={cell.date}
                type="button"
                aria-pressed={isSelected}
                aria-label={`${formatDate(cell.date)}, ${count} ${count === 1 ? 'task' : 'tasks'}`}
                onClick={() => setSelected(cell.date)}
                className={cn(
                  'focus-ring flex min-h-16 flex-col items-start border-r border-b border-neutral-200 px-1.5 py-1.5 text-left sm:min-h-20 sm:px-2',
                  isSelected && 'bg-neutral-50',
                  !cell.inMonth && 'text-neutral-400',
                )}
              >
                <span className={cn('font-mono text-xs', isToday ? 'border border-neutral-950 px-1 text-neutral-950' : 'text-inherit')}>
                  {Number(cell.date.slice(8))}
                </span>
                {count > 0 ? <span className="mt-1 font-mono text-[10px] text-neutral-500">{count}</span> : null}
              </button>
            )
          })}
        </div>
      </div>

      <section className="mt-6 border border-neutral-200" aria-label={formatDate(selected)}>
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-sm font-medium text-neutral-950">{formatDate(selected)}</h2>
        </div>
        {dayTasks.length === 0 ? (
          <EmptyState title="Nothing due" body={monthCount === 0 ? 'Nothing due this month.' : 'This day is clear.'} />
        ) : (
          <ul>
            {dayTasks.map((task) => (
              <li key={task.id} className="border-b border-neutral-200 last:border-b-0">
                <button
                  type="button"
                  className="focus-ring flex w-full flex-col items-start gap-1 px-4 py-3 text-left hover:bg-neutral-50"
                  onClick={() => navigate(`/projects/${task.projectId}?task=${task.id}`)}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={cn('text-sm', task.completed ? 'text-neutral-400 line-through' : 'text-neutral-950')}>{task.title}</span>
                    <RecurrenceBadge recurrence={task.recurrence} />
                  </span>
                  <span className="text-sm text-neutral-600">{task.projectName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
