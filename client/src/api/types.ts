/**
 * Client contract for Align.
 *
 * Paths match the server routes. JSON is the resource itself (or an array),
 * not an envelope. Errors are `{ "error": string }` with an HTTP error status.
 * Deletes return 204. Request bodies are the shared zod schemas.
 */
import type { z } from 'zod'
import type { HealthReport } from '../../../shared/contract.ts'
import type {
  labelCreateSchema,
  labelPatchSchema,
  loginSchema,
  noteCreateSchema,
  notePatchSchema,
  priorities,
  projectCreateSchema,
  projectPatchSchema,
  registerSchema,
  taskCreateSchema,
  taskPatchSchema,
} from '../../../shared/schemas.ts'

export type { HealthReport }

export type ProjectStatus = 'active' | 'archived'
export type TaskPriority = (typeof priorities)[number]

export type User = {
  id: string
  name: string
  email: string
  accent: string
  emailVerified?: boolean
  createdAt: string
}

export type AuthSession = {
  id: string
  current: boolean
  device: string
  lastSeenAt: string
  createdAt: string
}

export type AuthProviders = {
  google: boolean
}

export type VerifyLink = {
  message: string
  verifyToken?: string
}

export type Project = {
  id: string
  name: string
  description: string
  status: ProjectStatus
  createdAt: string
  updatedAt: string
}

export type ActivityType = 'create' | 'update' | 'delete' | 'complete'
export type NotificationKind = 'due-soon' | 'overdue'

export type ActivityEvent = {
  id: string
  projectId: string
  type: ActivityType
  summary: string
  createdAt: string
}

export type AppNotification = {
  id: string
  projectId: string
  taskId: string
  kind: NotificationKind
  title: string
  projectName: string
  dueDate: string
  read: boolean
  createdAt: string
}

export type Label = {
  id: string
  name: string
  color: string
  createdAt: string
}

export type Task = {
  id: string
  projectId: string
  title: string
  completed: boolean
  dueDate: string | null
  priority: TaskPriority
  labelIds: string[]
  plannedFor: string | null
  completedOn: string | null
  order: number
  createdAt: string
  updatedAt: string
}

