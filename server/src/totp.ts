import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const DIGITS = 6

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function totpAt(secret: string, counter: number): string {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', base32Decode(secret)).update(buffer).digest()
  const offset = hmac[hmac.length - 1]! & 0x0f
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS
  return binary.toString().padStart(DIGITS, '0')
}

export function verifyTotp(secret: string, token: string, now = Date.now(), window = 1): boolean {
  const trimmed = token.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(trimmed)) return false
  const counter = Math.floor(now / 1000 / STEP_SECONDS)
  for (let delta = -window; delta <= window; delta += 1) {
    const expected = totpAt(secret, counter + delta)
    if (safeEqual(expected, trimmed)) return true
  }
  return false
}

export function otpauthUrl(secret: string, email: string): string {
  const label = encodeURIComponent(`Align:${email}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('Align')}&algorithm=SHA1&digits=6&period=30`
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex')
    return `${raw.slice(0, 5)}-${raw.slice(5)}`
  })
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function base32Encode(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31]
  return output
}

function base32Decode(secret: string): Buffer {
  const cleaned = secret.replace(/=+$/g, '').toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of cleaned) {
    const index = ALPHABET.indexOf(char)
    if (index === -1) continue
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}
