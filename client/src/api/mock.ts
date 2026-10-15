import { ApiError } from './errors.ts'
import type {
  AlignApi,
  DashboardData,
  Label,
  Note,
  Project,
  ProjectStatus,
  SearchResults,
  Task,
  TaskPriority,
  User,
} from './types.ts'

/**
 * localStorage stand-in for the Align API.
 * Passwords are stored in plain text here on purpose — the real API hashes them
 * with bcrypt and never returns them. Session state mimics the httpOnly cookie.
 */

const STORAGE_KEY = 'align.db.v1'
const DELAY_MS = 120

type StoredUser = User & { password: string }
type StoredProject = Project & { userId: string }
type StoredTask = Task & { userId: string }
type StoredNote = Note & { userId: string }
type StoredLabel = Label & { userId: string }

type Db = {
  users: StoredUser[]
  projects: StoredProject[]
  tasks: StoredTask[]
  notes: StoredNote[]
  labels: StoredLabel[]
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
    (record.labels === undefined || Array.isArray(record.labels))
  )
}

function seed(): Db {
  const created = '2026-04-02T15:00:00.000Z'
  const userId = 'usr_demo'
  const website = 'prj_website'
  const launch = 'prj_launch'
  const archive = 'prj_archive'

  return {
    sessionUserId: null,
    users: [
      {
        id: userId,
        name: 'Alex Rivera',
        email: 'demo@align.app',
        password: 'password',
        createdAt: created,
      },
    ],
    projects: [
      {
        id: website,
        userId,
        name: 'Website refresh',
        description: 'Quiet redesign of the marketing site. Fewer pages, clearer writing.',
        status: 'active',
        createdAt: '2026-09-02T15:00:00.000Z',
        updatedAt: '2026-10-12T18:30:00.000Z',
      },
      {
        id: launch,
        userId,
        name: 'October release',
        description: 'Checklist for the launch: notes, changelog, and the walkthrough.',
        status: 'active',
        createdAt: '2026-10-01T15:00:00.000Z',
        updatedAt: '2026-10-13T16:00:00.000Z',
      },
      {
        id: archive,
        userId,
        name: 'Brand workshop',
        description: 'Identity exercises from last year. Kept for reference.',
        status: 'archived',
        createdAt: '2025-11-14T15:00:00.000Z',
        updatedAt: '2025-12-02T15:00:00.000Z',
      },
    ],
    tasks: [
      task(userId, website, 'tsk_audit', 'Audit the current pages', true, null, 1, '2026-09-03T15:00:00.000Z'),
      task(userId, website, 'tsk_home', 'Rewrite the homepage', true, null, 2, '2026-09-18T15:00:00.000Z'),
      task(userId, website, 'tsk_type', 'Set type and color tokens', false, '2026-10-18', 3, '2026-10-08T15:00:00.000Z'),
      task(userId, website, 'tsk_cut', 'Remove unused sections', false, '2026-10-22', 4, '2026-10-10T15:00:00.000Z'),
      task(userId, launch, 'tsk_log', 'Write the changelog', false, '2026-10-16', 1, '2026-10-02T15:00:00.000Z'),
      task(userId, launch, 'tsk_note', 'Draft the launch note', false, '2026-10-17', 2, '2026-10-04T15:00:00.000Z'),
      task(userId, launch, 'tsk_video', 'Record the walkthrough', true, null, 3, '2026-10-06T15:00:00.000Z'),
    ],
    labels: [],
    notes: [
      note(
        userId,
        website,
        'nte_home',
        'Homepage direction',
        'Lead with the product, not the company story.\n\nKeep the first screen to a single sentence and one action. Move the feature grid below the fold, and cut the logo carousel.\n\nOpen questions:\n- Do we still need a pricing page for the beta?\n- Photography vs. product UI crops.',
        '2026-10-11T15:00:00.000Z',
      ),
      note(
        userId,
        website,
        'nte_nav',
        'Navigation notes',
        'Primary nav: Product, Notes, Pricing, Sign in.\n\nDrop the blog from the header until there are three posts worth reading.',
        '2026-10-09T15:00:00.000Z',
      ),
      note(
        userId,
        launch,
        'nte_tone',
        'Launch tone',
        'Tone: calm and specific. Say what shipped, who it helps, and what is intentionally not in this release.\n\nAvoid “excited to announce”.',
        '2026-10-13T15:00:00.000Z',
      ),
      note(
        userId,
        archive,
        'nte_brand',
        'Workshop summary',
        'The workshop settled on a black-and-white system and a single typeface. Color comes later, if at all.',
        '2025-11-20T15:00:00.000Z',
      ),
    ],
  }
}

function task(
  userId: string,
  projectId: string,
  id: string,
  title: string,
  completed: boolean,
  dueDate: string | null,
  order: number,
  createdAt: string,
): StoredTask {
  return {
    id,
    userId,
    projectId,
    title,
    completed,
    dueDate,
    priority: 'medium',
    labelIds: [],
    order,
    createdAt,
    updatedAt: createdAt,
  }
}

