import type bcryptjs from 'bcryptjs'

let loaded: Promise<typeof bcryptjs> | null = null

function bcrypt(): Promise<typeof bcryptjs> {
  loaded ??= import('bcryptjs').then((mod) => {
    const api = 'default' in mod && mod.default && typeof mod.default.hash === 'function' ? mod.default : mod
    return api as typeof bcryptjs
  })
  return loaded
}

export function bcryptRounds(): number {
  const configured = process.env.BCRYPT_ROUNDS
  if (configured && /^\d+$/.test(configured)) return Number(configured)
  return process.env.NODE_ENV === 'test' ? 4 : 12
}

export async function hashPassword(password: string): Promise<string> {
  const api = await bcrypt()
  return api.hash(password, bcryptRounds())
}

export async function checkPassword(password: string, hash: string): Promise<boolean> {
  const started = Date.now()
  const api = await bcrypt()
  const matches = await api.compare(password, hash)
  if (process.env.NODE_ENV !== 'test') {
    console.info(JSON.stringify({ msg: 'bcrypt-compare', ms: Date.now() - started, rounds: bcryptRounds() }))
  }
  return matches
}

let dummyHash: Promise<string> | null = null

export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('not-a-real-password')
  return dummyHash
}
