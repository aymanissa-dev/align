import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/index.ts'
import type { LoginInput, RegisterInput, User } from '../api/types.ts'
import { queryClient } from '../queryClient.ts'
import { AuthContext, type AuthContextValue } from './auth-context.ts'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .session()
      .then((next) => {
        if (!cancelled) setUser(next)
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
    queryClient.clear()
    setUser(next)
  }, [])

  const register = useCallback(async (input: RegisterInput) => {
    const next = await api.register(input)
    queryClient.clear()
    setUser(next)
  }, [])

  const acceptSession = useCallback((next: User) => {
    queryClient.clear()
    setUser(next)
  }, [])

  const logout = useCallback(async () => {
    await api.logout()
    setUser(null)
    queryClient.clear()
  }, [])

  const updateProfile = useCallback(async (input: { name?: string; accent?: string }) => {
    const next = await api.updateProfile(input)
    setUser(next)
    return next
  }, [])

  const deleteAccount = useCallback(async () => {
    await api.deleteAccount()
    setUser(null)
    queryClient.clear()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, login, register, acceptSession, logout, updateProfile, deleteAccount }),
    [user, ready, login, register, acceptSession, logout, updateProfile, deleteAccount],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
