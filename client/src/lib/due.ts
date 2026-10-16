export type DueState = 'overdue' | 'today' | 'soon' | 'later' | 'none'

export function shiftISODate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function localISODate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function daysUntil(dueDate: string, today = localISODate()): number {
  const [year, month, day] = dueDate.split('-').map(Number)
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number)
  const due = Date.UTC(year, month - 1, day)
  const start = Date.UTC(todayYear, todayMonth - 1, todayDay)
  return Math.round((due - start) / 86_400_000)
}

export function dueState(dueDate: string | null | undefined, today = localISODate()): DueState {
  if (!dueDate) return 'none'
  const days = daysUntil(dueDate, today)
  if (Number.isNaN(days)) return 'none'
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days === 1) return 'soon'
  return 'later'
}

export function isUpcoming(dueDate: string | null | undefined, today = localISODate()): boolean {
  if (!dueDate) return false
  const days = daysUntil(dueDate, today)
  return days <= 7
}
