import { randomBytes } from 'node:crypto'
import { Types } from 'mongoose'
import { users } from './data/users.ts'
import { deliverMail } from './mail.ts'
import { AuthToken } from './models.ts'
import { hashToken } from './session.ts'
import { issueAuthToken } from './tokens.ts'

export const RESET_MESSAGE = "If an account exists, we've sent a reset link."
export const VERIFY_MESSAGE = "We've sent a verification link."
export const REGISTER_MESSAGE = 'Check your email to finish creating your account.'

/** Hide a hit-versus-miss database lookup. Mail adds its own round trip, so the floor is longer then. */
const QUIET_FLOOR_MS = 300
const MAIL_FLOOR_MS = 1000

/**
 * Emailed tokens may appear in a JSON body only outside production, and only
 * when this flag is set. Vercel production never qualifies, even if NODE_ENV
 * were overridden.
 */
export function exposeDevTokens(): boolean {
  if (process.env.VERCEL_ENV === 'production') return false
  if (process.env.NODE_ENV === 'production') return false
  return process.env.EXPOSE_DEV_TOKENS === '1'
}

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM)
}

/** Do the same hash and indexed delete a real token issue does, without storing one. */
export async function burnAuthTokenWork(type: 'verify' | 'reset'): Promise<void> {
  const token = randomBytes(32).toString('hex')
  hashToken(token)
  await AuthToken.deleteMany({ userId: new Types.ObjectId(), type, usedAt: null })
}

export function logMailRequest(kind: 'password-reset-requested' | 'verification-requested', email: string): void {
  if (exposeDevTokens() || mailConfigured()) return
  console.info(JSON.stringify({ msg: kind, email }))
}

export async function settleMailResponse(started: number): Promise<void> {
  if (exposeDevTokens()) return
  const floor = mailConfigured() ? MAIL_FLOOR_MS : QUIET_FLOOR_MS
  const wait = floor - (performance.now() - started)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
}

/** Same host and timeout as a real send, with a body Resend will reject before delivering. */
async function matchUnknownMailTiming(): Promise<void> {
  if (!mailConfigured()) return
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    // Timing only. An unknown address must not finish before a real delivery.
  }
}

type MailedToken = {
  userId: string
  email: string
  type: 'verify' | 'reset'
  subject: string
  text: (link: string) => string
  origin: string
  path: 'reset' | 'verify'
  log: 'password-reset-requested' | 'verification-requested'
}

/**
 * Store a token only when mail can carry it, or when the dev flag is on.
 * The return value is safe to put in a response: it is undefined in production.
 */
export async function issueMailedToken(options: MailedToken): Promise<string | undefined> {
  if (!mailConfigured() && !exposeDevTokens()) {
    await burnAuthTokenWork(options.type)
    logMailRequest(options.log, options.email)
    return undefined
  }
  const token = await issueAuthToken(options.userId, options.type)
  if (!mailConfigured()) return exposeDevTokens() ? token : undefined
  const link = `${options.origin}/${options.path}?token=${encodeURIComponent(token)}`
  const mailed = await deliverMail({ to: options.email, subject: options.subject, text: options.text(link) })
  if (mailed || exposeDevTokens()) return exposeDevTokens() && !mailed ? token : undefined
  await AuthToken.deleteMany({ userId: options.userId, type: options.type, usedAt: null })
  return undefined
}

export function devTokenField(key: 'resetToken' | 'verifyToken', token: string | undefined): Record<string, string> {
  if (!token || !exposeDevTokens()) return {}
  return { [key]: token }
}

/** Tell an existing account that someone used their address on the signup form. */
export async function sendSignupNotice(email: string): Promise<void> {
  if (!mailConfigured()) return
  await deliverMail({
    to: email,
    subject: 'Someone tried to sign up with your email',
    text: "Someone tried to sign up with your email. If this was you, sign in with your existing password. If it wasn't, you can ignore this message.",
  })
}

export async function preparePasswordReset(email: string, origin: string): Promise<string | undefined> {
  const user = await users.byEmail(email)
  if (!user) {
    await burnAuthTokenWork('reset')
    logMailRequest('password-reset-requested', email)
    await matchUnknownMailTiming()
    return undefined
  }
  return issueMailedToken({
    userId: user.id,
    email: user.email,
    type: 'reset',
    subject: 'Reset your Align password',
    text: (link) => `Reset your password by opening this link within one hour:\n${link}`,
    origin,
    path: 'reset',
    log: 'password-reset-requested',
  })
}
