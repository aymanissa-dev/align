import { passwordStrength } from '../lib/passwordStrength.ts'

export function PasswordMeter({ password }: { password: string }) {
  const strength = passwordStrength(password)
  if (!password) return null
  return (
    <div className="mt-2">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={bar <= strength.score ? 'h-1 flex-1 bg-neutral-950' : 'h-1 flex-1 bg-neutral-200'}
          />
        ))}
      </div>
      <p className="mt-1 font-pixel text-[11px] tracking-[0.14em] text-neutral-500 uppercase">{strength.label}</p>
    </div>
  )
}
