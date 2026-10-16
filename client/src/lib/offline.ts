export type QueuedWrite = {
  id: string
  path: string
  method: string
  body?: string
}

const KEY = 'align-offline-queue'
export const QUEUE_EVENT = 'align-offline-queue'

function readQueue(): QueuedWrite[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is QueuedWrite =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as QueuedWrite).id === 'string' &&
        typeof (item as QueuedWrite).path === 'string' &&
        typeof (item as QueuedWrite).method === 'string',
    )
  } catch {
    return []
  }
}

function writeQueue(items: QueuedWrite[]) {
  localStorage.setItem(KEY, JSON.stringify(items))
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: items.length }))
}

export function queuedCount(): number {
  return readQueue().length
}

export function enqueueWrite(input: { path: string; method: string; body?: string }) {
  const items = readQueue()
  items.push({ id: crypto.randomUUID(), path: input.path, method: input.method, body: input.body })
  try {
    writeQueue(items.slice(-40))
  } catch {
    throw new Error('offline-full')
  }
}

export async function flushOfflineQueue(): Promise<number> {
  const items = readQueue()
  if (items.length === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 0
  const left: QueuedWrite[] = []
  let synced = 0
  for (const item of items) {
    try {
      const response = await fetch(item.path, {
        method: item.method,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(item.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: item.body,
      })
      if (response.ok || (response.status >= 400 && response.status < 500)) synced += 1
      else left.push(item)
    } catch {
      left.push(item)
      break
    }
  }
  writeQueue(left)
  return synced
}
