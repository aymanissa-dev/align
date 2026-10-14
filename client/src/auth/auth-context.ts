import { createContext, useContext } from 'react'
import type { LoginInput, RegisterInput, User } from '../api/types.ts'

export type AuthContextValue = {
  user: User | null
  ready: boolean
  login: (input: LoginInput) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (name: string) => Promise<User>
  deleteAccount: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
