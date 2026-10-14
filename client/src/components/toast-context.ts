import { createContext, useContext } from 'react'

export const ToastContext = createContext<((message: string) => void) | null>(null)

export function useToast(): (message: string) => void {
  const push = useContext(ToastContext)
  if (!push) throw new Error('useToast must be used within ToastProvider')
  return push
}
