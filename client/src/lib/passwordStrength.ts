/**
 * Medium bar: 10 or more characters, or a score of 2 or more.
 * The score is a small stand-in for zxcvbn (0–4). Keep the server copy in
 * server/src/passwordPolicy.ts identical.
 */
const COMMON = new Set([
  'password',
  'password1',
  'qwerty',
  'qwerty123',
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  'letmein',
  'admin',
  'welcome',
  'iloveyou',
  'abc123',
  'monkey',
  'dragon',
  'master',
  'login',
  'passw0rd',
  'trustno1',
  'sunshine',
  'princess',
  'football',
  'shadow',
  '111111',
  '000000',
  '654321',
  'superman',
  'batman',
  'access',
  'hello',
  'charlie',
])

export const MEDIUM_PASSWORD_MESSAGE =
  'Use at least 10 characters, or a stronger mix of letters, numbers, and symbols.'

export function passwordScore(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0
  const lower = password.toLowerCase()
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return 0
  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  const classes =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/\d/.test(password)) +
    Number(/[^A-Za-z0-9]/.test(password))
  if (classes >= 2) score += 1
  if (classes >= 3) score += 1
  if (/^(?:0123|1234|2345|3456|4567|5678|6789|qwer|asdf|zxcv|abcd)/i.test(password) && password.length < 12) {
    score = Math.min(score, 1)
  }
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4
}

export function isMediumPassword(password: string): boolean {
  if (password.length < 1 || password.length > 128) return false
  if (password.length >= 10) return true
  return passwordScore(password) >= 2
}

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
