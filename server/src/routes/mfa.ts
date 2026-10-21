import { Router, type Request, type RequestHandler } from 'express'
import QRCode from 'qrcode'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import {
  authenticationOptions,
  beginTotp,
  confirmTotp,
  consumeRecoveryCode,
  disableTotp,
  regenerateRecoveryCodes,
  listPasskeys,
  listSecurityEvents,
  registrationOptions,
  userHasPasskey,
  verifyPasskey,
  verifyRegistration,
  deletePasskey,
  notifyPasskeyAdded,
} from '../data/factors.ts'
import { ensurePersonalWorkspace } from '../data/workspaces.ts'
import { users } from '../data/users.ts'
import { recordSecurity } from '../data/securityLog.ts'
import { HttpError } from '../errors.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { checkPassword } from '../password.ts'
import { clientIp } from '../clientIp.ts'
import { clearMfaFailures, delayFailedAttempt, guardMfa, recordMfaFailure } from '../rateLimit.ts'
import { publicUser } from '../serialize.ts'
import { dashboardForUser } from './dashboard.ts'
import {
  markStepUp,
  readCookie,
  requestAudit,
  requireFreshStepUp,
  startSession,
} from '../session.ts'
import { verifyTotp } from '../totp.ts'
import { mfaSchema, parseBody, stepUpSchema, totpCodeSchema } from '../validate.ts'
import { verifyJwt } from '../keys.ts'

function pendingUser(req: { headers: { cookie?: string } }): string {
  const token = readCookie(req.headers.cookie, 'pending')
  const payload = token ? verifyJwt(token) : null
  if (!payload || payload.typ !== 'pending' || typeof payload.sub !== 'string') {
    throw new HttpError(401, 'Sign in to continue.')
  }
  return payload.sub
}

async function noteStepUp(req: Request, userId: string, summary: string) {
  if (req.sessionId) await markStepUp(req.sessionId)
  await recordSecurity({
    userId,
    type: 'step-up',
    summary,
    ...requestAudit(req),
  })
}

function credentialText(value: string | undefined): string {
  return value?.trim() ?? ''
}

/** Reject a blank password and a blank code before any other sensitive check. */
export function assertCredentialPresent(body: { password?: string; code?: string }): void {
  if (!credentialText(body.password) && !credentialText(body.code)) {
    throw new HttpError(400, 'Enter your current password or a verification code.')
  }
}

/**
 * A fresh step-up is not itself a credential. Password, authenticator code, or
 * recovery code must still match, and a match here does not refresh stepUpAt.
 */
export async function requireSensitiveCredential(
  userId: string,
  body: { password?: string; code?: string },
): Promise<void> {
  const password = credentialText(body.password)
  const code = credentialText(body.code)
  assertCredentialPresent(body)
  const user = await users.byIdSecret(userId)
  if (password && user?.passwordHash && (await checkPassword(password, user.passwordHash))) return
  if (code && user?.totpSecret && verifyTotp(user.totpSecret, code)) return
  if (code && (await consumeRecoveryCode(userId, code))) return
  throw new HttpError(400, code ? 'That code is not valid.' : 'Current password is incorrect.')
}

/** TOTP enrolment needs the account password, and a blank one fails before step-up. */
async function requireAccountPassword(req: Request, userId: string): Promise<void> {
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!password.trim()) throw new HttpError(400, 'Enter your current password.')
  await requireFreshStepUp(req.sessionId)
  const user = await users.byIdSecret(userId)
  if (!user?.passwordHash || !(await checkPassword(password, user.passwordHash))) {
    throw new HttpError(400, 'Current password is incorrect.')
  }
}

