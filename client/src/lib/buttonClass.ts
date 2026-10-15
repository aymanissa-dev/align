import { cn } from './cn.ts'

const buttonStyles = {
  primary: 'border border-neutral-950 bg-neutral-950 text-white shadow-sm hover:bg-neutral-800',
  secondary: 'border border-neutral-300 bg-white text-neutral-950 hover:bg-neutral-50',
  ghost: 'border border-transparent text-neutral-600 hover:border-neutral-200 hover:bg-neutral-50 hover:text-neutral-950',
} as const

export type ButtonVariant = keyof typeof buttonStyles

export function buttonClass(variant: ButtonVariant = 'primary', className?: string): string {
  return cn(
    'focus-ring inline-flex items-center justify-center px-3 py-2 text-sm font-medium transition-colors',
    buttonStyles[variant],
    className,
  )
}
