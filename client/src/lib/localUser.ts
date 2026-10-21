import type { User } from '../api/types.ts'

const KEY = 'align-user'

function isUser(value: unknown): value is User {
  if (!value || typeof value !== 'object') return false
  const user = value as Partial<User>
  return typeof user.id === 'string' && user.id.length > 0 && typeof user.name === 'string' && typeof user.email === 'string'
}

/** The signed-in profile, so an offline reload can render the workspace. Not the service worker. */
export function readLocalUser(): User | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isUser(parsed)) return null
    return {
      id: parsed.id,
      name: parsed.name,
      email: parsed.email,
      accent: typeof parsed.accent === 'string' ? parsed.accent : '#171717',
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
    }
  } catch {
    return null
  }
}

export function writeLocalUser(user: User): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(user))
  } catch {
    // The in-memory session still covers this tab until reload.
  }
}

export function clearLocalUser(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Already gone.
  }
}
