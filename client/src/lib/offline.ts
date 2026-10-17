import { onlineManager } from '@tanstack/react-query'
import { queryClient } from '../queryClient.ts'
import { refreshSession } from './refresh.ts'
import type { DashboardData, OpenTask, Project, Task, TodayData, TodayTask } from '../api/types.ts'

export type QueuedWrite = {
  id: string
  userId: string
  path: string
  method: string
  body?: string
  match?: string
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

const PROBE_STEPS_MS = [1000, 2000, 4000, 8000, 16000, 30000]
const HEALTHY_PROBE_MS = 30_000
const FLUSH_TIMEOUT_MS = 8_000

let ownerId: string | null = null
let unreachable = false
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
  return unreachable
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

function signature(item: { userId: string; method: string; path: string; body?: string; match?: string }): string {
  return `${item.userId}|${item.method}|${item.path}|${item.body ?? ''}|${item.match ?? ''}`
}

function clientIdOf(item: { body?: string }): string | null {
  if (!item.body) return null
  try {
    const body = JSON.parse(item.body) as { clientId?: unknown }
    return typeof body.clientId === 'string' && body.clientId ? body.clientId : null
  } catch {
    return null
  }
}

function dedupe(items: QueuedWrite[]): QueuedWrite[] {
  const seen = new Set<string>()
  const next: QueuedWrite[] = []
  for (const item of items) {
    const clientId = clientIdOf(item)
    const key = clientId ? `client:${item.userId}:${clientId}` : signature(item)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
  }
  return next
}

function withClientId(item: QueuedWrite): QueuedWrite {
  if (item.method !== 'POST' || !/^\/api\/projects\/[^/]+\/tasks$/.test(item.path) || !item.body) return item
  if (clientIdOf(item)) return item
  try {
    const body = JSON.parse(item.body) as Record<string, unknown>
    return { ...item, body: JSON.stringify({ ...body, clientId: crypto.randomUUID() }) }
  } catch {
    return item
  }
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
        match: typeof record.match === 'string' ? record.match : undefined,
        attempts: typeof record.attempts === 'number' ? record.attempts : 0,
        lastError: typeof record.lastError === 'string' ? record.lastError : undefined,
      })
    }
    return dedupe(items)
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

