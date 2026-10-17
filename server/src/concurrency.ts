import type { Request, Response } from 'express'
import { CONFLICT_MESSAGE } from '../../shared/contract.ts'
import { HttpError } from './errors.ts'

/** If-Match is the document version the client edited. `*` overwrites that check. */
export function expectedVersion(req: Request): number | '*' | undefined {
  const raw = req.get('If-Match')
  if (!raw) return undefined
  const value = raw.trim()
  if (value === '*') return '*'
  const match = /^(?:W\/)?"(\d+)"$/.exec(value)
  if (!match) throw new HttpError(400, 'If-Match must be a version.')
  return Number(match[1])
}

export function assertVersion(current: number | null | undefined, expected: number | '*' | undefined) {
  if (expected === undefined || expected === '*') return
  if ((current ?? 0) !== expected) throw new HttpError(409, CONFLICT_MESSAGE)
}

export function stampVersion(res: Response, version: number | null | undefined) {
  res.set('ETag', `W/"${version ?? 0}"`)
}
