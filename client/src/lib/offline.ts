import { onlineManager } from '@tanstack/react-query'
import { queryClient } from '../queryClient.ts'
import type { Task, TodayData, TodayTask } from '../api/types.ts'

export type QueuedWrite = {
  id: string
  userId: string
  path: string
  method: string
  body?: string
  attempts: number
  lastError?: string
}

export type FlushResult = {
  synced: number
  rejected: string[]
}

const KEY = 'align-offline-queue'
const adopted = new Set<string>()
export const QUEUE_EVENT = 'align-offline-queue'
export const REACH_EVENT = 'align-reachability'
export const FLUSH_EVENT = 'align-offline-flush'

const RETRY_MS = 10_000
const FLUSH_TIMEOUT_MS = 8_000

let ownerId: string | null = null
let unreachable = false
let flushPromise: Promise<FlushResult> | null = null

export function setQueueOwner(userId: string | null) {
  ownerId = userId
}

export function isUnreachable(): boolean {
  return unreachable || (typeof navigator !== 'undefined' && navigator.onLine === false)
}

export function markUnreachable() {
  if (unreachable) return
  unreachable = true
  window.dispatchEvent(new CustomEvent(REACH_EVENT))
}

export function markReachable() {
  if (!unreachable) return
  unreachable = false
  window.dispatchEvent(new CustomEvent(REACH_EVENT))
}

function signature(item: { userId: string; method: string; path: string; body?: string }): string {
  return `${item.userId}|${item.method}|${item.path}|${item.body ?? ''}`
}

function readQueue(): QueuedWrite[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const items: QueuedWrite[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const record = item as Partial<QueuedWrite>
      if (typeof record.path !== 'string' || typeof record.method !== 'string') continue
      const userId = typeof record.userId === 'string' ? record.userId : ownerId
      if (!userId) continue
      items.push({
        id: typeof record.id === 'string' ? record.id : crypto.randomUUID(),
        userId,
        path: record.path,
        method: record.method,
        body: typeof record.body === 'string' ? record.body : undefined,
        attempts: typeof record.attempts === 'number' ? record.attempts : 0,
        lastError: typeof record.lastError === 'string' ? record.lastError : undefined,
      })
    }
    return items
  } catch {
    return []
  }
}

function writeQueue(items: QueuedWrite[]) {
  localStorage.setItem(KEY, JSON.stringify(items))
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: items.length }))
}

function mine(items = readQueue()): QueuedWrite[] {
  if (!ownerId) return []
  return items.filter((item) => item.userId === ownerId)
}

export function queuedCount(): number {
  return mine().length
}

export function queueFailure(): string | null {
  return mine().find((item) => item.lastError)?.lastError ?? null
}

export function enqueueWrite(input: { path: string; method: string; body?: string }): string {
  if (!ownerId) throw new Error('offline-owner')
  const items = readQueue()
  const next = { userId: ownerId, path: input.path, method: input.method, body: input.body }
  const existing = items.find((item) => signature(item) === signature(next))
  if (existing) return existing.id
  const id = crypto.randomUUID()
  items.push({ id, ...next, attempts: 0 })
  try {
    writeQueue(items.slice(-40))
  } catch {
    throw new Error('offline-full')
  }
  return id
}

export function dropQueuedWrite(id: string) {
  writeQueue(readQueue().filter((item) => item.id !== id))
}

export function clearQueueForUser(userId: string) {
  writeQueue(readQueue().filter((item) => item.userId !== userId))
}

export type PendingTaskCreate = {
  id: string
  projectId: string
  title: string
  dueDate: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  labelIds: string[]
  plannedFor: string | null
}

export function pendingTaskCreates(): PendingTaskCreate[] {
  const pending: PendingTaskCreate[] = []
  for (const item of mine()) {
    if (item.method !== 'POST' || adopted.has(item.id)) continue
    const match = /^\/api\/projects\/([^/]+)\/tasks$/.exec(item.path)
    if (!match || !item.body) continue
    try {
      const body = JSON.parse(item.body) as {
        title?: unknown
        dueDate?: unknown
        priority?: unknown
        labelIds?: unknown
        plannedFor?: unknown
      }
      if (typeof body.title !== 'string' || !body.title.trim()) continue
      const priority = body.priority
      pending.push({
        id: `queued:${item.id}`,
        projectId: match[1],
        title: body.title,
        dueDate: typeof body.dueDate === 'string' ? body.dueDate : null,
        priority: priority === 'low' || priority === 'high' || priority === 'urgent' || priority === 'medium' ? priority : 'medium',
        labelIds: Array.isArray(body.labelIds) ? body.labelIds.filter((id): id is string => typeof id === 'string') : [],
        plannedFor: typeof body.plannedFor === 'string' ? body.plannedFor : null,
      })
    } catch {
      // Ignore a corrupt queue entry; flush will drop it if the server rejects it.
    }
  }
  return pending
}

function isTask(value: unknown): value is Task {
  if (!value || typeof value !== 'object') return false
  const task = value as Task
  return typeof task.id === 'string' && typeof task.title === 'string' && typeof task.projectId === 'string'
}