export type Note = {
  id: string
  projectId: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

export type DashboardProject = {
  id: string
  name: string
  description: string
  percentComplete: number
  completedCount: number
  taskCount: number
}

export type OpenTask = {
  id: string
  projectId: string
  projectName: string
  title: string
  dueDate: string | null
  priority: TaskPriority
  completed: boolean
}

export type WhiteboardPoint = { x: number; y: number }

export type WhiteboardScene = {
  strokes: {
    id: string
    tool: 'pen' | 'eraser'
    points: WhiteboardPoint[]
    color: string
    width: number
  }[]
  shapes: {
    id: string
    kind: 'rect' | 'ellipse'
    x: number
    y: number
    w: number
    h: number
    color: string
  }[]
  texts: { id: string; x: number; y: number; text: string; color: string }[]
  viewport: { x: number; y: number; scale: number }
}

export type TodayTask = Task & { projectName: string }

export type TodayData = {
  date: string
  planned: TodayTask[]
  carried: TodayTask[]
  overdue: TodayTask[]
  available: TodayTask[]
  finished: TodayTask[]
}

export type DashboardData = {
  projects: DashboardProject[]
  openTasks: OpenTask[]
  openTaskCount: number
}

export type SearchTask = {
  id: string
  projectId: string
  projectName: string
  title: string
  completed: boolean
}

export type SearchNote = {
  id: string
  projectId: string
  projectName: string
  title: string
  body: string
}

export type SearchResults = {
  projects: Project[]
  tasks: SearchTask[]
  notes: SearchNote[]
}

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type ProjectInput = z.infer<typeof projectCreateSchema>
export type ProjectPatch = z.infer<typeof projectPatchSchema>
export type TaskInput = z.infer<typeof taskCreateSchema>
export type TaskPatch = z.infer<typeof taskPatchSchema>

export type ResetResult = {
  message: string
  resetToken?: string
}

export type LabelInput = z.infer<typeof labelCreateSchema>
export type LabelPatch = z.infer<typeof labelPatchSchema>
export type NoteInput = z.infer<typeof noteCreateSchema>
export type NotePatch = z.infer<typeof notePatchSchema>

export interface AlignApi {
  /** POST /api/auth/register */
  register(input: RegisterInput): Promise<User>
  /** POST /api/auth/login */
  login(input: LoginInput): Promise<User>
  /** POST /api/auth/logout */
  logout(): Promise<void>
  /** GET /api/auth/providers */
  authProviders(): Promise<AuthProviders>
  /** POST /api/auth/verify */
  verifyEmail(token: string): Promise<User>
  /** POST /api/auth/verify/send */
  sendVerification(): Promise<VerifyLink>
  /** GET /api/auth/sessions */
  listSessions(): Promise<AuthSession[]>
  /** DELETE /api/auth/sessions/:id */
  revokeSession(id: string): Promise<void>
  /** POST /api/auth/sessions/revoke-all */
  revokeAllSessions(): Promise<void>
  /** GET /api/auth/session — 200 even when signed out */
  session(): Promise<User | null>
  /** POST /api/auth/forgot */
  forgotPassword(email: string): Promise<ResetResult>
  /** POST /api/auth/reset */
  resetPassword(input: { token: string; password: string }): Promise<User>
  /** GET /api/auth/me */
  me(): Promise<User>
  /** PATCH /api/auth/me */
  updateProfile(input: { name?: string; accent?: string }): Promise<User>
  /** POST /api/auth/password */
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>
  /** DELETE /api/auth/me */
  deleteAccount(): Promise<void>

  /** GET /api/projects */
  listProjects(params?: { status?: ProjectStatus }): Promise<Project[]>
  /** POST /api/projects */
  createProject(input: ProjectInput): Promise<Project>
  /** GET /api/projects/:id */
  getProject(id: string): Promise<Project>
  /** PATCH /api/projects/:id */
  updateProject(id: string, input: ProjectPatch): Promise<Project>
  /** PATCH /api/projects/:id/archive — toggles active and archived */
  archiveProject(id: string): Promise<Project>
  /** DELETE /api/projects/:id — also deletes the project's tasks and notes */
  deleteProject(id: string): Promise<void>

  /** GET /api/projects/:id/tasks */
  listTasks(projectId: string, init?: RequestInit): Promise<Task[]>
  /** POST /api/projects/:id/tasks */
  createTask(projectId: string, input: TaskInput): Promise<Task>
  /** PATCH /api/tasks/:id */
  updateTask(id: string, input: TaskPatch): Promise<Task>
  /** DELETE /api/tasks/:id */
  deleteTask(id: string): Promise<void>

  /** GET /api/labels */
  listLabels(): Promise<Label[]>
  /** POST /api/labels */
  createLabel(input: LabelInput): Promise<Label>
  /** PATCH /api/labels/:id */
  updateLabel(id: string, input: LabelPatch): Promise<Label>
  /** DELETE /api/labels/:id */
  deleteLabel(id: string): Promise<void>

  /** GET /api/notes */
  listNotes(): Promise<Note[]>
  /** GET /api/projects/:id/notes */
  listProjectNotes(projectId: string): Promise<Note[]>
  /** POST /api/projects/:id/notes */
  createNote(projectId: string, input: NoteInput): Promise<Note>
  /** GET /api/notes/:id */
  getNote(id: string): Promise<Note>
  /** PATCH /api/notes/:id */
  updateNote(id: string, input: NotePatch): Promise<Note>
  /** DELETE /api/notes/:id */
  deleteNote(id: string): Promise<void>

  /** GET /api/projects/:id/activity */
  listActivity(projectId: string): Promise<ActivityEvent[]>
  /** GET /api/projects/:id/whiteboard */
  getWhiteboard(projectId: string): Promise<{ scene: WhiteboardScene }>
  /** PUT /api/projects/:id/whiteboard */
  saveWhiteboard(projectId: string, scene: WhiteboardScene): Promise<{ scene: WhiteboardScene }>
  /** GET /api/notifications?today= */
  listNotifications(today: string): Promise<AppNotification[]>
  /** POST /api/notifications/:id/read */
  markNotificationRead(id: string): Promise<AppNotification>
  /** POST /api/notifications/read-all?today= */
  markAllNotificationsRead(today: string): Promise<void>

  /** GET /api/today?date= */
  getToday(date: string, init?: RequestInit): Promise<TodayData>
  /** GET /api/dashboard */
  getDashboard(init?: RequestInit): Promise<DashboardData>
  /** GET /api/search?q= */
  search(query: string): Promise<SearchResults>
}
