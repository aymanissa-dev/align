import { CONFLICT_MESSAGE } from '../../../shared/contract.ts'
import { nextOccurrenceDate } from '../../../shared/dates.ts'
import { matchesAllTokens, relevanceScore, searchTokens } from '../../../shared/search.ts'
import { isMediumPassword, MEDIUM_PASSWORD_MESSAGE } from '../lib/passwordStrength.ts'
import { ApiError } from './errors.ts'
import type {
  AlignApi,
  ActivityEvent,
  ActivityType,
  AppNotification,
  DashboardData,
  Label,
  Note,
  NotificationKind,
  Project,
  ProjectStatus,
  SearchResults,
  Task,
  TaskPriority,
  TodayData,
  User,
  WhiteboardScene,
  WriteOpts,
} from './types.ts'

/**
 * localStorage stand-in for the Align API.
 * Passwords are stored in plain text here on purpose — the real API hashes them
 * with bcrypt and never returns them. Session state mimics the httpOnly cookie.
 */

const STORAGE_KEY = 'align.db.v2'
const DELAY_MS = 120

type StoredUser = User & { password: string; recoveryKey?: string | null }
type StoredProject = Omit<Project, 'version'> & { userId: string; version?: number }
type StoredTask = Omit<Task, 'version'> & { userId: string; clientId?: string; version?: number }
type StoredNote = Omit<Note, 'version'> & { userId: string; version?: number }
type StoredLabel = Omit<Label, 'version'> & { userId: string; version?: number }
type StoredActivity = ActivityEvent & { userId: string }
type StoredNotification = AppNotification & { userId: string; key: string }
type StoredBoard = { userId: string; projectId: string; scene: WhiteboardScene }

type Db = {
  users: StoredUser[]
  projects: StoredProject[]
  tasks: StoredTask[]
  notes: StoredNote[]
  labels: StoredLabel[]
  activities: StoredActivity[]
  notifications: StoredNotification[]
  whiteboards: StoredBoard[]
  sessionUserId: string | null
}

let memory: Db | null = null

function wait(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, DELAY_MS)
  })
}

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

function now(): string {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function isDb(value: unknown): value is Db {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<Db>
  return (
    Array.isArray(record.users) &&
    Array.isArray(record.projects) &&
    Array.isArray(record.tasks) &&
    Array.isArray(record.notes) &&
    (record.labels === undefined || Array.isArray(record.labels)) &&
    (record.activities === undefined || Array.isArray(record.activities)) &&
    (record.notifications === undefined || Array.isArray(record.notifications)) &&
    (record.whiteboards === undefined || Array.isArray(record.whiteboards))
  )
}

function seed(): Db {
  return {
    sessionUserId: null,
    users: [],
    projects: [],
    tasks: [],
    notes: [],
    labels: [],
    activities: [],
    notifications: [],
    whiteboards: [],
  }
}

function load(): Db {
  if (memory) return memory
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isDb(parsed)) {
        memory = parsed
        memory.sessionUserId ??= null
        memory.labels ??= []
        memory.activities ??= []
        memory.notifications ??= []
        memory.whiteboards ??= []
        for (const item of memory.tasks) {
          item.priority ??= 'medium'
          item.labelIds ??= []
          item.plannedFor ??= null
          item.subtasks ??= []
          item.recurrence ??= null
          item.status ??= item.completed ? 'done' : 'todo'
        }
        return memory
      }
    }
  } catch {
    // Ignore unreadable storage and start fresh.
  }
  memory = seed()
  persist()
  return memory
}

function persist(): void {
  if (!memory) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
  } catch {
    // Private mode or a full disk: keep the in-memory copy for this session.
  }
}

function bump(item: { version?: number }, opts?: WriteOpts) {
  const current = item.version ?? 0
  if (opts && !opts.overwrite && opts.version !== undefined && opts.version !== current) {
    throw new ApiError(409, CONFLICT_MESSAGE)
  }
  item.version = current + 1
}

function publicUser(user: StoredUser): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    accent: user.accent || '#171717',
    createdAt: user.createdAt,
  }
}

function publicProject(project: StoredProject): Project {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    version: project.version ?? 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }
}

