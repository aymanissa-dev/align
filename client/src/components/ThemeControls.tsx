import { useState } from 'react'
import { useAuth } from '../auth/auth-context.ts'
import { useToast } from './toast-context.ts'
import { ACCENTS, persistTheme, readTheme, type ThemeChoice } from '../lib/theme.ts'
import { cn } from '../lib/cn.ts'
import { errorMessage } from '../lib/errorMessage.ts'

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

export function ThemeToggle({ className }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>(() => readTheme())

  return (
    <div role="radiogroup" aria-label="Color theme" className={cn('inline-flex border border-neutral-300', className)}>
      {CHOICES.map((item) => (
        <button
          key={item.value}
          type="button"
          role="radio"
          aria-checked={choice === item.value}
          className={cn(
            'focus-ring min-h-[44px] min-w-[44px] flex-1 px-3 text-xs',
            choice === item.value ? 'bg-neutral-950 text-white' : 'text-neutral-600 hover:bg-neutral-50',
          )}
          onClick={() => {
            setChoice(item.value)
            persistTheme(item.value)
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function AccentPicker() {
  const { user, updateProfile } = useAuth()
  const toast = useToast()
  if (!user) return null
  const current = user.accent || '#171717'

  async function choose(accent: string) {
    try {
      await updateProfile({ accent })
    } catch (caught) {
      toast(errorMessage(caught))
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Accent color">
        {ACCENTS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={current === color}
            aria-label={color}
            className={cn('focus-ring h-7 w-7 border', current === color ? 'border-neutral-950' : 'border-transparent')}
            style={{ backgroundColor: color }}
            onClick={() => void choose(color)}
          />
        ))}
        <label className="focus-ring inline-flex items-center gap-2 border border-neutral-300 px-2 py-1 text-xs text-neutral-600">
          Custom
          <input
            type="color"
            aria-label="Custom accent color"
            value={current}
            className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
            onChange={(event) => void choose(event.target.value)}
          />
        </label>
      </div>
    </div>
  )
}
