import { createHash, randomBytes } from 'node:crypto'
import type { Request } from 'express'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { HttpError } from '../errors.ts'
import { Notification, Passkey, SecurityEvent, User, WebAuthnChallenge } from '../models.ts'
import { hashToken } from '../session.ts'
import { generateRecoveryCodes, generateTotpSecret, otpauthUrl, verifyTotp } from '../totp.ts'

/** Indirection so tests can substitute the verifier without replacing the ESM export. */
export const authenticators = {
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
}

export function recoveryHash(code: string): string {
  return hashToken(code.replace(/\s+/g, '').toLowerCase())
}

export function webAuthnConfig(req: Request): { rpID: string; origin: string } {
  const headerOrigin = req.get('origin')
  const origin = (process.env.APP_ORIGIN || headerOrigin || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
  const rpID = process.env.WEBAUTHN_RP_ID || safeHost(origin)
  return { rpID, origin }
}

function safeHost(origin: string): string {
  try {
    return new URL(origin).hostname
  } catch {
    return 'localhost'
  }
}

export async function beginTotp(userId: string, email: string): Promise<{ secret: string; otpauth: string }> {
  const user = await User.findById(userId).select('+totpSecret')
  if (!user) throw new HttpError(401, 'Sign in to continue.')
  if (user.totpEnabledAt) throw new HttpError(409, 'Two-factor authentication is already on.')
  const secret = generateTotpSecret()
  user.totpSecret = secret
  await user.save()
  return { secret, otpauth: otpauthUrl(secret, email) }
}

export async function confirmTotp(userId: string, code: string): Promise<string[]> {
  const user = await User.findById(userId).select('+totpSecret +recoveryCodes')
  if (!user?.totpSecret) throw new HttpError(400, 'Start two-factor setup first.')
  if (!verifyTotp(user.totpSecret, code)) throw new HttpError(400, 'That code is not valid.')
  const codes = generateRecoveryCodes()
  user.set(
    'recoveryCodes',
    codes.map((value) => ({ hash: recoveryHash(value), usedAt: null })),
  )
  user.totpEnabledAt = new Date()
  await user.save()
  return codes
}

export async function disableTotp(userId: string): Promise<void> {
  const user = await User.findById(userId).select('+totpSecret +recoveryCodes')
  if (!user) throw new HttpError(401, 'Sign in to continue.')
  user.totpSecret = null
  user.totpEnabledAt = null
  user.set('recoveryCodes', [])
  await user.save()
}

export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const user = await User.findById(userId).select('+recoveryCodes')
  if (!user?.totpEnabledAt) throw new HttpError(400, 'Turn on two-factor authentication first.')
  const codes = generateRecoveryCodes()
  user.set(
    'recoveryCodes',
    codes.map((value) => ({ hash: recoveryHash(value), usedAt: null })),
  )
  await user.save()
  return codes
}

export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const hash = recoveryHash(code)
  const updated = await User.findOneAndUpdate(
    { _id: userId, recoveryCodes: { $elemMatch: { hash, usedAt: null } } },
    { $set: { 'recoveryCodes.$.usedAt': new Date() } },
  )
  return Boolean(updated)
}

export async function notifyPasswordReset(userId: string): Promise<void> {
  await Notification.create({
    userId,
    kind: 'password-reset',
    title: 'Your password was reset',
    projectName: '',
    dueDate: '',
    read: false,
    key: `password-reset:${randomBytes(8).toString('hex')}`,
  })
}

export async function notifyPasskeyAdded(userId: string): Promise<void> {
  await Notification.create({
    userId,
    kind: 'passkey-added',
    title: 'A passkey was added to your account',
    projectName: '',
    dueDate: '',
    read: false,
    key: `passkey-added:${randomBytes(8).toString('hex')}`,
  })
}

export async function userHasPasskey(userId: string): Promise<boolean> {
  return Boolean(await Passkey.exists({ userId }))
}

