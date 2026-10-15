import type { ReactNode } from 'react'
import type { TaskPriority } from '../api/types.ts'
import { cn } from '../lib/cn.ts'
import { dueState } from '../lib/due.ts'
import { formatDate } from '../lib/format.ts'

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase', className)}>{children}</p>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-5 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="mt-2 text-3xl font-medium tracking-[-0.04em] text-neutral-950 sm:text-4xl">{title}</h1>
        {description ? <div className="mt-2 max-w-xl text-sm leading-6 text-neutral-600">{description}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function Badge({ children, tone = 'outline' }: { children: ReactNode; tone?: 'outline' | 'solid' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center border px-1.5 py-0.5 font-pixel text-[10px] tracking-[0.14em] uppercase',
        tone === 'solid' ? 'border-neutral-950 bg-neutral-950 text-white' : 'border-neutral-300 bg-white text-neutral-600',
      )}
    >
      {children}
    </span>
  )
}

export function DueBadge({ dueDate }: { dueDate: string | null | undefined }) {
  if (!dueDate) return null
  const state = dueState(dueDate)
  const date = formatDate(dueDate)
  if (state === 'later' || state === 'none') {
    return <span className="shrink-0 font-mono text-xs text-neutral-500">{date}</span>
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      <span
        className={cn(
          'border px-1.5 py-0.5 font-pixel text-[10px] tracking-[0.14em] uppercase',
          state === 'overdue' ? 'border-red-800 text-red-800' : 'border-amber-800 text-amber-900',
        )}
      >
        {state === 'overdue' ? 'Overdue' : 'Due soon'}
      </span>
      <span className="font-mono text-xs text-neutral-500">{date}</span>
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === 'medium') return null
  return (
    <span
      className={cn(
        'border px-1.5 py-0.5 font-pixel text-[10px] tracking-[0.14em] uppercase',
        priority === 'urgent' && 'border-red-800 text-red-800',
        priority === 'high' && 'border-neutral-950 text-neutral-950',
        priority === 'low' && 'border-neutral-300 text-neutral-500',
      )}
    >
      {priority}
    </span>
  )
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-neutral-200 px-4 py-4 sm:px-5">
      <p className="font-pixel text-[10px] tracking-[0.16em] text-neutral-500 uppercase">{label}</p>
      <p className="mt-2 font-mono text-2xl tracking-tight text-neutral-950 tabular-nums">{value}</p>
    </div>
  )
}
