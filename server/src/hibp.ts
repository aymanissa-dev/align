import { createHash } from 'node:crypto'
import { HttpError } from './errors.ts'

const RANGE = 'https://api.pwnedpasswords.com/range/'

export async function assertPasswordNotBreached(password: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (process.env.NODE_ENV === 'test' && fetchImpl === fetch) return
  const digest = createHash('sha1').update(password).digest('hex').toUpperCase()
  const prefix = digest.slice(0, 5)
  const suffix = digest.slice(5)
  try {
    const response = await fetchImpl(`${RANGE}${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'align-password-check' },
      signal: AbortSignal.timeout(2_500),
    })
    if (!response.ok) return
    const body = await response.text()
    for (const line of body.split('\n')) {
      const [hash, count] = line.trim().split(':')
      if (hash === suffix && Number(count) > 0) {
        throw new HttpError(400, 'This password has appeared in a data breach. Choose a different one.')
      }
    }
  } catch (error) {
    if (error instanceof HttpError) throw error
  }
}
