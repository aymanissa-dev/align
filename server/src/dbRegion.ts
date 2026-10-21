import { lookup } from 'node:dns/promises'
import mongoose from 'mongoose'

type Prefix = { ip_prefix?: string; region?: string; service?: string }

let cached: string | null = null
let pending: Promise<string | null> | null = null

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = (value * 256 + octet) >>> 0
  }
  return value
}

function inCidr(ip: number, prefix: string): boolean {
  const [base, bitsText] = prefix.split('/')
  const bits = Number(bitsText)
  if (!base || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
  const network = ipv4ToInt(base)
  if (network === null) return false
  if (bits === 0) return true
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0
  return (ip & mask) === (network & mask)
}

function isPrivate(ip: string): boolean {
  const value = ipv4ToInt(ip)
  if (value === null) return true
  const first = value >>> 24
  const second = (value >>> 16) & 255
  if (first === 10 || first === 127) return true
  if (first === 192 && second === 168) return true
  return first === 172 && second >= 16 && second <= 31
}

async function detect(): Promise<string | null> {
  const host = mongoose.connection.host
  if (!host) return null
  const { address } = await lookup(host, { family: 4 })
  if (isPrivate(address)) return null
  const ip = ipv4ToInt(address)
  if (ip === null) return null
  const response = await fetch('https://ip-ranges.amazonaws.com/ip-ranges.json', { signal: AbortSignal.timeout(4_000) })
  if (!response.ok) return null
  const body = (await response.json()) as { prefixes?: Prefix[] }
  let best: { bits: number; region: string; ec2: boolean } | null = null
  for (const prefix of body.prefixes ?? []) {
    if (!prefix.ip_prefix || !prefix.region || !inCidr(ip, prefix.ip_prefix)) continue
    const bits = Number(prefix.ip_prefix.split('/')[1])
    const ec2 = prefix.service === 'EC2'
    if (!best || bits > best.bits || (bits === best.bits && ec2 && !best.ec2)) {
      best = { bits, region: prefix.region, ec2 }
    }
  }
  return best?.region ?? null
}

/** AWS region of the connected Atlas primary, without exposing the host. */
export function atlasCloudRegion(): Promise<string | null> {
  if (cached) return Promise.resolve(cached)
  pending ??= detect()
    .then((region) => {
      if (region) cached = region
      return region
    })
    .finally(() => {
      pending = null
    })
  return pending
}