function publicTask(item: StoredTask): Task {
  return {
    id: item.id,
    projectId: item.projectId,
    title: item.title,
    completed: item.completed,
    dueDate: item.dueDate,
    priority: item.priority ?? 'medium',
    labelIds: item.labelIds ?? [],
    plannedFor: item.plannedFor ?? null,
    completedOn: item.completedOn ?? null,
    order: item.order,
    status: item.completed ? 'done' : item.status === 'doing' ? 'doing' : 'todo',
    recurrence: item.recurrence === 'daily' || item.recurrence === 'weekly' || item.recurrence === 'monthly' ? item.recurrence : null,
    subtasks: Array.isArray(item.subtasks) ? item.subtasks : [],
    version: item.version ?? 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function publicLabel(item: StoredLabel): Label {
  return { id: item.id, name: item.name, color: item.color, version: item.version ?? 0, createdAt: item.createdAt }
}

function colorOf(value: string | undefined): string {
  const color = (value ?? '').trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new ApiError(400, 'Choose a color.')
  return color.toLowerCase()
}

function publicNote(item: StoredNote): Note {
  return {
    id: item.id,
    projectId: item.projectId,
    title: item.title,
    body: item.body,
    version: item.version ?? 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function requireUser(state: Db): StoredUser {
  const user = state.users.find((item) => item.id === state.sessionUserId)
  if (!user) throw new ApiError(401, 'Sign in to continue.')
  return user
}

function findProject(state: Db, userId: string, id: string): StoredProject {
  const project = state.projects.find((item) => item.id === id && item.userId === userId)
  if (!project) throw new ApiError(404, 'Project not found.')
  return project
}

function findTask(state: Db, userId: string, id: string): StoredTask {
  const item = state.tasks.find((taskItem) => taskItem.id === id && taskItem.userId === userId)
  if (!item) throw new ApiError(404, 'Task not found.')
  return item
}

function findNote(state: Db, userId: string, id: string): StoredNote {
  const item = state.notes.find((noteItem) => noteItem.id === id && noteItem.userId === userId)
  if (!item) throw new ApiError(404, 'Note not found.')
  return item
}

function emailOf(value: string): string {
  return value.trim().toLowerCase()
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function requireName(value: string, label: string, max: number): string {
  const name = value.trim()
  if (!name) throw new ApiError(400, `${label} is required.`)
  if (name.length > max) throw new ApiError(400, `${label} is too long.`)
  return name
}

function requirePassword(value: string, label = 'Password'): string {
  if (!value || value.length > 128) throw new ApiError(400, value && value.length > 128 ? `${label} is too long.` : MEDIUM_PASSWORD_MESSAGE)
  if (!isMediumPassword(value)) throw new ApiError(400, MEDIUM_PASSWORD_MESSAGE)
  return value
}

const PRIORITY_VALUES = new Set<TaskPriority>(['low', 'medium', 'high', 'urgent'])

function priorityOf(value: string | undefined): TaskPriority {
  if (value === undefined) return 'medium'
  if (!PRIORITY_VALUES.has(value as TaskPriority)) {
    throw new ApiError(400, 'Priority must be low, medium, high, or urgent.')
  }
  return value as TaskPriority
}

function labelsOf(state: Db, userId: string, ids: string[] | undefined): string[] {
  if (!ids || ids.length === 0) return []
  if (ids.length > 12) throw new ApiError(400, 'Too many labels.')
  const unique = [...new Set(ids)]
  const owned = new Set(state.labels.filter((label) => label.userId === userId).map((label) => label.id))
  if (unique.some((id) => !owned.has(id))) throw new ApiError(400, 'Unknown label.')
  return unique
}

function dueDateOf(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400, 'Use a valid due date.')
  return value
}

function quoteTitle(title: string): string {
  return `“${title}”`
}

function pushActivity(state: Db, userId: string, projectId: string, type: ActivityType, summary: string): void {
  state.activities.push({ id: uid('act'), userId, projectId, type, summary, createdAt: now() })
}

function shiftISODate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function syncNotifications(state: Db, userId: string, today: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new ApiError(400, 'Use a valid date.')
  const tomorrow = shiftISODate(today, 1)
  for (const task of state.tasks) {
    if (task.userId !== userId || task.completed || !task.dueDate) continue
    const kind: NotificationKind | null = task.dueDate < today ? 'overdue' : task.dueDate <= tomorrow ? 'due-soon' : null
    if (!kind) continue
    const key = `${task.id}:${kind}:${task.dueDate}`
    const project = state.projects.find((item) => item.id === task.projectId)
    const existing = state.notifications.find((item) => item.userId === userId && item.key === key)
    if (existing) {
      existing.title = task.title
      existing.projectName = project?.name ?? 'Project'
      continue
    }
    state.notifications.push({
      id: uid('ntf'),
      userId,
      key,
      projectId: task.projectId,
      taskId: task.id,
      kind,
      title: task.title,
      projectName: project?.name ?? 'Project',
      dueDate: task.dueDate,
      read: false,
      createdAt: now(),
    })
  }
}

function touchProject(state: Db, projectId: string): void {
  const project = state.projects.find((item) => item.id === projectId)
  if (project) project.updatedAt = now()
}

function sortByUpdated<T extends { updatedAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

async function read<T>(fn: (state: Db, user: StoredUser) => T): Promise<T> {
  await wait()
  const state = load()
  return clone(fn(state, requireUser(state)))
}

async function write<T>(fn: (state: Db, user: StoredUser) => T): Promise<T> {
  await wait()
  const state = load()
  const user = requireUser(state)
  const snapshot = clone(state)
  try {
    const result = fn(state, user)
    persist()
    return clone(result)
  } catch (error) {
    memory = snapshot
    throw error
  }
}

export const mockApi = {
  async register(input) {
    await wait()
    const state = load()
    const name = requireName(input.name ?? '', 'Name', 80)
    const email = emailOf(input.email ?? '')
    if (!validEmail(email)) throw new ApiError(400, 'Enter a valid email.')
    requirePassword(input.password ?? '')
    if (state.users.some((user) => user.email === email)) {
      throw new ApiError(409, "We couldn't create an account with those details.")
    }
    const recoveryKey = 'aaaa-bbbb-cccc-dddd-eeee-ffff-1111-2222'
    const user: StoredUser = {
      id: uid('usr'),
      name,
      email,
      accent: '#171717',
      password: input.password,
      recoveryKey,
      createdAt: now(),
    }
    state.users.push(user)
    state.sessionUserId = user.id
    persist()
    return { ...publicUser(user), recoveryKey }
  },

  async login(input) {
    await wait()
    const state = load()
    const email = emailOf(input.email ?? '')
    const user = state.users.find((item) => item.email === email && item.password === input.password)
    if (!user) throw new ApiError(401, 'Email or password is incorrect.')
    state.sessionUserId = user.id
    persist()
    return publicUser(user)
  },

  async logout() {
    await wait()
    const state = load()
    state.sessionUserId = null
    persist()
  },

  async authProviders() {
    return { google: false }
  },

  async listSessions() {
    await wait()
    const state = load()
    const user = requireUser(state)
    return [
      {
        id: 'local',
        current: true,
        device: 'This browser',
        lastSeenAt: now(),
        createdAt: user.createdAt,
      },
    ]
  },

  async revokeSession(id: string) {
    await wait()
    if (id !== 'local') return
    const state = load()
    state.sessionUserId = null
    persist()
  },

  async revokeAllSessions(_password?: string) {
    await wait()
    const state = load()
    state.sessionUserId = null
    persist()
  },

  async revokeOtherSessions(_password?: string) {
    await wait()
  },

  async me() {
    await wait()
    const state = load()
    return { ...publicUser(requireUser(state)), steppedUp: false }
  },

  async session() {
    await wait()
    const state = load()
    const user = state.users.find((item) => item.id === state.sessionUserId)
    return user ? publicUser(user) : null
  },

  async resetPassword(input) {
    await wait()
    const state = load()
    const password = requirePassword(input.password ?? '', 'New password')
    const email = emailOf(input.email ?? '')
    const user = state.users.find((item) => item.email === email)
    const presented = (input.recoveryKey ?? '').toLowerCase().replace(/[^a-f0-9]/g, '')
    const stored = (user?.recoveryKey ?? '').toLowerCase().replace(/[^a-f0-9]/g, '')
    if (!user || !presented || presented !== stored) throw new ApiError(400, "Those details don't match.")
    user.password = password
    const recoveryKey = 'bbbb-cccc-dddd-eeee-ffff-1111-2222-3333'
    user.recoveryKey = recoveryKey
    state.sessionUserId = user.id
    persist()
    return { ...publicUser(user), recoveryKey }
  },

  async createRecoveryKey() {
    await wait()
    const state = load()
    const user = requireUser(state)
    const recoveryKey = 'dddd-eeee-ffff-1111-2222-3333-4444-5555'
    user.recoveryKey = recoveryKey
    persist()
    return { recoveryKey }
  },

  async updateProfile(input) {
    return write((_state, user) => {
      if (input.name === undefined && input.accent === undefined) throw new ApiError(400, 'Nothing to update.')
      if (input.name !== undefined) user.name = requireName(input.name, 'Name', 80)
      if (input.accent !== undefined) {
        if (!/^#[0-9a-fA-F]{6}$/.test(input.accent.trim())) throw new ApiError(400, 'Choose a color.')
        user.accent = input.accent.trim().toLowerCase()
      }
      return publicUser(user)
    })
  },

  async changePassword(input) {
    await write((_state, user) => {
      if (user.password !== input.currentPassword) {
        throw new ApiError(400, 'Current password is incorrect.')
      }
      user.password = requirePassword(input.newPassword ?? '', 'New password')
    })
  },

  async deleteAccount() {
    await write((state, user) => {
      const projectIds = new Set(
        state.projects.filter((project) => project.userId === user.id).map((project) => project.id),
      )
      state.projects = state.projects.filter((project) => project.userId !== user.id)
      state.tasks = state.tasks.filter((item) => item.userId !== user.id && !projectIds.has(item.projectId))
      state.notes = state.notes.filter((item) => item.userId !== user.id && !projectIds.has(item.projectId))
      state.labels = state.labels.filter((item) => item.userId !== user.id)
      state.activities = state.activities.filter((item) => item.userId !== user.id)
      state.notifications = state.notifications.filter((item) => item.userId !== user.id)
      state.whiteboards = state.whiteboards.filter((item) => item.userId !== user.id)
      state.users = state.users.filter((item) => item.id !== user.id)
      state.sessionUserId = null
    })
  },

  async listProjects(params?) {
    return read((state, user) => {
      const status = params?.status
      return sortByUpdated(
        state.projects.filter(
          (project) => project.userId === user.id && (!status || project.status === status),
        ),
      ).map(publicProject)
    })
  },

  async createProject(input) {
    return write((state, user) => {
      const timestamp = now()
      const project: StoredProject = {
        id: uid('prj'),
        userId: user.id,
        name: requireName(input.name ?? '', 'Project name', 120),
        description: (input.description ?? '').trim().slice(0, 2000),
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      state.projects.push(project)
      pushActivity(state, user.id, project.id, 'create', `Created project ${quoteTitle(project.name)}`)
      return publicProject(project)
    })
  },

  async getProject(id) {
    return read((state, user) => publicProject(findProject(state, user.id, id)))
  },

  async updateProject(id, input, opts) {
    return write((state, user) => {
      const project = findProject(state, user.id, id)
      bump(project, opts)
      if (input.name !== undefined) project.name = requireName(input.name, 'Project name', 120)
      if (input.description !== undefined) project.description = input.description.trim().slice(0, 2000)
      project.updatedAt = now()
      pushActivity(state, user.id, project.id, 'update', `Updated project ${quoteTitle(project.name)}`)
      return publicProject(project)
    })
  },

  async archiveProject(id, opts) {
    return write((state, user) => {
      const project = findProject(state, user.id, id)
      bump(project, opts)
      const next: ProjectStatus = project.status === 'active' ? 'archived' : 'active'
      project.status = next
      project.updatedAt = now()
      pushActivity(
        state,
        user.id,
        project.id,
        'update',
        next === 'archived' ? `Archived project ${quoteTitle(project.name)}` : `Restored project ${quoteTitle(project.name)}`,
      )
      return publicProject(project)
    })
  },

  async deleteProject(id) {
    await write((state, user) => {
      findProject(state, user.id, id)
      const taskIds = new Set(state.tasks.filter((item) => item.projectId === id).map((item) => item.id))
      state.projects = state.projects.filter((project) => project.id !== id)
      state.tasks = state.tasks.filter((item) => item.projectId !== id)
      state.notes = state.notes.filter((item) => item.projectId !== id)
      state.activities = state.activities.filter((item) => item.projectId !== id)
      state.notifications = state.notifications.filter((item) => !taskIds.has(item.taskId))
      state.whiteboards = state.whiteboards.filter((item) => item.projectId !== id)
    })
  },

  async listTasks(projectId, _init?: RequestInit) {
    return read((state, user) => {
      findProject(state, user.id, projectId)
      return state.tasks
        .filter((item) => item.projectId === projectId && item.userId === user.id)
        .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
        .map(publicTask)
    })
  },

  async createTask(projectId, input) {
    return write((state, user) => {
      if (input.clientId) {
        const existing = state.tasks.find((item) => item.userId === user.id && item.clientId === input.clientId)
        if (existing) return publicTask(existing)
      }
      findProject(state, user.id, projectId)
      const title = requireName(input.title ?? '', 'Task title', 200)
      const siblings = state.tasks.filter((item) => item.projectId === projectId)
      const order = siblings.reduce((max, item) => Math.max(max, item.order), 0) + 1
      const timestamp = now()
      const item: StoredTask = {
        id: uid('tsk'),
        userId: user.id,
        projectId,
        title,
        completed: input.status === 'done',
        dueDate: dueDateOf(input.dueDate) ?? null,
        priority: priorityOf(input.priority),
        labelIds: labelsOf(state, user.id, input.labelIds),
        plannedFor: dueDateOf(input.plannedFor) ?? null,
        completedOn: input.status === 'done' ? new Date().toISOString().slice(0, 10) : null,
        order,
        createdAt: timestamp,
        updatedAt: timestamp,
        clientId: input.clientId,
        status: input.status === 'doing' || input.status === 'done' ? input.status : 'todo',
        recurrence: input.recurrence ?? null,
        subtasks: input.subtasks ?? [],
      }
      state.tasks.push(item)
      touchProject(state, projectId)
      pushActivity(state, user.id, projectId, 'create', `Created task ${quoteTitle(item.title)}`)
      return publicTask(item)
    })
  },

  async updateTask(id, input, opts) {
    return write((state, user) => {
      const item = findTask(state, user.id, id)
      bump(item, opts)
      const wasCompleted = item.completed
      if (input.title !== undefined) item.title = requireName(input.title, 'Task title', 200)
      if (input.completed !== undefined) {
        if (typeof input.completed !== 'boolean') throw new ApiError(400, 'Completed must be true or false.')
        item.completed = input.completed
        item.completedOn = input.completed ? (dueDateOf(input.completedOn) ?? item.completedOn ?? new Date().toISOString().slice(0, 10)) : null
      }
      if (input.dueDate !== undefined) item.dueDate = dueDateOf(input.dueDate) ?? null
      if (input.priority !== undefined) item.priority = priorityOf(input.priority)
      if (input.labelIds !== undefined) item.labelIds = labelsOf(state, user.id, input.labelIds)
      if (input.plannedFor !== undefined) item.plannedFor = dueDateOf(input.plannedFor) ?? null
      if (input.order !== undefined) {
        if (!Number.isFinite(input.order)) throw new ApiError(400, 'Order must be a number.')
        item.order = input.order
      }
      if (input.recurrence !== undefined) item.recurrence = input.recurrence
      if (input.subtasks !== undefined) item.subtasks = input.subtasks
      if (input.status !== undefined && input.completed === undefined) {
        item.status = input.status
        item.completed = input.status === 'done'
        item.completedOn = item.completed ? (dueDateOf(input.completedOn) ?? item.completedOn ?? new Date().toISOString().slice(0, 10)) : null
      } else if (input.completed !== undefined) {
        item.status = input.completed ? 'done' : input.status === 'doing' ? 'doing' : 'todo'
      } else if (input.status !== undefined) {
        item.status = input.status
      }
      item.updatedAt = now()
      touchProject(state, item.projectId)
      const justFinished = !wasCompleted && item.completed
      const requestedFinish = input.completed === true || (input.status === 'done' && input.completed !== false)
      let spawnedTask: StoredTask | null = null
      if (item.completed && item.recurrence && (justFinished || (requestedFinish && wasCompleted))) {
        const today = item.completedOn && /^\d{4}-\d{2}-\d{2}$/.test(item.completedOn) ? item.completedOn : new Date().toISOString().slice(0, 10)
        const spawnKey = `recur:${item.id}:${today}`
        const recurrence = item.recurrence
        if (
          (recurrence === 'daily' || recurrence === 'weekly' || recurrence === 'monthly') &&
          !state.tasks.some((task) => task.userId === user.id && task.clientId === spawnKey)
        ) {
          const siblings = state.tasks.filter((task) => task.projectId === item.projectId)
          const timestamp = now()
          const spawned: StoredTask = {
            id: uid('tsk'),
            userId: user.id,
            projectId: item.projectId,
            title: item.title,
            completed: false,
            dueDate: nextOccurrenceDate(item.dueDate, recurrence, today),
            priority: item.priority,
            labelIds: [...item.labelIds],
            plannedFor: null,
            completedOn: null,
            order: siblings.reduce((max, task) => Math.max(max, task.order), 0) + 1,
            createdAt: timestamp,
            updatedAt: timestamp,
            clientId: spawnKey,
            status: 'todo',
            recurrence,
            subtasks: (item.subtasks ?? []).map((subtask) => ({ id: crypto.randomUUID(), text: subtask.text, completed: false })),
          }
          state.tasks.push(spawned)
          spawnedTask = spawned
          pushActivity(state, user.id, item.projectId, 'create', `Created task ${quoteTitle(item.title)}`)
        }
      }
      pushActivity(
        state,
        user.id,
        item.projectId,
        justFinished ? 'complete' : 'update',
        justFinished ? `Completed task ${quoteTitle(item.title)}` : `Updated task ${quoteTitle(item.title)}`,
      )
      if (item.completed) {
        state.notifications = state.notifications.filter((note) => !(note.taskId === item.id && note.kind === 'overdue'))
      }
      const body = publicTask(item)
      return spawnedTask ? { ...body, spawned: publicTask(spawnedTask) } : body
    })
  },

  async deleteTask(id) {
    await write((state, user) => {
      const item = findTask(state, user.id, id)
      state.tasks = state.tasks.filter((taskItem) => taskItem.id !== id)
      state.notifications = state.notifications.filter((note) => note.taskId !== id)
      touchProject(state, item.projectId)
      pushActivity(state, user.id, item.projectId, 'delete', `Deleted task ${quoteTitle(item.title)}`)
    })
  },

  async listLabels() {
    return read((state, user) =>
      state.labels
        .filter((label) => label.userId === user.id)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(publicLabel),
    )
  },

  async createLabel(input) {
    return write((state, user) => {
      const name = requireName(input.name ?? '', 'Label name', 40)
      const color = colorOf(input.color)
      if (state.labels.some((label) => label.userId === user.id && label.name.toLowerCase() === name.toLowerCase())) {
        throw new ApiError(409, 'A label with that name already exists.')
      }
      const label: StoredLabel = { id: uid('lbl'), userId: user.id, name, color, createdAt: now() }
      state.labels.push(label)
      pushActivity(state, user.id, '', 'create', `Created label ${quoteTitle(label.name)}`)
      return publicLabel(label)
    })
  },

  async updateLabel(id, input, opts) {
    return write((state, user) => {
      const label = state.labels.find((item) => item.id === id && item.userId === user.id)
      if (!label) throw new ApiError(404, 'Label not found.')
      bump(label, opts)
      if (input.name !== undefined) {
        const name = requireName(input.name, 'Label name', 40)
        if (
          state.labels.some(
            (item) => item.userId === user.id && item.id !== id && item.name.toLowerCase() === name.toLowerCase(),
          )
        ) {
          throw new ApiError(409, 'A label with that name already exists.')
        }
        label.name = name
      }
      if (input.color !== undefined) label.color = colorOf(input.color)
      pushActivity(state, user.id, '', 'update', `Updated label ${quoteTitle(label.name)}`)
      return publicLabel(label)
    })
  },

  async deleteLabel(id) {
    await write((state, user) => {
      const label = state.labels.find((item) => item.id === id && item.userId === user.id)
      if (!label) throw new ApiError(404, 'Label not found.')
      state.labels = state.labels.filter((item) => item.id !== id)
      for (const task of state.tasks) {
        if (task.userId === user.id) task.labelIds = task.labelIds.filter((labelId) => labelId !== id)
      }
      pushActivity(state, user.id, '', 'delete', `Deleted label ${quoteTitle(label.name)}`)
    })
  },

  async listNotes() {
    return read((state, user) =>
      sortByUpdated(state.notes.filter((item) => item.userId === user.id)).map(publicNote),
    )
  },

  async listProjectNotes(projectId) {
    return read((state, user) => {
      findProject(state, user.id, projectId)
      return sortByUpdated(
        state.notes.filter((item) => item.userId === user.id && item.projectId === projectId),
      ).map(publicNote)
    })
  },

  async createNote(projectId, input) {
    return write((state, user) => {
      findProject(state, user.id, projectId)
      const timestamp = now()
      const item: StoredNote = {
        id: uid('nte'),
        userId: user.id,
        projectId,
        title: requireName(input.title?.trim() ? input.title : 'Untitled', 'Title', 160),
        body: (input.body ?? '').slice(0, 100_000),
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      state.notes.push(item)
      touchProject(state, projectId)
      pushActivity(state, user.id, projectId, 'create', `Created note ${quoteTitle(item.title)}`)
      return publicNote(item)
    })
  },

  async getNote(id) {
    return read((state, user) => publicNote(findNote(state, user.id, id)))
  },

  async updateNote(id, input, opts) {
    return write((state, user) => {
      const item = findNote(state, user.id, id)
      bump(item, opts)
      if (input.title !== undefined) item.title = requireName(input.title, 'Title', 160)
      if (input.body !== undefined) item.body = input.body.slice(0, 100_000)
      item.updatedAt = now()
      touchProject(state, item.projectId)
      pushActivity(state, user.id, item.projectId, 'update', `Updated note ${quoteTitle(item.title)}`)
      return publicNote(item)
    })
  },

  async deleteNote(id) {
    await write((state, user) => {
      const item = findNote(state, user.id, id)
      state.notes = state.notes.filter((noteItem) => noteItem.id !== id)
      touchProject(state, item.projectId)
      pushActivity(state, user.id, item.projectId, 'delete', `Deleted note ${quoteTitle(item.title)}`)
    })
  },

  async listActivity(projectId) {
    return read((state, user) => {
      findProject(state, user.id, projectId)
      return state.activities
        .filter((item) => item.userId === user.id && (item.projectId === projectId || item.projectId === ''))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ userId: _userId, ...item }) => item)
    })
  },

  async getWhiteboard(projectId) {
    return read((state, user) => {
      findProject(state, user.id, projectId)
      const board = state.whiteboards.find((item) => item.userId === user.id && item.projectId === projectId)
      return {
        scene: board?.scene ?? { strokes: [], shapes: [], texts: [], viewport: { x: 0, y: 0, scale: 1 } },
      }
    })
  },

  async saveWhiteboard(projectId, scene) {
    return write((state, user) => {
      findProject(state, user.id, projectId)
      if (!scene || !Array.isArray(scene.strokes) || !scene.viewport) throw new ApiError(400, 'Whiteboard is invalid.')
      const existing = state.whiteboards.find((item) => item.userId === user.id && item.projectId === projectId)
      if (existing) existing.scene = scene
      else state.whiteboards.push({ userId: user.id, projectId, scene })
      return { scene }
    })
  },

  async listNotifications(today, _init?: { signal?: AbortSignal }) {
    return write((state, user) => {
      syncNotifications(state, user.id, today)
      return state.notifications
        .filter((item) => item.userId === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 50)
        .map(({ userId: _userId, key: _key, ...item }) => item)
    })
  },

  async markNotificationRead(id) {
    return write((state, user) => {
      const item = state.notifications.find((note) => note.id === id && note.userId === user.id)
      if (!item) throw new ApiError(404, 'Notification not found.')
      item.read = true
      const { userId: _userId, key: _key, ...rest } = item
      return rest
    })
  },

  async markAllNotificationsRead(_today: string) {
    await write((state, user) => {
      for (const item of state.notifications) {
        if (item.userId === user.id) item.read = true
      }
    })
  },

  async listCalendar(from, to, _init?: RequestInit) {
    return read((state, user) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
        throw new ApiError(400, 'Use a valid date range.')
      }
      const projects = state.projects.filter((project) => project.userId === user.id)
      const names = new Map(projects.map((project) => [project.id, project.name]))
      return state.tasks
        .filter((task) => task.userId === user.id && task.dueDate && task.dueDate >= from && task.dueDate <= to && names.has(task.projectId))
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.order - b.order)
        .map((task) => ({
          id: task.id,
          projectId: task.projectId,
          projectName: names.get(task.projectId) ?? '',
          title: task.title,
          completed: task.completed,
          dueDate: task.dueDate as string,
          priority: task.priority ?? 'medium',
          status: task.completed ? 'done' as const : task.status === 'doing' ? 'doing' as const : 'todo' as const,
          recurrence: task.recurrence === 'daily' || task.recurrence === 'weekly' || task.recurrence === 'monthly' ? task.recurrence : null,
        }))
    })
  },

  async getToday(date, _init?: RequestInit) {
    return read((state, user) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, 'Use a valid date.')
      const projects = state.projects.filter((project) => project.userId === user.id && project.status === 'active')
      const names = new Map(projects.map((project) => [project.id, project.name]))
      const visible = state.tasks.filter((task) => task.userId === user.id && names.has(task.projectId))
      const present = (task: StoredTask) => ({ ...publicTask(task), projectName: names.get(task.projectId) ?? '' })
      const plannedForDate = visible.filter((task) => task.plannedFor === date)
      const dueToday = visible.filter((task) => !task.completed && task.dueDate === date && task.plannedFor !== date)
      const planned = [...plannedForDate, ...dueToday]
      const overdue = visible.filter(
        (task) => !task.completed && Boolean(task.dueDate) && (task.dueDate ?? '') < date && task.plannedFor !== date,
      )
      const overdueIds = new Set(overdue.map((task) => task.id))
      const carried = visible.filter(
        (task) =>
          !task.completed &&
          Boolean(task.plannedFor) &&
          (task.plannedFor ?? '') < date &&
          !overdueIds.has(task.id) &&
          task.dueDate !== date &&
          !(task.dueDate && task.dueDate > date),
      )
      const taken = new Set([...planned, ...overdue, ...carried].map((task) => task.id))
      const data: TodayData = {
        date,
        planned: planned.map(present),
        carried: carried.map(present),
        overdue: overdue.map(present),
        available: visible.filter((task) => !task.completed && !taken.has(task.id)).map(present),
        finished: visible
          .filter((task) => task.completed && task.completedOn === date && task.plannedFor !== date)
          .map(present),
      }
      return data
    })
  },

  async getDashboard(_init?: RequestInit) {
    return read((state, user) => {
      const projects = sortByUpdated(
        state.projects.filter((project) => project.userId === user.id && project.status === 'active'),
      )
      const openTasks = state.tasks
        .filter((item) => item.userId === user.id && !item.completed)
        .flatMap((item) => {
          const project = projects.find((candidate) => candidate.id === item.projectId)
          if (!project) return []
          return [
            {
              id: item.id,
              projectId: item.projectId,
              projectName: project.name,
              title: item.title,
              dueDate: item.dueDate,
              priority: item.priority ?? 'medium',
              completed: false as const,
              recurrence: item.recurrence === 'daily' || item.recurrence === 'weekly' || item.recurrence === 'monthly' ? item.recurrence : null,
            },
          ]
        })
        .sort((a, b) => {
          if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
          if (a.dueDate) return -1
          if (b.dueDate) return 1
          return a.title.localeCompare(b.title)
        })

      const data: DashboardData = {
        projects: projects.map((project) => {
          const tasks = state.tasks.filter((item) => item.projectId === project.id)
          const completedCount = tasks.filter((item) => item.completed).length
          return {
            id: project.id,
            name: project.name,
            description: project.description,
            taskCount: tasks.length,
            completedCount,
            percentComplete: tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100),
          }
        }),
        openTasks,
        openTaskCount: openTasks.length,
        datedOpenCount: openTasks.filter((task) => task.dueDate).length,
      }
      return data
    })
  },

  async search(query) {
    return read((state, user) => {
      const tokens = searchTokens(query)
      const empty: SearchResults = { projects: [], tasks: [], notes: [] }
      if (!tokens) return empty

      const projects = state.projects.filter((project) => project.userId === user.id)
      const projectName = new Map(projects.map((project) => [project.id, project.name]))

      return {
        projects: projects
          .flatMap((project) => {
            if (!matchesAllTokens(tokens, project.name, project.description)) return []
            return [
              {
                project,
                score: relevanceScore(tokens, [
                  { text: project.name, weight: 5 },
                  { text: project.description, weight: 1 },
                ]),
              },
            ]
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 20)
          .map((item) => publicProject(item.project)),
        tasks: state.tasks
          .flatMap((item) => {
            if (item.userId !== user.id || !projectName.has(item.projectId) || !matchesAllTokens(tokens, item.title)) return []
            return [{ item, score: relevanceScore(tokens, [{ text: item.title, weight: 5 }]) }]
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 20)
          .map(({ item }) => ({
            id: item.id,
            projectId: item.projectId,
            projectName: projectName.get(item.projectId) ?? '',
            title: item.title,
            completed: item.completed,
          })),
        notes: state.notes
          .flatMap((item) => {
            if (item.userId !== user.id || !projectName.has(item.projectId) || !matchesAllTokens(tokens, item.title, item.body)) {
              return []
            }
            return [
              {
                item,
                score: relevanceScore(tokens, [
                  { text: item.title, weight: 5 },
                  { text: item.body, weight: 1 },
                ]),
              },
            ]
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 20)
          .map(({ item }) => ({
            id: item.id,
            projectId: item.projectId,
            projectName: projectName.get(item.projectId) ?? '',
            title: item.title,
            body: item.body,
          })),
      }
    })
  },
  async totpSetup(_password: string) {
    return { secret: 'MOCKSECRET', otpauth: 'otpauth://totp/Align:mock', qr: '' }
  },
  async totpConfirm(_code: string, _password: string) {
    return { recoveryCodes: ['abcde-fghij'] }
  },
  async totpDisable() {},
  async regenerateRecoveryCodes() {
    return { recoveryCodes: ['abcde-fghij'] }
  },
  async completeMfa() {
    const state = load()
    return publicUser(requireUser(state))
  },
  async stepUp() {},
  async listSecurityEvents() {
    return []
  },
  async renameSession(_id: string, name: string) {
    return { id: 'local', device: name }
  },
  async listPasskeys() {
    return []
  },
  async passkeyRegisterOptions() {
    return {}
  },
  async passkeyRegisterVerify() {},
  async passkeyDelete() {},
  async passkeyLoginOptions() {
    return {}
  },
  async passkeyLoginVerify() {
    const state = load()
    return publicUser(requireUser(state))
  },
  async passkeyStepUpOptions() {
    return {}
  },
  async passkeyStepUpVerify() {},
  async changeEmail(input: { email: string }) {
    await wait()
    const state = load()
    const user = requireUser(state)
    user.email = input.email
    persist()
    return publicUser(user)
  },
  async listTrash() {
    return { projects: [], tasks: [], notes: [] }
  },
  async restoreProject(id: string) {
    return { id, name: 'Restored' }
  },
  async restoreTask(id: string) {
    return { id, title: 'Restored' }
  },
  async restoreNote(id: string) {
    return { id, title: 'Restored' }
  },
  async purgeProject() {},
  async purgeTask() {},
  async purgeNote() {},
  async emptyTrash() {},
} satisfies AlignApi
