export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4
  label: string
}

/** Advisory only. The server still accepts any password of at least 8 characters. */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: '' }
  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1
  const label = (['Too short', 'Weak', 'Okay', 'Good', 'Strong'] as const)[score] ?? 'Too short'
  return { score: score as PasswordStrength['score'], label }
}
