import { onlineManager } from '@tanstack/react-query'
import { queryClient } from '../queryClient.ts'
import type { DashboardData, OpenTask, Project, Task, TodayData, TodayTask } from '../api/types.ts'

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
let queueVersion = 0
const queueListeners = new Set<() => void>()

function touchQueue() {
  queueVersion += 1
  for (const listener of queueListeners) listener()
}

export function subscribeQueue(listener: () => void): () => void {
  queueListeners.add(listener)
  return () => queueListeners.delete(listener)
}

export function getQueueVersion(): number {
  return queueVersion
}

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
  touchQueue()
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
  const queued = { id, ...next, attempts: 0 }
  items.push(queued)
  try {
    writeQueue(items.slice(-40))
  } catch {
    throw new Error('offline-full')
  }
  seedQueuedTask(queued)
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

function queuedTask(item: QueuedWrite): Task | null {
  if (item.method !== 'POST' || !item.body) return null
  const match = /^\/api\/projects\/([^/]+)\/tasks$/.exec(item.path)
  if (!match) return null
  try {
    const body = JSON.parse(item.body) as { title?: unknown; dueDate?: unknown; priority?: unknown; labelIds?: unknown; plannedFor?: unknown }
    if (typeof body.title !== 'string' || !body.title.trim()) return null
    const priority = body.priority
    return {
      id: `queued:${item.id}`,
      projectId: match[1],
      title: body.title,
      completed: false,
      dueDate: typeof body.dueDate === 'string' ? body.dueDate : null,
      priority: priority === 'low' || priority === 'high' || priority === 'urgent' || priority === 'medium' ? priority : 'medium',
      labelIds: Array.isArray(body.labelIds) ? body.labelIds.filter((id): id is string => typeof id === 'string') : [],
      plannedFor: typeof body.plannedFor === 'string' ? body.plannedFor : null,
      completedOn: null,
      order: -1,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

function isAdoptedTemp(id: string): boolean {
  return id.startsWith('queued:') && adopted.has(id.slice('queued:'.length))
}

function projectNameFor(projectId: string): string {
  const lists = queryClient.getQueriesData<Project[]>({ queryKey: ['projects'] })
  for (const [, projects] of lists) {
    const found = projects?.find((project) => project.id === projectId)
    if (found) return found.name
  }
  return ''
}

function replaceQueuedId(value: unknown, localId: string, server: Task): unknown {
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const mapped = replaceQueuedId(item, localId, server)
      if (mapped !== item) changed = true
      return mapped
    })
    return changed ? next : value
  }
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record.id === localId) {
    return typeof record.projectName === 'string' ? { ...server, projectName: record.projectName } : { ...server }
  }
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(record)) {
    const mapped = replaceQueuedId(child, localId, server)
    next[key] = mapped
    if (mapped !== child) changed = true
  }
  return changed ? next : value
}

function placeToday(current: TodayData, task: Task, projectName: string, dropIds: string[]): TodayData {
  const drop = (items: TodayTask[] | undefined) => (items ?? []).filter((entry) => !dropIds.includes(entry.id))
  const row: TodayTask = { ...task, projectName }
  const planned = drop(current.planned)
  const available = drop(current.available)
  const carried = drop(current.carried)
  const overdue = drop(current.overdue)
  const finished = drop(current.finished)
  if (task.completed) finished.push(row)
  else if (task.plannedFor === current.date) planned.push(row)
  else available.push(row)
  return { ...current, planned, carried, overdue, available, finished }
}

function seedQueuedTask(item: QueuedWrite) {
  const task = queuedTask(item)
  if (!task) return
  const name = projectNameFor(task.projectId)
  queryClient.setQueryData<Task[]>(['tasks', task.projectId], (current) => {
    const list = (current ?? []).filter((entry) => entry.id !== task.id)
    return [task, ...list]
  })
  queryClient.setQueriesData<TodayData>({ queryKey: ['today'] }, (current) =>
    current ? placeToday(current, task, name || projectNameFor(task.projectId), [task.id]) : current,
  )
  queryClient.setQueryData<DashboardData>(['dashboard'], (current) => {
    if (!current || task.completed) return current
    const openTasks = current.openTasks.filter((entry) => entry.id !== task.id)
    const row: OpenTask = {
      id: task.id,
      projectId: task.projectId,
      projectName: name,
      title: task.title,
      dueDate: task.dueDate,
      priority: task.priority,
      completed: false,
    }
    return { ...current, openTasks: [row, ...openTasks] }
  })
}

function dropTemp(localId: string) {
  queryClient.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (current) =>
    Array.isArray(current) ? current.filter((entry) => entry.id !== localId) : current,
  )
  queryClient.setQueriesData<TodayData>({ queryKey: ['today'] }, (current) => {
    if (!current) return current
    const drop = (items: TodayTask[] | undefined) => (items ?? []).filter((entry) => entry.id !== localId)
    return {
      ...current,
      planned: drop(current.planned),
      carried: drop(current.carried),
      overdue: drop(current.overdue),
      available: drop(current.available),
      finished: drop(current.finished),
    }
  })
  queryClient.setQueryData<DashboardData>(['dashboard'], (current) =>
    current ? { ...current, openTasks: current.openTasks.filter((entry) => entry.id !== localId) } : current,
  )
}

