import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api/index.ts'
import type { LoginInput, RegisterInput, User } from '../api/types.ts'
import { broadcastSignedOut } from '../lib/authChannel.ts'
import { setForceSignOutHandler } from '../lib/forceSignOut.ts'
import { clearQueueForUser, setQueueOwner } from '../lib/offline.ts'
import { clearPersistedCache, QueryCache } from '../lib/queryPersist.tsx'
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

  useEffect(() => {
    setForceSignOutHandler(() => {
      epoch.current += 1
      const id = ownerRef.current
      if (id) {
        clearQueueForUser(id)
        clearPersistedCache(id)
      }
      setQueueOwner(null)
      ownerRef.current = null
      setUser(null)
      queryClient.clear()
    })
    return () => setForceSignOutHandler(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    const mine = epoch.current
    api
      .session()
      .then((next) => {
        if (!cancelled && epoch.current === mine) setUser(next)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (input: LoginInput) => {
    const next = await api.login(input)
    epoch.current += 1
    queryClient.clear()
    setUser(next)
  }, [])

  const register = useCallback(async (input: RegisterInput) => {
    const next = await api.register(input)
    epoch.current += 1
    queryClient.clear()
    setUser(next)
  }, [])

  const acceptSession = useCallback((next: User) => {
    epoch.current += 1
    queryClient.clear()
    setUser(next)
  }, [])

  const logout = useCallback(async () => {
    const id = user?.id
    await api.logout()
    broadcastSignedOut()
    if (id) {
      clearQueueForUser(id)
      clearPersistedCache(id)
    }
    setQueueOwner(null)
    ownerRef.current = null
    setUser(null)
    queryClient.clear()
  }, [user?.id])

  const updateProfile = useCallback(async (input: { name?: string; accent?: string }) => {
    const next = await api.updateProfile(input)
    setUser(next)
    return next
  }, [])

  const deleteAccount = useCallback(async () => {
    const id = user?.id
    await api.deleteAccount()
    broadcastSignedOut()
    if (id) {
      clearQueueForUser(id)
      clearPersistedCache(id)
    }
    setQueueOwner(null)
    ownerRef.current = null
    setUser(null)
    queryClient.clear()
  }, [user?.id])

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, login, register, acceptSession, logout, updateProfile, deleteAccount }),
    [user, ready, login, register, acceptSession, logout, updateProfile, deleteAccount],
  )

  return (
    <AuthContext.Provider value={value}>
      {user ? <QueryCache userId={user.id}>{children}</QueryCache> : children}
    </AuthContext.Provider>
  )
}
