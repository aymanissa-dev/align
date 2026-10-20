export function csrfHeaders(): Record<string, string> {
  if (typeof document === 'undefined') return {}
  const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]*)/)
  if (!match?.[1]) return {}
  try {
    return { 'X-CSRF-Token': decodeURIComponent(match[1]) }
  } catch {
    return { 'X-CSRF-Token': match[1] }
  }
}
