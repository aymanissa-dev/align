import bcrypt from 'bcryptjs'

export function bcryptRounds(): number {
  const configured = process.env.BCRYPT_ROUNDS
  if (configured && /^\d+$/.test(configured)) return Number(configured)
  return process.env.NODE_ENV === 'test' ? 4 : 12
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, bcryptRounds())
}

export async function checkPassword(password: string, hash: string): Promise<boolean> {
  const started = Date.now()
  const matches = await bcrypt.compare(password, hash)
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
