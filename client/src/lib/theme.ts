export type ThemeChoice = 'light' | 'dark' | 'system'

const KEY = 'align-theme'

export const ACCENTS = ['#171717', '#1d4ed8', '#047857', '#b45309', '#b91c1c', '#6d28d9', '#0f766e'] as const

export function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    // Storage can be blocked. Fall through to the system theme.
  }
  return 'system'
}

export function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(choice: ThemeChoice): void {
  const dark = choice === 'dark' || (choice === 'system' && prefersDark())
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.dataset.theme = choice
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0c0c0c' : '#ffffff')
}

export function persistTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    // The class still applies for this visit.
  }
  applyTheme(choice)
}

export function accentInk(hex: string): string {
  const value = hex.replace('#', '')
  const parsed = Number.parseInt(value, 16)
  if (!Number.isFinite(parsed) || value.length !== 6) return '#ffffff'
  const red = (parsed >> 16) & 255
  const green = (parsed >> 8) & 255
  const blue = parsed & 255
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000
  return luminance > 160 ? '#0a0a0a' : '#ffffff'
}

export function applyAccent(hex: string): void {
  const accent = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#171717'
  const root = document.documentElement
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-ink', accentInk(accent))
}
