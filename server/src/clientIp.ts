import { isIP } from 'node:net'

type AddressRequest = {
  get(name: string): string | undefined
  socket?: { remoteAddress?: string | null }
}

function normalize(ip: string): string {
  const trimmed = ip.trim()
  const mapped = trimmed.startsWith('::ffff:') ? trimmed.slice('::ffff:'.length) : trimmed
  return isIP(mapped) ? mapped : trimmed
}

function valid(ip: string | undefined): string | undefined {
  if (!ip) return undefined
  const trimmed = ip.trim()
  return isIP(trimmed) ? normalize(trimmed) : undefined
}

function firstAddress(value: string | undefined): string | undefined {
  return valid(value?.split(',')[0])
}

/** Server-side platform flag. A client cannot set this to make forwarded headers trusted. */
function onPlatform(): boolean {
  if (process.env.VERCEL === '1') return true
  const env = process.env.VERCEL_ENV
  return env === 'production' || env === 'preview'
}

/**
 * Address a per-IP limit is counted against.
 *
 * On Vercel, x-real-ip is the client address the platform sets. The first
 * x-forwarded-for entry is only a fallback when that header is missing.
 * Anywhere else those headers are ignored, so a caller cannot pick a fresh
 * bucket by sending them.
 */
export function clientIp(req: AddressRequest): string {
  if (onPlatform()) {
    const real = firstAddress(req.get('x-real-ip'))
    if (real) return real
    const forwarded = firstAddress(req.get('x-forwarded-for'))
    if (forwarded) return forwarded
  }
  return valid(req.socket?.remoteAddress ?? undefined) ?? 'unknown'
}