async function keepSyncedTask(item: QueuedWrite, response: Response) {
  if (item.method !== 'POST' || !/^\/api\/projects\/[^/]+\/tasks$/.test(item.path)) return
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return
  }
  if (!isTask(body)) return
  adopted.add(item.id)
  const task = body
  const localId = `queued:${item.id}`
  queryClient.setQueryData<Task[]>(['tasks', task.projectId], (current) => {
    const list = (current ?? []).filter((entry) => entry.id !== localId && entry.id !== task.id)
    return [task, ...list]
  })
  queryClient.setQueriesData<TodayData>({ queryKey: ['today'] }, (current) => {
    if (!current) return current
    const named = [...current.planned, ...current.carried, ...(current.overdue ?? []), ...current.available, ...(current.finished ?? [])].find(
      (entry) => entry.id === localId,
    )
    const row: TodayTask = { ...task, projectName: named?.projectName ?? '' }
    const strip = (items: TodayTask[] | undefined) => (items ?? []).filter((entry) => entry.id !== localId && entry.id !== task.id)
    const planned = strip(current.planned)
    const available = strip(current.available)
    if (task.plannedFor === current.date && !task.completed) planned.push(row)
    else if (!task.completed) available.push(row)
    return {
      ...current,
      planned,
      carried: strip(current.carried),
      overdue: strip(current.overdue),
      available,
      finished: task.completed ? [...strip(current.finished), row] : strip(current.finished),
    }
  })
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json()
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') return data.error
  } catch {
    // Non-JSON bodies use the fallback below.
  }
  return `Couldn’t sync a saved change (${response.status}).`
}

async function runFlush(): Promise<FlushResult> {
  const items = readQueue()
  const owned = mine(items)
  // Try even when navigator.onLine is still false. DevTools can leave that
  // flag stuck after the network is back, and a reload was the only flush.
  if (owned.length === 0) {
    return { synced: 0, rejected: [] }
  }
  const others = items.filter((item) => item.userId !== ownerId)
  const left: QueuedWrite[] = []
  const rejected: string[] = []
  let synced = 0
  let stop = false
  for (const item of owned) {
    if (stop) {
      left.push(item)
      continue
    }
    try {
      const response = await fetch(item.path, {
        method: item.method,
        credentials: 'include',
        keepalive: true,
        cache: 'no-store',
        signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
        headers: {
          Accept: 'application/json',
          ...(item.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: item.body,
      })
      if (response.ok) {
        try {
          await keepSyncedTask(item, response)
        } catch {
          // The server accepted the write. Drop the queue entry either way.
        }
        synced += 1
        continue
      }
      if (response.status >= 400 && response.status < 500) {
        rejected.push(await errorMessage(response))
        continue
      }
      left.push({ ...item, attempts: item.attempts + 1, lastError: `Server error (${response.status}). Will retry.` })
    } catch {
      markUnreachable()
      left.push({ ...item, attempts: item.attempts + 1, lastError: 'Still offline. Will retry.' })
      stop = true
    }
  }
  writeQueue([...others, ...left])
  if (synced > 0 && left.length === 0) markReachable()
  return { synced, rejected }
}

function emitFlush(detail: { phase: 'start' | 'end'; result?: FlushResult }) {
  window.dispatchEvent(new CustomEvent(FLUSH_EVENT, { detail }))
}

async function confirmReachable(): Promise<void> {
  if (!unreachable) return
  try {
    const response = await fetch(`/api/auth/session?reach=${Date.now()}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
    })
    if (response.ok) markReachable()
  } catch {
    // Still offline. The banner stays until a later attempt succeeds.
  }
}

let again = false

export function flushOfflineQueue(): Promise<FlushResult> {
  if (flushPromise) {
    again = true
    return flushPromise
  }
  flushPromise = (async () => {
    emitFlush({ phase: 'start' })
    let synced = 0
    const rejected: string[] = []
    try {
      do {
        again = false
        const result = await runFlush()
        synced += result.synced
        rejected.push(...result.rejected)
      } while (again)
      if (synced > 0) void queryClient.invalidateQueries()
      return { synced, rejected }
    } finally {
      emitFlush({ phase: 'end', result: { synced, rejected } })
    }
  })().finally(() => {
    flushPromise = null
  })
  return flushPromise
}

let syncStarted = false

function kickOfflineSync() {
  if (queuedCount() > 0) {
    void flushOfflineQueue()
    return
  }
  void confirmReachable()
}

/** Flush queued writes independently of the banner's React lifecycle. */
export function startOfflineSync() {
  if (syncStarted || typeof window === 'undefined') return
  syncStarted = true
  window.addEventListener('online', kickOfflineSync)
  window.addEventListener('offline', () => {
    markUnreachable()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kickOfflineSync()
  })
  onlineManager.subscribe((online) => {
    if (online) kickOfflineSync()
  })
  window.setInterval(() => {
    if (queuedCount() === 0 && !unreachable) return
    kickOfflineSync()
  }, RETRY_MS)
  kickOfflineSync()
}
