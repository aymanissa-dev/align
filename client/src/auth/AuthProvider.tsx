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
      .me()
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

  const logout = useCallback(async () => {
    await api.logout()
    setUser(null)
    queryClient.clear()
  }, [])

  const updateProfile = useCallback(async (name: string) => {
    const next = await api.updateProfile({ name })
    setUser(next)
    return next
  }, [])

  const deleteAccount = useCallback(async () => {
    await api.deleteAccount()
    setUser(null)
    queryClient.clear()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, login, register, logout, updateProfile, deleteAccount }),
    [user, ready, login, register, logout, updateProfile, deleteAccount],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
