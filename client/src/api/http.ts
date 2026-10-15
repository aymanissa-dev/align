import { ApiError } from './errors.ts'
import type {
  ActivityEvent,
  AlignApi,
  AppNotification,
  DashboardData,
  TodayData,
  Label,
  Note,
  Project,
  SearchResults,
  Task,
  User,
} from './types.ts'

/**
 * Fetch client for the Align API.
 * Sends cookies with `credentials: 'include'` (the JWT lives in an httpOnly cookie).
 */

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body) headers.set('Content-Type', 'application/json')

  const response = await fetch(path, { ...init, headers, credentials: 'include' })
  if (!response.ok) {
    let message = 'Request failed.'
    try {
      const data: unknown = await response.json()
      if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
        message = data.error
      }
    } catch {
      // Non-JSON error bodies fall back to the generic message.
    }
    throw new ApiError(response.status, message)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

export const httpApi = {
  register(input) {
    return request<User>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) })
  },
  login(input) {
    return request<User>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) })
  },
  async logout() {
    await request<void>('/api/auth/logout', { method: 'POST' })
  },
  me() {
    return request<User>('/api/auth/me')
  },
  updateProfile(input) {
    return request<User>('/api/auth/me', { method: 'PATCH', body: JSON.stringify(input) })
  },
  async changePassword(input) {
    await request<void>('/api/auth/password', { method: 'POST', body: JSON.stringify(input) })
  },
  async deleteAccount() {
    await request<void>('/api/auth/me', { method: 'DELETE' })
  },
  listProjects(params?) {
    return request<Project[]>(withQuery('/api/projects', { status: params?.status }))
  },
  createProject(input) {
    return request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(input) })
  },
  getProject(id) {
    return request<Project>(`/api/projects/${id}`)
  },
  updateProject(id, input) {
    return request<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
  },
  archiveProject(id) {
    return request<Project>(`/api/projects/${id}/archive`, { method: 'PATCH' })
  },
  async deleteProject(id) {
    await request<void>(`/api/projects/${id}`, { method: 'DELETE' })
  },
  listTasks(projectId) {
    return request<Task[]>(`/api/projects/${projectId}/tasks`)
  },
  createTask(projectId, input) {
    return request<Task>(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  updateTask(id, input) {
    return request<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
  },
  async deleteTask(id) {
    await request<void>(`/api/tasks/${id}`, { method: 'DELETE' })
  },
  listLabels() {
    return request<Label[]>('/api/labels')
  },
  createLabel(input) {
    return request<Label>('/api/labels', { method: 'POST', body: JSON.stringify(input) })
  },
  updateLabel(id, input) {
    return request<Label>(`/api/labels/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
  },
  async deleteLabel(id) {
    await request<void>(`/api/labels/${id}`, { method: 'DELETE' })
  },
  listNotes() {
    return request<Note[]>('/api/notes')
  },
  listProjectNotes(projectId) {
    return request<Note[]>(`/api/projects/${projectId}/notes`)
  },
  createNote(projectId, input) {
    return request<Note>(`/api/projects/${projectId}/notes`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  getNote(id) {
    return request<Note>(`/api/notes/${id}`)
  },
  updateNote(id, input) {
    return request<Note>(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
  },
  async deleteNote(id) {
    await request<void>(`/api/notes/${id}`, { method: 'DELETE' })
  },
  listActivity(projectId) {
    return request<ActivityEvent[]>(`/api/projects/${projectId}/activity`)
  },
  listNotifications(today) {
    return request<AppNotification[]>(withQuery('/api/notifications', { today }))
  },
  markNotificationRead(id) {
    return request<AppNotification>(`/api/notifications/${id}/read`, { method: 'POST' })
  },
  async markAllNotificationsRead() {
    await request<void>('/api/notifications/read-all', { method: 'POST' })
  },
  getToday(date) {
    return request<TodayData>(withQuery('/api/today', { date }))
  },
  getDashboard() {
    return request<DashboardData>('/api/dashboard')
  },
  search(query) {
    return request<SearchResults>(withQuery('/api/search', { q: query }))
  },
} satisfies AlignApi
