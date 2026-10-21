import { csrfHeaders } from '../lib/csrf.ts'
import { ApiError } from './errors.ts'
import { broadcastSignedOut } from '../lib/authChannel.ts'
import { forceSignOut } from '../lib/forceSignOut.ts'
import { enqueueWrite, markUnreachable, noteNetworkSuccess } from '../lib/offline.ts'
import { refreshSession } from '../lib/refresh.ts'
import { purgeStaleClient } from '../lib/staleClient.ts'
import { CLIENT_VERSION } from '../version.ts'
import type {
  ActivityEvent,
  AlignApi,
  AppNotification,
  AuthProviders,
  AuthSession,
  DashboardData,
  TodayData,
  Label,
  Note,
  Project,
  ResetResult,
  SearchResults,
  Task,
  User,
  VerifyLink,
  WhiteboardScene,
  WriteOpts,
} from './types.ts'

const OFFLINE_MESSAGE = "You're offline. This change is saved on this device and will sync when you reconnect."

type CachedGet = { etag: string; body: string; headers: [string, string][] }
const etags = new Map<string, CachedGet>()

function rememberGet(path: string, response: Response, body: string) {
  const etag = response.headers.get('etag')
  if (!etag || body.length > 1_000_000) return
  const headers: [string, string][] = []
  response.headers.forEach((value, key) => headers.push([key, value]))
  etags.set(path, { etag, body, headers })
}

/**
 * Fetch client for the Align API.
 * Sends cookies with `credentials: 'include'` (the JWT lives in an httpOnly cookie).
 */

function queueable(path: string, method: string): boolean {
  if (method === 'GET' || method === 'HEAD') return false
  return !path.startsWith('/api/auth/')
}

function canRefresh(path: string): boolean {
  return (
    !path.startsWith('/api/auth/login') &&
    !path.startsWith('/api/auth/register') &&
    !path.startsWith('/api/auth/forgot') &&
    !path.startsWith('/api/auth/reset') &&
    !path.startsWith('/api/auth/refresh') &&
    !path.startsWith('/api/auth/verify')
  )
}

function timedOut(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

function incompatible(response: Response, path: string): boolean {
  const minimum = Number(response.headers.get('X-Align-Minimum'))
  if (Number.isFinite(minimum) && minimum > CLIENT_VERSION) return true
  const type = response.headers.get('content-type') ?? ''
  return path.startsWith('/api/') && type.includes('text/html')
}

async function fetchResponse(path: string, init: RequestInit = {}, refreshed = false): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const body = typeof init.body === 'string' ? init.body : undefined
  const canQueue = queueable(path, method)
  const ownTimeout = !init.signal && !canQueue
  const attempts = ownTimeout ? 2 : 1

  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body) headers.set('Content-Type', 'application/json')
  if (method !== 'GET' && method !== 'HEAD') {
    for (const [key, value] of Object.entries(csrfHeaders())) headers.set(key, value)
  }
  const cached = method === 'GET' || method === 'HEAD' ? etags.get(path) : undefined
  if (cached) headers.set('If-None-Match', cached.etag)

  let response: Response | undefined
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const signal = init.signal ?? AbortSignal.timeout(canQueue ? 8_000 : ownTimeout ? 10_000 : 10_000)
    try {
      response = await fetch(path, {
        ...init,
        method,
        headers,
        credentials: 'include',
        cache: init.cache ?? 'no-store',
        signal,
      })
      break
    } catch (error) {
      // A caller-supplied abort is a cancelled query. Our own timeout means the write should wait.
      if (init.signal?.aborted) throw error
      if (ownTimeout && attempt + 1 < attempts) continue
      if (canQueue) {
        markUnreachable()
        try {
          enqueueWrite({ path, method, body, match: headers.get('If-Match') ?? undefined })
        } catch {
          throw new ApiError(0, "You're offline, and this change could not be saved on this device.")
        }
        throw new ApiError(0, OFFLINE_MESSAGE, true)
      }
      if (timedOut(error)) {
        throw new ApiError(0, 'Network error. Check your connection and try again.')
      }
      throw new ApiError(0, 'Network error. Check your connection and try again.')
    }
  }
  if (!response) throw new ApiError(0, 'Network error. Check your connection and try again.')
  if (incompatible(response, path)) {
    void purgeStaleClient()
    throw new ApiError(0, 'This page is out of date. Reloading.')
  }
  // Any real response means this fetch reached something. Mutations prove the network.
  // A service-worker cache hit is not the network, even when the status is 200.
  const fromWorkerCache = response.headers.get('X-Align-Cache') === 'hit'
  if (response.status === 401 && !refreshed && canRefresh(path) && !fromWorkerCache) {
    const ok = await refreshSession()
    if (ok) return fetchResponse(path, init, true)
    broadcastSignedOut()
    forceSignOut()
  }
  if (response.status === 304 && cached) {
    response = new Response(cached.body, { status: 200, headers: cached.headers })
  } else if ((method === 'GET' || method === 'HEAD') && response.ok) {
    const body = await response.clone().text()
    rememberGet(path, response, body)
  }
  if (response.ok && !fromWorkerCache) noteNetworkSuccess({ trusted: method !== 'GET' && method !== 'HEAD' })
  if (response.status === 503 && canQueue) {
    markUnreachable()
    try {
      enqueueWrite({ path, method, body, match: headers.get('If-Match') ?? undefined })
    } catch {
      throw new ApiError(0, "You're offline, and this change could not be saved on this device.")
    }
    throw new ApiError(0, OFFLINE_MESSAGE, true)
  }
  if (!response.ok) {
    let message = 'Request failed.'
    let code: string | undefined
    try {
      const data: unknown = await response.json()
      if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
        message = data.error
      }
      if (data && typeof data === 'object' && 'code' in data && typeof data.code === 'string') {
        code = data.code
      }
    } catch {
      // Non-JSON error bodies fall back to the generic message.
    }
    throw new ApiError(response.status, message, false, code)
  }
  return response
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchResponse(path, init)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function withCursor(path: string, cursor: string): string {
  const url = new URL(path, 'http://align.local')
  url.searchParams.set('cursor', cursor)
  return `${url.pathname}${url.search}`
}