function note(
  userId: string,
  projectId: string,
  id: string,
  title: string,
  body: string,
  createdAt: string,
): StoredNote {
  return { id, userId, projectId, title, body, createdAt, updatedAt: createdAt }
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
        for (const item of memory.tasks) {
          item.priority ??= 'medium'
          item.labelIds ??= []
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

function publicUser(user: StoredUser): User {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt }
}

function publicProject(project: StoredProject): Project {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
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
    order: item.order,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

function publicLabel(item: StoredLabel): Label {
  return { id: item.id, name: item.name, color: item.color, createdAt: item.createdAt }
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
  if (!value || value.length < 8) throw new ApiError(400, `${label} must be at least 8 characters.`)
  if (value.length > 128) throw new ApiError(400, `${label} is too long.`)
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
      throw new ApiError(409, 'An account with this email already exists.')
    }
    const user: StoredUser = {
      id: uid('usr'),
      name,
      email,
      password: input.password,
      createdAt: now(),
    }
    state.users.push(user)
    state.sessionUserId = user.id
    persist()
    return publicUser(user)
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

  async me() {
    await wait()
    const state = load()
    return publicUser(requireUser(state))
  },

  async updateProfile(input) {
    return write((_state, user) => {
      user.name = requireName(input.name ?? '', 'Name', 80)
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
      return publicProject(project)
    })
  },

  async getProject(id) {
    return read((state, user) => publicProject(findProject(state, user.id, id)))
  },

  async updateProject(id, input) {
    return write((state, user) => {
      const project = findProject(state, user.id, id)
      if (input.name !== undefined) project.name = requireName(input.name, 'Project name', 120)
      if (input.description !== undefined) project.description = input.description.trim().slice(0, 2000)
      project.updatedAt = now()
      return publicProject(project)
    })
  },

  async archiveProject(id) {
    return write((state, user) => {
      const project = findProject(state, user.id, id)
      const next: ProjectStatus = project.status === 'active' ? 'archived' : 'active'
      project.status = next
      project.updatedAt = now()
      return publicProject(project)
    })
  },

  async deleteProject(id) {
    await write((state, user) => {
      findProject(state, user.id, id)
      state.projects = state.projects.filter((project) => project.id !== id)
      state.tasks = state.tasks.filter((item) => item.projectId !== id)
      state.notes = state.notes.filter((item) => item.projectId !== id)
    })
  },

  async listTasks(projectId) {
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
        completed: false,
        dueDate: dueDateOf(input.dueDate) ?? null,
        priority: priorityOf(input.priority),
        labelIds: labelsOf(state, user.id, input.labelIds),
        order,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      state.tasks.push(item)
      touchProject(state, projectId)
      return publicTask(item)
    })
  },

  async updateTask(id, input) {
    return write((state, user) => {
      const item = findTask(state, user.id, id)
      if (input.title !== undefined) item.title = requireName(input.title, 'Task title', 200)
      if (input.completed !== undefined) {
        if (typeof input.completed !== 'boolean') throw new ApiError(400, 'Completed must be true or false.')
        item.completed = input.completed
      }
      if (input.dueDate !== undefined) item.dueDate = dueDateOf(input.dueDate) ?? null
      if (input.priority !== undefined) item.priority = priorityOf(input.priority)
      if (input.labelIds !== undefined) item.labelIds = labelsOf(state, user.id, input.labelIds)
      if (input.order !== undefined) {
        if (!Number.isFinite(input.order)) throw new ApiError(400, 'Order must be a number.')
        item.order = input.order
      }
      item.updatedAt = now()
      touchProject(state, item.projectId)
      return publicTask(item)
    })
  },

  async deleteTask(id) {
    await write((state, user) => {
      const item = findTask(state, user.id, id)
      state.tasks = state.tasks.filter((taskItem) => taskItem.id !== id)
      touchProject(state, item.projectId)
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
      return publicLabel(label)
    })
  },

  async updateLabel(id, input) {
    return write((state, user) => {
      const label = state.labels.find((item) => item.id === id && item.userId === user.id)
      if (!label) throw new ApiError(404, 'Label not found.')
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
      return publicNote(item)
    })
  },

  async getNote(id) {
    return read((state, user) => publicNote(findNote(state, user.id, id)))
  },

  async updateNote(id, input) {
    return write((state, user) => {
      const item = findNote(state, user.id, id)
      if (input.title !== undefined) item.title = requireName(input.title, 'Title', 160)
      if (input.body !== undefined) item.body = input.body.slice(0, 100_000)
      item.updatedAt = now()
      touchProject(state, item.projectId)
      return publicNote(item)
    })
  },

  async deleteNote(id) {
    await write((state, user) => {
      const item = findNote(state, user.id, id)
      state.notes = state.notes.filter((noteItem) => noteItem.id !== id)
      touchProject(state, item.projectId)
    })
  },

  async getDashboard() {
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
      }
      return data
    })
  },

  async search(query) {
    return read((state, user) => {
      const needle = query.trim().toLowerCase()
      const empty: SearchResults = { projects: [], tasks: [], notes: [] }
      if (!needle) return empty

      const projects = state.projects.filter((project) => project.userId === user.id)
      const projectName = new Map(projects.map((project) => [project.id, project.name]))
      const includes = (value: string) => value.toLowerCase().includes(needle)

      return {
        projects: sortByUpdated(projects.filter((project) => includes(project.name) || includes(project.description)))
          .slice(0, 50)
          .map(publicProject),
        tasks: state.tasks
          .filter((item) => item.userId === user.id && includes(item.title) && projectName.has(item.projectId))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 50)
          .map((item) => ({
            id: item.id,
            projectId: item.projectId,
            projectName: projectName.get(item.projectId) ?? '',
            title: item.title,
            completed: item.completed,
          })),
        notes: sortByUpdated(
          state.notes.filter(
            (item) =>
              item.userId === user.id &&
              projectName.has(item.projectId) &&
              (includes(item.title) || includes(item.body)),
          ),
        )
          .slice(0, 50)
          .map((item) => ({
            id: item.id,
            projectId: item.projectId,
            projectName: projectName.get(item.projectId) ?? '',
            title: item.title,
            body: item.body,
          })),
      }
    })
  },
} satisfies AlignApi
