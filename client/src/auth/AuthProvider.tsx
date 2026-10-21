import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../api/errors.ts'
import { api } from '../api/index.ts'
import type { DashboardData, LoginInput, RegisterInput, User } from '../api/types.ts'
import { broadcastSignedOut } from '../lib/authChannel.ts'
import { setForceSignOutHandler } from '../lib/forceSignOut.ts'
import { clearLocalUser, readLocalUser, writeLocalUser } from '../lib/localUser.ts'
import { clearQueueForUser, setQueueOwner } from '../lib/offline.ts'
import { allowPersistedCache, clearPersistedCache, QueryCache } from '../lib/queryPersist.tsx'
import { purgeApiCaches } from '../lib/swCache.ts'
import { queryClient } from '../queryClient.ts'
import { AuthContext, type AuthContextValue } from './auth-context.ts'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const ownerRef = useRef<string | null>(null)
  const epoch = useRef(0)
  const nextOwner = user?.id ?? null
  // A render with no user yet must not wipe the owner. Logout clears it explicitly.
  if (nextOwner && ownerRef.current !== nextOwner) {
    ownerRef.current = nextOwner
    setQueueOwner(nextOwner)
  }

  useEffect(() => {
    if (ready) document.documentElement.dataset.booted = '1'
  }, [ready])

  const dropLocalSession = useCallback((id: string | null) => {
    epoch.current += 1
    const storedId = id ?? readLocalUser()?.id ?? null
    if (storedId) {
      clearQueueForUser(storedId)
      clearPersistedCache(storedId)
    }
    clearLocalUser()
    setQueueOwner(null)
    ownerRef.current = null
    purgeApiCaches()
    setUser(null)
    queryClient.clear()
  }, [])

  useEffect(() => {
    setForceSignOutHandler(() => {
      dropLocalSession(ownerRef.current)
    })
    return () => setForceSignOutHandler(null)
  }, [dropLocalSession])

  useEffect(() => {
    let cancelled = false
    const mine = epoch.current
    api
      .session()
      .then((next) => {
        if (cancelled || epoch.current !== mine) return
        if (next) writeLocalUser(next)
        else clearLocalUser()
        setUser(next)
      })
      .catch((error: unknown) => {
        if (cancelled || epoch.current !== mine) return
        // A dead network keeps the signed-in shell. A 401 or any real response does not.
        const offline = error instanceof ApiError && error.status === 0
        setUser(offline ? readLocalUser() : null)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const adopt = useCallback((next: User & { dashboard?: DashboardData }) => {
    epoch.current += 1
    allowPersistedCache(next.id)
    const { dashboard, ...user } = next
    writeLocalUser(user)
    queryClient.clear()
    // The sign-in response already includes the dashboard. Rendering it here
    // skips a follow-up /api/dashboard or /api/auth/me round trip.
    if (dashboard) {
      queryClient.setQueryData(['dashboard'], dashboard, { updatedAt: Date.now() })
    }
    setUser(user)
    return user
  }, [])

  const login = useCallback(async (input: LoginInput) => {
    const next = await api.login(input)
    if ('mfaRequired' in next) return next
    return adopt(next)
  }, [adopt])

  const register = useCallback(async (input: RegisterInput) => {
    const next = await api.register(input)
    epoch.current += 1
    allowPersistedCache(next.id)
    writeLocalUser(next)
    queryClient.clear()
    setUser(next)
  }, [])

  const acceptSession = useCallback((next: User & { dashboard?: DashboardData }) => {
    adopt(next)
  }, [adopt])

  const logout = useCallback(async () => {
    const id = ownerRef.current ?? user?.id ?? null
    await api.logout()
    broadcastSignedOut()
    dropLocalSession(id)
  }, [dropLocalSession, user?.id])

  const updateProfile = useCallback(async (input: { name?: string; accent?: string }) => {
    const next = await api.updateProfile(input)
    writeLocalUser(next)
    setUser(next)
    return next
  }, [])

  const deleteAccount = useCallback(async (password?: string) => {
    const id = ownerRef.current ?? user?.id ?? null
    await api.deleteAccount(password ? { password } : {})
    broadcastSignedOut()
    dropLocalSession(id)
  }, [dropLocalSession, user?.id])

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, login, register, acceptSession, logout, updateProfile, deleteAccount }),
    [user, ready, login, register, acceptSession, logout, updateProfile, deleteAccount],
  )

  return (
    <AuthContext.Provider value={value}>
      <QueryCache userId={user?.id ?? null}>{children}</QueryCache>
    </AuthContext.Provider>
  )
}
