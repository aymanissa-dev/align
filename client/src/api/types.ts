/**
 * Client contract for Align.
 *
 * Paths match the build plan. JSON is the resource itself (or an array),
 * not an envelope. Errors are `{ "error": string }` with an HTTP error status.
 * Deletes return 204.
 *
 * Profile, password, and account deletion are included so Settings works
 * before those routes exist on the server.
 */

export type ProjectStatus = 'active' | 'archived'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export type User = {
  id: string
  name: string
  email: string
  createdAt: string
}

export type Project = {
  id: string
  name: string
  description: string
  status: ProjectStatus
  createdAt: string
  updatedAt: string
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

export type DashboardData = {
  projects: DashboardProject[]
  openTasks: OpenTask[]
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

export type RegisterInput = {
  name: string
  email: string
  password: string
}

export type LoginInput = {
  email: string
  password: string
}

export type ProjectInput = {
  name: string
  description?: string
}

export type ProjectPatch = {
  name?: string
  description?: string
}

export type TaskInput = {
  title: string
  dueDate?: string | null
  priority?: TaskPriority
  labelIds?: string[]
}

export type TaskPatch = {
  title?: string
  completed?: boolean
  dueDate?: string | null
  priority?: TaskPriority
  labelIds?: string[]
  order?: number
}

export type LabelInput = {
  name: string
  color: string
}

export type LabelPatch = {
  name?: string
  color?: string
}

export type NoteInput = {
  title?: string
  body?: string
}

export type NotePatch = {
  title?: string
  body?: string
}

export interface AlignApi {
  /** POST /api/auth/register */
  register(input: RegisterInput): Promise<User>
  /** POST /api/auth/login */
  login(input: LoginInput): Promise<User>
  /** POST /api/auth/logout */
  logout(): Promise<void>
  /** GET /api/auth/me */
  me(): Promise<User>
  /** PATCH /api/auth/me */
  updateProfile(input: { name: string }): Promise<User>
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
  listTasks(projectId: string): Promise<Task[]>
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

  /** GET /api/dashboard */
  getDashboard(): Promise<DashboardData>
  /** GET /api/search?q= */
  search(query: string): Promise<SearchResults>
}
