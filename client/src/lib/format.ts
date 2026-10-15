function parseDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
  }
  return new Date(value)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = parseDate(value)
  if (Number.isNaN(date.getTime())) return ''
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
}

export function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function isEvening(date = new Date()): boolean {
  return date.getHours() >= 17
}

export function greeting(date = new Date()): string {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function firstName(name: string): string {
  const [first] = name.trim().split(/\s+/)
  return first || name
}

export function excerpt(text: string, query = '', radius = 80): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  const needle = query.trim().toLowerCase()
  if (!needle) return clip(clean, 160)
  const index = clean.toLowerCase().indexOf(needle)
  if (index < 0) return clip(clean, 160)
  const start = Math.max(0, index - radius)
  const end = Math.min(clean.length, index + needle.length + radius)
  const slice = clean.slice(start, end)
  return `${start > 0 ? '…' : ''}${slice}${end < clean.length ? '…' : ''}`
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max).trimEnd()}…`
}
