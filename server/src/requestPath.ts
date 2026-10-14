const ORIGINAL_PATH_HEADERS = [
  'x-vercel-original-path',
  'x-forwarded-uri',
  'x-invoke-path',
  'x-original-url',
]

function pathOnly(value: string): string {
  const query = value.indexOf('?')
  return query === -1 ? value : value.slice(0, query)
}

function originalApiUrl(header: (name: string) => string | undefined): string | undefined {
  for (const name of ORIGINAL_PATH_HEADERS) {
    const value = header(name)?.trim()
    if (!value) continue
    let candidate = value
    if (value.startsWith('http://') || value.startsWith('https://')) {
      const url = new URL(value)
      candidate = `${url.pathname}${url.search}`
    }
    const path = pathOnly(candidate)
    if (path === '/api' || path.startsWith('/api/')) return candidate
  }
  return undefined
}

/**
 * Vercel preserves the browser path on the rewritten function. If a runtime
 * instead passes the rewrite destination or a path with `/api` stripped,
 * put the Express routes back on `/api/...`.
 */
export function resolveRequestUrl(
  url: string | undefined,
  header: (name: string) => string | undefined,
): string {
  const raw = url && url.length > 0 ? url : '/'
  const path = pathOnly(raw)
  const search = raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''

  if (path === '/api' || path.startsWith('/api/')) {
    const original = originalApiUrl(header)
    if ((path === '/api' || path === '/api/') && original && pathOnly(original).startsWith('/api/')) {
      return original.includes('?') || search.length === 0 ? original : `${original}${search}`
    }
    return raw
  }

  const original = originalApiUrl(header)
  if (original) return original.includes('?') || search.length === 0 ? original : `${original}${search}`

  if (path === '/') return `/api${search}`
  return `/api${path.startsWith('/') ? path : `/${path}`}${search}`
}