async function collectPages<T>(path: string, init?: RequestInit): Promise<T[]> {
  const all: T[] = []
  const seen = new Set<string>()
  let next = path
  for (;;) {
    if (seen.has(next)) break
    seen.add(next)
    const response = await fetchResponse(next, init)
    const page = (await response.json()) as T[]
    all.push(...page)
    const cursor = response.headers.get('X-Next-Cursor')
    if (!cursor) break
    next = withCursor(path, cursor)
  }
  return all
}

function withMatch(init: RequestInit, opts?: WriteOpts): RequestInit {
  if (!opts || (opts.version === undefined && !opts.overwrite)) return init
  const headers = new Headers(init.headers)
  headers.set('If-Match', opts.overwrite ? '*' : `W/"${opts.version}"`)
  return { ...init, headers }
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
    return request<User | import('./types.ts').MfaChallenge>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  async logout() {
    await request<void>('/api/auth/logout', { method: 'POST' })
  },
  authProviders() {
    return request<AuthProviders>('/api/auth/providers')
  },
  verifyEmail(token) {
    return request<User>('/api/auth/verify', { method: 'POST', body: JSON.stringify({ token }) })
  },
  sendVerification() {
    return request<VerifyLink>('/api/auth/verify/send', { method: 'POST' })
  },
  listSessions() {
    return request<AuthSession[]>('/api/auth/sessions')
  },
  async revokeSession(id) {
    await request<void>(`/api/auth/sessions/${id}`, { method: 'DELETE' })
  },
  async revokeAllSessions(password) {
    await request<void>('/api/auth/sessions/revoke-all', {
      method: 'POST',
      body: JSON.stringify({ password: password ?? '' }),
    })
  },
  changeEmail(input) {
    return request<import('./types.ts').User & { verifyToken?: string }>('/api/auth/email', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  async session() {
    const data = await request<{ user: User | null }>('/api/auth/session')
    return data.user
  },
  forgotPassword(email) {
    return request<ResetResult>('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) })
  },
  resetPassword(input) {
    return request<User>('/api/auth/reset', { method: 'POST', body: JSON.stringify(input) })
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
  async deleteAccount(input) {
    await request<void>('/api/auth/me', { method: 'DELETE', body: JSON.stringify(input ?? {}) })
  },
  totpSetup() {
    return request<{ secret: string; otpauth: string; qr: string }>('/api/auth/totp/setup', { method: 'POST' })
  },
  totpConfirm(code) {
    return request<{ recoveryCodes: string[] }>('/api/auth/totp/confirm', {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
  },
  async totpDisable(input) {
    await request<void>('/api/auth/totp/disable', { method: 'POST', body: JSON.stringify(input) })
  },
  regenerateRecoveryCodes(input) {
    return request<{ recoveryCodes: string[] }>('/api/auth/recovery/regenerate', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  completeMfa(input) {
    return request<User>('/api/auth/login/mfa', { method: 'POST', body: JSON.stringify(input) })
  },
  async stepUp(input) {
    await request<void>('/api/auth/step-up', { method: 'POST', body: JSON.stringify(input) })
  },
  listSecurityEvents() {
    return request<import('./types.ts').SecurityEvent[]>('/api/auth/security-events')
  },
  renameSession(id, name) {
    return request<{ id: string; device: string }>(`/api/auth/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
  },
  listPasskeys() {
    return request<import('./types.ts').Passkey[]>('/api/auth/passkeys')
  },
  passkeyRegisterOptions() {
    return request<unknown>('/api/auth/passkeys/register/options', { method: 'POST' })
  },
  async passkeyRegisterVerify(body) {
    await request<void>('/api/auth/passkeys/register/verify', { method: 'POST', body: JSON.stringify(body) })
  },
  async passkeyDelete(id, input) {
    await request<void>(`/api/auth/passkeys/${id}`, { method: 'DELETE', body: JSON.stringify(input ?? {}) })
  },
  passkeyStepUpOptions() {
    return request<unknown>('/api/auth/passkeys/step-up/options', { method: 'POST' })
  },
  async passkeyStepUpVerify(body) {
    await request<void>('/api/auth/passkeys/step-up/verify', { method: 'POST', body: JSON.stringify(body) })
  },
  passkeyLoginOptions() {
    return request<unknown>('/api/auth/passkeys/login/options', { method: 'POST' })
  },
  passkeyLoginVerify(body) {
    return request<User>('/api/auth/passkeys/login/verify', { method: 'POST', body: JSON.stringify(body) })
  },
  listTrash() {
    return request<{ projects: import('./types.ts').TrashItem[]; tasks: import('./types.ts').TrashItem[] }>('/api/trash')
  },
  restoreProject(id) {
    return request<{ id: string; name: string }>(`/api/trash/projects/${id}/restore`, { method: 'POST' })
  },
  restoreTask(id) {
    return request<{ id: string; title: string }>(`/api/trash/tasks/${id}/restore`, { method: 'POST' })
  },
  async purgeProject(id) {
    await request<void>(`/api/trash/projects/${id}`, { method: 'DELETE' })
  },
  async purgeTask(id) {
    await request<void>(`/api/trash/tasks/${id}`, { method: 'DELETE' })
  },
  async emptyTrash() {
    await request<void>('/api/trash/empty', { method: 'POST' })
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
  updateProject(id, input, opts) {
    return request<Project>(`/api/projects/${id}`, withMatch({ method: 'PATCH', body: JSON.stringify(input) }, opts))
  },
  archiveProject(id, opts) {
    return request<Project>(`/api/projects/${id}/archive`, withMatch({ method: 'PATCH' }, opts))
  },
  async deleteProject(id) {
    await request<void>(`/api/projects/${id}`, { method: 'DELETE' })
  },
  listTasks(projectId, init?: RequestInit) {
    return collectPages<Task>(`/api/projects/${projectId}/tasks`, init)
  },
  createTask(projectId, input) {
    return request<Task>(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ ...input, clientId: input.clientId ?? crypto.randomUUID() }),
    })
  },
  updateTask(id, input, opts) {
    return request<Task>(`/api/tasks/${id}`, withMatch({ method: 'PATCH', body: JSON.stringify(input) }, opts))
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
  updateLabel(id, input, opts) {
    return request<Label>(`/api/labels/${id}`, withMatch({ method: 'PATCH', body: JSON.stringify(input) }, opts))
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
  updateNote(id, input, opts) {
    return request<Note>(`/api/notes/${id}`, withMatch({ method: 'PATCH', body: JSON.stringify(input) }, opts))
  },
  async deleteNote(id) {
    await request<void>(`/api/notes/${id}`, { method: 'DELETE' })
  },
  listActivity(projectId) {
    return collectPages<ActivityEvent>(`/api/projects/${projectId}/activity`)
  },
  getWhiteboard(projectId) {
    return request<{ scene: WhiteboardScene }>(`/api/projects/${projectId}/whiteboard`)
  },
  saveWhiteboard(projectId, scene) {
    return request<{ scene: WhiteboardScene }>(`/api/projects/${projectId}/whiteboard`, {
      method: 'PUT',
      body: JSON.stringify({ scene }),
    })
  },
  listNotifications(today) {
    return collectPages<AppNotification>(withQuery('/api/notifications', { today }))
  },
  markNotificationRead(id) {
    return request<AppNotification>(`/api/notifications/${id}/read`, { method: 'POST' })
  },
  async markAllNotificationsRead(today) {
    await request<void>(withQuery('/api/notifications/read-all', { today }), { method: 'POST' })
  },
  getToday(date, init?: RequestInit) {
    return request<TodayData>(withQuery('/api/today', { date }), init)
  },
  getDashboard(init?: RequestInit) {
    return request<DashboardData>('/api/dashboard', init)
  },
  search(query) {
    return request<SearchResults>(withQuery('/api/search', { q: query }))
  },
} satisfies AlignApi
