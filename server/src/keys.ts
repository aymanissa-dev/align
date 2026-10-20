import jwt from 'jsonwebtoken'
import { HttpError } from './errors.ts'

export type SigningKey = { kid: string; secret: string }

export function signingKeys(): SigningKey[] {
  const current = process.env.JWT_SECRET
  if (!current) throw new HttpError(500, 'Auth is not configured.')
  const keys: SigningKey[] = [{ kid: process.env.JWT_KID || 'current', secret: current }]
  if (process.env.JWT_SECRET_PREVIOUS) {
    keys.push({
      kid: process.env.JWT_KID_PREVIOUS || 'previous',
      secret: process.env.JWT_SECRET_PREVIOUS,
    })
  }
  return keys
}

export function signJwt(payload: jwt.JwtPayload, expiresIn: jwt.SignOptions['expiresIn']): string {
  const key = signingKeys()[0]
  if (!key) throw new HttpError(500, 'Auth is not configured.')
  return jwt.sign(payload, key.secret, { expiresIn, algorithm: 'HS256', header: { kid: key.kid, alg: 'HS256' } })
}

export function verifyJwt(token: string): jwt.JwtPayload | null {
  const decoded = jwt.decode(token, { complete: true })
  const kid =
    decoded && typeof decoded === 'object' && typeof decoded.header.kid === 'string' ? decoded.header.kid : undefined
  const keys = signingKeys()
  const ordered = [...keys.filter((key) => key.kid === kid), ...keys.filter((key) => key.kid !== kid)]
  for (const key of ordered) {
    try {
      const payload = jwt.verify(token, key.secret)
      if (typeof payload === 'string') return null
      return payload
    } catch {
      continue
    }
  }
  return null
}
