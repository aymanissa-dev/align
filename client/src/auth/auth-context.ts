import { createContext, useContext } from 'react'
import type { LoginInput, MfaChallenge, RegisterInput, RegisterResult, User } from '../api/types.ts'

export type AuthContextValue = {
  user: User | null
  ready: boolean
  login: (input: LoginInput) => Promise<User | MfaChallenge>
  register: (input: RegisterInput) => Promise<RegisterResult>
  acceptSession: (user: User) => void
  logout: () => Promise<void>
  updateProfile: (input: { name?: string; accent?: string }) => Promise<User>
  deleteAccount: (password?: string) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