export function mfaRouter(limiter?: RequestHandler): Router {
  const router = Router()

  router.post(
    '/totp/setup',
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req)
      await requireAccountPassword(req, userId)
      const user = await users.byId(userId)
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      const started = await beginTotp(user.id, user.email)
      const qr = await QRCode.toDataURL(started.otpauth)
      res.json({ secret: started.secret, otpauth: started.otpauth, qr })
    }),
  )

  router.post(
    '/totp/confirm',
    requireAuth,
    asyncHandler(async (req, res) => {
      const input = parseBody(totpCodeSchema, req.body)
      const userId = currentUserId(req)
      await requireAccountPassword(req, userId)
      const codes = await confirmTotp(userId, input.code)
      await recordSecurity({
        userId,
        type: 'totp-enabled',
        summary: 'Two-factor authentication was turned on.',
        ...requestAudit(req),
      })
      res.json({ recoveryCodes: codes })
    }),
  )

  router.post(
    '/totp/disable',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(stepUpSchema, req.body)
      assertCredentialPresent(body)
      await requireFreshStepUp(req.sessionId)
      await requireSensitiveCredential(currentUserId(req), body)
      await disableTotp(currentUserId(req))
      await recordSecurity({
        userId: currentUserId(req),
        type: 'totp-disabled',
        summary: 'Two-factor authentication was turned off.',
        ...requestAudit(req),
      })
      res.status(204).send()
    }),
  )

  router.post(
    '/recovery/regenerate',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(stepUpSchema, req.body)
      assertCredentialPresent(body)
      await requireFreshStepUp(req.sessionId)
      await requireSensitiveCredential(currentUserId(req), body)
      const codes = await regenerateRecoveryCodes(currentUserId(req))
      await recordSecurity({
        userId: currentUserId(req),
        type: 'recovery-regenerated',
        summary: 'Recovery codes were replaced.',
        ...requestAudit(req),
      })
      res.json({ recoveryCodes: codes })
    }),
  )

  router.post(
    '/login/mfa',
    ...(limiter ? [limiter] : []),
    asyncHandler(async (req, res) => {
      const input = parseBody(mfaSchema, req.body)
      const userId = pendingUser(req)
      const ip = clientIp(req)
      await guardMfa(ip, userId)
      const user = await users.byIdSecret(userId)
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      const ok =
        input.method === 'totp'
          ? Boolean(user.totpSecret && verifyTotp(user.totpSecret, input.code))
          : await consumeRecoveryCode(user.id, input.code)
      if (!ok) {
        const failures = await recordMfaFailure(ip, user.id)
        await recordSecurity({
          userId: user.id,
          type: 'mfa-failed',
          summary: 'A two-factor code was rejected.',
          ...requestAudit(req),
        })
        await delayFailedAttempt(failures)
        throw new HttpError(401, 'That code is not valid.')
      }
      await clearMfaFailures(user.id)
      res.clearCookie('pending', { path: '/' })
      await ensurePersonalWorkspace(user.id)
      const fresh = (await users.byId(user.id)) ?? user
      const [started, dashboard] = await Promise.all([
        startSession(req, res, user.id),
        dashboardForUser(fresh),
      ])
      await recordSecurity({
        userId: user.id,
        type: 'sign-in',
        summary: input.method === 'totp' ? 'Signed in with an authenticator code.' : 'Signed in with a recovery code.',
        ...requestAudit(req),
      })
      res.json({ ...publicUser(user), newDevice: started.newDevice, ...(dashboard ? { dashboard } : {}) })
    }),
  )

  router.post(
    '/step-up',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(stepUpSchema, req.body)
      const userId = currentUserId(req)
      if (!req.sessionId) throw new HttpError(401, 'Sign in to continue.')
      if (body.password) {
        const user = await users.byIdSecret(userId)
        if (!user?.passwordHash || !(await checkPassword(body.password, user.passwordHash))) {
          throw new HttpError(403, 'That password is not valid.')
        }
        await noteStepUp(req, userId, 'Confirmed this session with a password.')
        res.status(204).send()
        return
      }
      if (body.code && body.method !== 'recovery') {
        const user = await users.byIdSecret(userId)
        if (!user?.totpSecret || !verifyTotp(user.totpSecret, body.code)) {
          throw new HttpError(400, 'That code is not valid.')
        }
        await noteStepUp(req, userId, 'Confirmed this session with an authenticator code.')
        res.status(204).send()
        return
      }
      if (body.code) {
        const ok = await consumeRecoveryCode(userId, body.code)
        if (!ok) throw new HttpError(400, 'That code is not valid.')
        await noteStepUp(req, userId, 'Confirmed this session with a recovery code.')
        res.status(204).send()
        return
      }
      throw new HttpError(400, 'Confirm it is you to continue.')
    }),
  )

  router.get(
    '/security-events',
    requireAuth,
    asyncHandler(async (req, res) => {
      const events = await listSecurityEvents(currentUserId(req))
      res.json(
        events.map((event) => ({
          id: event._id.toString(),
          type: event.type,
          summary: event.summary,
          ip: event.ipCoarse,
          device: event.device ?? '',
          deviceType: event.deviceType ?? '',
          location: event.location ?? '',
          createdAt: event.createdAt.toISOString(),
        })),
      )
    }),
  )

  router.post(
    '/passkeys/register/options',
    requireAuth,
    asyncHandler(async (req, res) => {
      await requireFreshStepUp(req.sessionId)
      const user = await users.byId(currentUserId(req))
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      res.json(await registrationOptions(req, user.id, user.email))
    }),
  )

  router.post(
    '/passkeys/register/verify',
    requireAuth,
    asyncHandler(async (req, res) => {
      await requireFreshStepUp(req.sessionId)
      const userId = currentUserId(req)
      const name = typeof req.body?.name === 'string' ? req.body.name : 'Passkey'
      await verifyRegistration(req, userId, req.body as RegistrationResponseJSON, name)
      await recordSecurity({
        userId,
        type: 'passkey-added',
        summary: 'A passkey was added.',
        ...requestAudit(req),
      })
      await notifyPasskeyAdded(userId)
      res.status(204).send()
    }),
  )

  router.get(
    '/passkeys',
    requireAuth,
    asyncHandler(async (req, res) => {
      const passkeys = await listPasskeys(currentUserId(req))
      res.json(
        passkeys.map((passkey) => ({
          id: passkey._id.toString(),
          name: passkey.name,
          createdAt: passkey.createdAt.toISOString(),
        })),
      )
    }),
  )

  router.delete(
    '/passkeys/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(stepUpSchema, req.body ?? {})
      assertCredentialPresent(body)
      await requireFreshStepUp(req.sessionId)
      await requireSensitiveCredential(currentUserId(req), body)
      const removed = await deletePasskey(currentUserId(req), req.params.id)
      if (!removed) throw new HttpError(404, 'Passkey not found.')
      await recordSecurity({
        userId: currentUserId(req),
        type: 'passkey-removed',
        summary: 'A passkey was removed.',
        ...requestAudit(req),
      })
      res.status(204).send()
    }),
  )

  router.post(
    '/passkeys/login/options',
    asyncHandler(async (req, res) => {
      res.json(await authenticationOptions(req))
    }),
  )

  router.post(
    '/passkeys/login/verify',
    asyncHandler(async (req, res) => {
      const verified = await verifyPasskey(req, req.body as AuthenticationResponseJSON, 'login')
      const user = await users.byId(verified.userId)
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      await ensurePersonalWorkspace(user.id)
      const fresh = (await users.byId(user.id)) ?? user
      const [started, dashboard] = await Promise.all([
        startSession(req, res, user.id),
        dashboardForUser(fresh),
      ])
      await recordSecurity({
        userId: user.id,
        type: 'sign-in',
        summary: 'Signed in with a passkey.',
        ...requestAudit(req),
      })
      res.json({ ...publicUser(user), newDevice: started.newDevice, ...(dashboard ? { dashboard } : {}) })
    }),
  )

  router.post(
    '/passkeys/step-up/options',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await authenticationOptions(req, currentUserId(req)))
    }),
  )

  router.post(
    '/passkeys/step-up/verify',
    requireAuth,
    asyncHandler(async (req, res) => {
      const verified = await verifyPasskey(req, req.body as AuthenticationResponseJSON, 'stepup')
      if (verified.userId !== currentUserId(req)) throw new HttpError(401, 'Passkey not recognized.')
      await noteStepUp(req, currentUserId(req), 'Confirmed this session with a passkey.')
      res.status(204).send()
    }),
  )

  router.get(
    '/mfa',
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await users.byId(currentUserId(req))
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      res.json({ totp: Boolean(user.totpEnabledAt), passkey: await userHasPasskey(user.id) })
    }),
  )

  return router
}