export function enqueueWrite(input: { path: string; method: string; body?: string; match?: string }): string {
  if (!ownerId) throw new Error('offline-owner')
  const items = readQueue()
  const next = { userId: ownerId, path: input.path, method: input.method, body: input.body, match: input.match }
  const nextClientId = clientIdOf(next)
  const existing = items.find(
    (item) => signature(item) === signature(next) || (nextClientId !== null && clientIdOf(item) === nextClientId && item.userId === ownerId),
  )
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
      version: 0,
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

async function runFlush(signal: AbortSignal): Promise<FlushResult> {
  const owned = mine(dedupe(readQueue())).map(withClientId)
  const stamped = owned.filter((item) => {
    const previous = readQueue().find((entry) => entry.id === item.id)
    return previous && previous.body !== item.body
  })
  if (stamped.length > 0) {
    const stampedIds = new Map(stamped.map((item) => [item.id, item]))
    writeQueue(dedupe(readQueue().map((entry) => stampedIds.get(entry.id) ?? entry)))
  }
  // navigator.onLine is not consulted. DevTools can leave it false after the
  // network is back; a successful fetch is what marks the network up.
  if (owned.length === 0) {
    return { synced: 0, rejected: [] }
  }
  const left: QueuedWrite[] = []
  const rejected: string[] = []
  let synced = 0
  let stop = false
  for (const item of owned) {
    if (stop || signal.aborted) {
      left.push(item)
      stop = true
      continue
    }
    try {
      const send = () => {
        const request = new AbortController()
        const timer = window.setTimeout(() => request.abort(), FLUSH_TIMEOUT_MS)
        const onAbort = () => request.abort()
        signal.addEventListener('abort', onAbort, { once: true })
        return fetch(item.path, {
          method: item.method,
          credentials: 'include',
          keepalive: true,
          cache: 'no-store',
          signal: request.signal,
          headers: {
            Accept: 'application/json',
            ...(item.body ? { 'Content-Type': 'application/json' } : {}),
            ...(item.match ? { 'If-Match': item.match } : {}),
          },
          body: item.body,
        }).finally(() => {
          window.clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
        })
      }
      let response = await send()
      if (response.status === 401) {
        const refreshed = await refreshSession()
        if (!refreshed) {
          left.push({ ...item, attempts: item.attempts + 1, lastError: 'Sign in to finish syncing this change.' })
          stop = true
          continue
        }
        response = await send()
        if (response.status === 401) {
          left.push({ ...item, attempts: item.attempts + 1, lastError: 'Sign in to finish syncing this change.' })
          stop = true
          continue
        }
      }
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
      if (signal.aborted) {
        left.push(item)
        stop = true
        continue
      }
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

let flushTail: Promise<void> = Promise.resolve()
let flushAbort: AbortController | null = null

function abortInFlightFlush() {
  flushAbort?.abort()
}

export function noteNetworkSuccess(options?: { trusted?: boolean }): void {
  if (options?.trusted) {
    if (unreachable) abortInFlightFlush()
    onlineManager.setOnline(true)
    markReachable()
    probeStep = 0
  }
  if (queuedCount() > 0) void flushOfflineQueue()
}

/** One flush at a time. Interval, online, and load kicks share this lock. */
export function flushOfflineQueue(): Promise<FlushResult> {
  const controller = new AbortController()
  flushAbort = controller
  const run = flushTail.then(async () => {
    emitFlush({ phase: 'start' })
    let synced = 0
    const rejected: string[] = []
    try {
      const result = await runFlush(controller.signal)
      synced = result.synced
      rejected.push(...result.rejected)
      if (synced > 0) {
        onlineManager.setOnline(true)
        markReachable()
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ['tasks'] }),
          queryClient.invalidateQueries({ queryKey: ['today'] }),
          queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        ]).finally(() => healSyncedTasks())
      }
      return { synced, rejected }
    } finally {
      if (flushAbort === controller) flushAbort = null
      emitFlush({ phase: 'end', result: { synced, rejected } })
    }
  })
  flushTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

let syncStarted = false
let probeStep = 0
let probeTimer: number | undefined
let probeInFlight = false
let lastProbeAt = 0

function healthUp(body: unknown, ok: boolean): boolean {
  if (!ok || !body || typeof body !== 'object') return false
  return (body as { db?: unknown }).db === 'up'
}

function clearProbeTimer() {
  if (probeTimer !== undefined) {
    window.clearTimeout(probeTimer)
    probeTimer = undefined
  }
}

function scheduleProbe(delay: number) {
  clearProbeTimer()
  probeTimer = window.setTimeout(() => {
    probeTimer = undefined
    void runProbe()
  }, delay)
}

/** Reachability probe. Failures wait 1s, 2s, 4s, … 30s. The online event starts over. */
async function runProbe() {
  if (probeInFlight) return
  probeInFlight = true
  lastProbeAt = Date.now()
  clearProbeTimer()
  let ok = false
  try {
    // The query keeps a cached /api/health from matching. The worker does not
    // intercept this URL; a hit header is still not the network.
    const response = await fetch(`/api/health?t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4_000),
    })
    if (response.headers.get('X-Align-Cache') === 'hit') {
      ok = false
    } else {
      const body: unknown = await response.json().catch(() => null)
      ok = healthUp(body, response.ok)
    }
  } catch {
    ok = false
  } finally {
    probeInFlight = false
  }
  if (ok) {
    if (unreachable) markReachable()
    probeStep = 0
    if (queuedCount() > 0) void flushOfflineQueue()
    scheduleProbe(queuedCount() > 0 ? PROBE_STEPS_MS[0] : HEALTHY_PROBE_MS)
    return
  }
  markUnreachable()
  const delay = PROBE_STEPS_MS[Math.min(probeStep, PROBE_STEPS_MS.length - 1)]
  probeStep = Math.min(probeStep + 1, PROBE_STEPS_MS.length - 1)
  scheduleProbe(delay)
}

function resetProbe(force = false) {
  probeStep = 0
  if (probeInFlight) return
  if (!force && probeTimer !== undefined && Date.now() - lastProbeAt < 800) return
  void runProbe()
}

/** Flush queued writes independently of the status bar's React lifecycle. */
export function startOfflineSync() {
  if (syncStarted || typeof window === 'undefined') return
  syncStarted = true
  window.addEventListener('online', () => {
    abortInFlightFlush()
    resetProbe(true)
  })
  window.addEventListener('offline', () => {
    const alreadyDown = unreachable
    markUnreachable()
    if (probeInFlight) return
    if (alreadyDown && probeTimer !== undefined && Date.now() - lastProbeAt < 800) return
    probeStep = 0
    void runProbe()
  })
  onlineManager.subscribe((online) => {
    if (online) resetProbe()
  })
  void runProbe()
}