async function keepSyncedTask(item: QueuedWrite, response: Response) {
  if (item.method !== 'POST' || !/^\/api\/projects\/[^/]+\/tasks$/.test(item.path)) return
  const localId = `queued:${item.id}`
  adopted.add(item.id)
  let task: Task | null = null
  try {
    const body: unknown = await response.clone().json()
    if (isTask(body)) task = body
  } catch {
    task = null
  }
  if (!task) {
    dropTemp(localId)
    return
  }
  landed.push({ localId, task })
  await queryClient.cancelQueries({ queryKey: ['tasks'] })
  await queryClient.cancelQueries({ queryKey: ['today'] })
  await queryClient.cancelQueries({ queryKey: ['dashboard'] })
  const name = projectNameFor(task.projectId)
  const swap = (current: unknown) => replaceQueuedId(current, localId, task)
  queryClient.setQueriesData({ queryKey: ['tasks'] }, swap)
  queryClient.setQueriesData({ queryKey: ['today'] }, swap)
  queryClient.setQueriesData({ queryKey: ['dashboard'] }, swap)
  queryClient.setQueryData<Task[]>(['tasks', task.projectId], (current) => {
    const list = (current ?? []).filter((entry) => entry.id !== localId && entry.id !== task.id)
    return [task, ...list]
  })
  queryClient.setQueriesData<TodayData>({ queryKey: ['today'] }, (current) => {
    if (!current) return current
    const named = [...current.planned, ...current.carried, ...(current.overdue ?? []), ...current.available, ...(current.finished ?? [])].find(
      (entry) => entry.id === localId || entry.id === task.id,
    )
    return placeToday(current, task, named?.projectName || name, [localId, task.id])
  })
  queryClient.setQueryData<DashboardData>(['dashboard'], (current) => {
    if (!current) return current
    const previous = current.openTasks.find((entry) => entry.id === localId || entry.id === task.id)
    const openTasks = current.openTasks.filter((entry) => entry.id !== localId && entry.id !== task.id)
    if (task.completed) return { ...current, openTasks }
    const row: OpenTask = {
      id: task.id,
      projectId: task.projectId,
      projectName: previous?.projectName || name,
      title: task.title,
      dueDate: task.dueDate,
      priority: task.priority,
      completed: task.completed,
    }
    return { ...current, openTasks: [row, ...openTasks] }
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

const landed: { localId: string; task: Task }[] = []

function healSyncedTasks() {
  for (const { localId, task } of landed) {
    const name = projectNameFor(task.projectId)
    queryClient.setQueryData<Task[]>(['tasks', task.projectId], (current) => {
      const list = (current ?? []).filter((entry) => entry.id !== localId && entry.id !== task.id && !isAdoptedTemp(entry.id))
      return [task, ...list]
    })
    queryClient.setQueriesData<TodayData>({ queryKey: ['today'] }, (current) => {
      if (!current) return current
      const named = [...current.planned, ...current.carried, ...(current.overdue ?? []), ...current.available, ...(current.finished ?? [])].find(
        (entry) => entry.id === localId || entry.id === task.id,
      )
      return placeToday(current, task, named?.projectName || name, [localId, task.id])
    })
    queryClient.setQueryData<DashboardData>(['dashboard'], (current) => {
      if (!current) return current
      const previous = current.openTasks.find((entry) => entry.id === localId || entry.id === task.id)
      const openTasks = current.openTasks.filter((entry) => entry.id !== localId && entry.id !== task.id && !isAdoptedTemp(entry.id))
      if (task.completed) return { ...current, openTasks }
      const row: OpenTask = {
        id: task.id,
        projectId: task.projectId,
        projectName: previous?.projectName || name,
        title: task.title,
        dueDate: task.dueDate,
        priority: task.priority,
        completed: task.completed,
      }
      return { ...current, openTasks: [row, ...openTasks] }
    })
  }
}

async function runFlush(): Promise<FlushResult> {
  const items = readQueue()
  const owned = mine(items)
  // Try even when navigator.onLine is still false. DevTools can leave that
  // flag stuck after the network is back, and a reload was the only flush.
  if (owned.length === 0) {
    return { synced: 0, rejected: [] }
  }
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
  const failed = new Map(left.map((entry) => [entry.id, entry]))
  const finished = new Set(owned.filter((entry) => !failed.has(entry.id)).map((entry) => entry.id))
  const next: QueuedWrite[] = []
  for (const entry of readQueue()) {
    if (finished.has(entry.id)) continue
    next.push(failed.get(entry.id) ?? entry)
  }
  for (const entry of left) {
    if (!next.some((item) => item.id === entry.id)) next.push(entry)
  }
  writeQueue(next)
  healSyncedTasks()
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
        // A completed write means the network is up, even when DevTools left
        // navigator.onLine false. Queries refetch only while onlineManager agrees.
        if (result.synced > 0) onlineManager.setOnline(true)
      } while (again)
      if (synced > 0) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ['tasks'] }),
          queryClient.invalidateQueries({ queryKey: ['today'] }),
          queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        ]).finally(() => healSyncedTasks())
      }
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
