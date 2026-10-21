import { lookup, resolveTxt } from 'node:dns/promises'
import mongoose from 'mongoose'

type Prefix = { ip_prefix?: string; region?: string; service?: string }

let cached: string | null = null
let pending: Promise<string> | null = null

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

async function detect(): Promise<string> {
  const host = mongoose.connection.host
  if (!host) return 'err:no-host'
  let address: string
  try {
    address = (await lookup(host, { family: 4 })).address
  } catch {
    return 'err:lookup'
  }
  if (isPrivate(address)) return 'err:private'
  const ip = ipv4ToInt(address)
  if (ip === null) return 'err:ip'
  let response: Response
  try {
    response = await fetch('https://ip-ranges.amazonaws.com/ip-ranges.json', { signal: AbortSignal.timeout(4_000) })
  } catch {
    return 'err:fetch'
  }
  if (!response.ok) return `err:fetch-${response.status}`
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
  if (best) return best.region
  const gcp = await matchGcp(ip).catch(() => null)
  if (gcp) return gcp
  return asnLabel(address)
}

async function matchGcp(ip: number): Promise<string | null> {
  const response = await fetch('https://www.gstatic.com/ipranges/cloud.json', { signal: AbortSignal.timeout(4_000) })
  if (!response.ok) return null
  const body = (await response.json()) as { prefixes?: { ipv4Prefix?: string; scope?: string }[] }
  let best: { bits: number; scope: string } | null = null
  for (const prefix of body.prefixes ?? []) {
    if (!prefix.ipv4Prefix || !prefix.scope || prefix.scope === 'global' || !inCidr(ip, prefix.ipv4Prefix)) continue
    const bits = Number(prefix.ipv4Prefix.split('/')[1])
    if (!best || bits > best.bits) best = { bits, scope: prefix.scope }
  }
  return best ? `gcp:${best.scope}` : null
}

async function asnLabel(address: string): Promise<string> {
  try {
    const reversed = address.split('.').reverse().join('.')
    const records = await resolveTxt(`${reversed}.origin.asn.cymru.com`)
    const text = records[0]?.join('') ?? ''
    const asn = text.split('|')[0]?.trim()
    const country = text.split('|')[2]?.trim()
    const block = text.split('|')[1]?.trim().split('.').slice(0, 2).join('.')
    if (!asn) return 'unmatched'
    return `asn:${asn}:${country || 'unknown'}:${block || 'unknown'}`
  } catch {
    return 'unmatched'
  }
}

/** AWS region of the connected Atlas primary, or a short error code. The host is never returned. */
export function atlasCloudRegion(): Promise<string> {
  if (cached) return Promise.resolve(cached)
  pending ??= detect()
    .then((region) => {
      cached = region
      return region
    })
    .finally(() => {
      pending = null
    })
  return pending
}
