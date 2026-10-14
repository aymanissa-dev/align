import { cn } from './cn.ts'

const buttonStyles = {
  primary: 'bg-neutral-900 text-white hover:bg-neutral-800',
  secondary: 'border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50',
  ghost: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
} as const

export type ButtonVariant = keyof typeof buttonStyles

export function buttonClass(variant: ButtonVariant = 'primary', className?: string): string {
  return cn(
    'focus-ring inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
    buttonStyles[variant],
    className,
  )
}