async function storeChallenge(userId: string | null, challenge: string, kind: 'register' | 'login' | 'stepup') {
  await WebAuthnChallenge.deleteMany({ userId, kind })
  await WebAuthnChallenge.create({
    userId,
    challenge,
    kind,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  })
}

async function takeChallenge(kind: 'register' | 'login' | 'stepup', expected: string): Promise<void> {
  const found = await WebAuthnChallenge.findOne({ challenge: expected, kind, expiresAt: { $gt: new Date() } })
  if (!found) throw new HttpError(400, 'That passkey ceremony expired. Try again.')
  await found.deleteOne()
}

export async function registrationOptions(req: Request, userId: string, email: string) {
  const { rpID } = webAuthnConfig(req)
  const existing = await Passkey.find({ userId }).select('credentialId transports')
  const options = await generateRegistrationOptions({
    rpName: 'Align',
    rpID,
    userName: email,
    userID: Buffer.from(userId),
    attestationType: 'none',
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports as ('internal' | 'hybrid')[],
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  })
  await storeChallenge(userId, options.challenge, 'register')
  return options
}

export async function verifyRegistration(req: Request, userId: string, response: RegistrationResponseJSON, name: string) {
  const { rpID, origin } = webAuthnConfig(req)
  const challenge = response.response.clientDataJSON
  const client = JSON.parse(Buffer.from(challenge, 'base64url').toString('utf8')) as { challenge?: string }
  if (!client.challenge) throw new HttpError(400, 'Passkey response is invalid.')
  await takeChallenge('register', client.challenge)
  const verified = await authenticators.verifyRegistrationResponse({
    response,
    expectedChallenge: client.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  })
  if (!verified.verified) throw new HttpError(400, 'Passkey could not be verified.')
  const credential = verified.registrationInfo.credential
  await Passkey.create({
    userId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    name: name.slice(0, 80) || 'Passkey',
  })
}

export async function authenticationOptions(req: Request, userId?: string) {
  const { rpID } = webAuthnConfig(req)
  const existing = userId ? await Passkey.find({ userId }).select('credentialId transports') : []
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: userId ? 'discouraged' : 'required',
    allowCredentials: existing.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports as ('internal' | 'hybrid')[],
    })),
  })
  await storeChallenge(userId ?? null, options.challenge, userId ? 'stepup' : 'login')
  return options
}

export async function verifyPasskey(
  req: Request,
  response: AuthenticationResponseJSON,
  kind: 'login' | 'stepup',
): Promise<{ userId: string; passkeyId: string }> {
  const { rpID, origin } = webAuthnConfig(req)
  const client = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8')) as {
    challenge?: string
  }
  if (!client.challenge) throw new HttpError(400, 'Passkey response is invalid.')
  await takeChallenge(kind, client.challenge)
  const passkey = await Passkey.findOne({ credentialId: response.id })
  if (!passkey) throw new HttpError(401, 'Passkey not recognized.')
  const verified = await authenticators.verifyAuthenticationResponse({
    response,
    expectedChallenge: client.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: kind === 'login',
    credential: {
      id: passkey.credentialId,
      publicKey: new Uint8Array(passkey.publicKey),
      counter: passkey.counter,
      transports: passkey.transports as ('internal' | 'hybrid')[],
    },
  })
  if (!verified.verified) throw new HttpError(401, 'Passkey could not be verified.')
  passkey.counter = verified.authenticationInfo.newCounter
  await passkey.save()
  return { userId: passkey.userId.toString(), passkeyId: passkey.id }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function listPasskeys(userId: string) {
  return Passkey.find({ userId }).sort({ createdAt: -1 }).lean()
}

export async function deletePasskey(userId: string, id: string): Promise<boolean> {
  const removed = await Passkey.deleteOne({ _id: id, userId })
  return removed.deletedCount === 1
}

export async function listSecurityEvents(userId: string) {
  return SecurityEvent.find({ userId }).sort({ createdAt: -1 }).limit(50).lean()
}
