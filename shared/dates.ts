export type RecurrenceInterval = 'daily' | 'weekly' | 'monthly'

/** Shift a YYYY-MM-DD date by whole days, without a timezone. */
export function shiftISODate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number)
  const [toYear, toMonth, toDay] = to.split('-').map(Number)
  const start = Date.UTC(fromYear, fromMonth - 1, fromDay)
  const end = Date.UTC(toYear, toMonth - 1, toDay)
  return Math.round((end - start) / 86_400_000)
}

function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const index = month - 1 + months
  const nextYear = year + Math.floor(index / 12)
  const nextMonth = index % 12
  const last = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate()
  const nextDay = Math.min(day, last)
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth + 1).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`
}

export function addRecurrence(iso: string, recurrence: RecurrenceInterval): string {
  if (recurrence === 'daily') return shiftISODate(iso, 1)
  if (recurrence === 'weekly') return shiftISODate(iso, 7)
  return addMonths(iso, 1)
}

/**
 * Due date for the occurrence after `dueDate`.
 * The result is always after `today`, so finishing today's task does not
 * drop another copy onto Today. `today` is the caller's local calendar day.
 */
export function nextOccurrenceDate(
  dueDate: string | null | undefined,
  recurrence: RecurrenceInterval,
  today: string,
): string {
  const base = dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : today
  if (recurrence === 'monthly') {
    let next = addMonths(base, 1)
    for (let i = 0; i < 2400 && next <= today; i += 1) next = addMonths(next, 1)
    return next
  }
  const step = recurrence === 'daily' ? 1 : 7
  const first = shiftISODate(base, step)
  if (first > today) return first
  const jumps = Math.floor(daysBetween(first, today) / step) + 1
  return shiftISODate(first, jumps * step)
}
