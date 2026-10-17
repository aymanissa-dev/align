import { passwordScore } from '../../../shared/passwordPolicy.ts'

export { isMediumPassword, MEDIUM_PASSWORD_MESSAGE, passwordScore } from '../../../shared/passwordPolicy.ts'

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4
  label: string
}

export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: '' }
  let score = passwordScore(password)
  if (password.length >= 10) score = Math.max(score, 2) as PasswordStrength['score']
  const label = (['Too short', 'Weak', 'Okay', 'Good', 'Strong'] as const)[score] ?? 'Too short'
  return { score, label }
}
