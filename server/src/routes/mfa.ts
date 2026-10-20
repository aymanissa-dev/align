import { Router } from 'express'
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
} from '../data/factors.ts'
import { ensurePersonalWorkspace } from '../data/workspaces.ts'
import { users } from '../data/users.ts'
import { recordSecurity } from '../data/securityLog.ts'
import { HttpError } from '../errors.ts'
import { asyncHandler, currentUserId, requireAuth } from '../middleware.ts'
import { checkPassword } from '../password.ts'
import { publicUser } from '../serialize.ts'
import {
  coarseIp,
  markStepUp,
  readCookie,
  startSession,
  stepUpFresh,
  loadSession,
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

async function assertStepUp(req: { sessionId?: string; headers: { cookie?: string } }, password?: string, userId?: string) {
  if (req.sessionId) {
    const session = await loadSession(req.sessionId)
    if (session && stepUpFresh(session.stepUpAt)) return
  }
  if (password && userId) {
    const user = await users.byIdSecret(userId)
    if (user?.passwordHash && (await checkPassword(password, user.passwordHash))) {
      if (req.sessionId) await markStepUp(req.sessionId)
      return
    }
  }
  throw new HttpError(403, 'Confirm it is you to continue.', { code: 'step_up_required' })
}

export function mfaRouter(): Router {
  const router = Router()

  router.post(
    '/totp/setup',
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await users.byId(currentUserId(req))
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
      const codes = await confirmTotp(currentUserId(req), input.code)
      if (req.sessionId) await markStepUp(req.sessionId)
      await recordSecurity({
        userId: currentUserId(req),
        type: 'totp-enabled',
        summary: 'Two-factor authentication was turned on.',
        ipCoarse: coarseIp(req.ip),
      })
      res.json({ recoveryCodes: codes })
    }),
  )

  router.post(
    '/totp/disable',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(stepUpSchema, req.body)
      await assertStepUp(req, body.password, currentUserId(req))
      if (body.code) {
        const user = await users.byIdSecret(currentUserId(req))
        if (!user?.totpSecret || !verifyTotp(user.totpSecret, body.code)) {
          throw new HttpError(400, 'That code is not valid.')
        }
      }
      await disableTotp(currentUserId(req))
      await recordSecurity({
        userId: currentUserId(req),
        type: 'totp-disabled',
        summary: 'Two-factor authentication was turned off.',
        ipCoarse: coarseIp(req.ip),
      })
      res.status(204).send()
    }),
  )

  router.post(
    '/recovery/regenerate',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(stepUpSchema, req.body)
      await assertStepUp(req, body.password, currentUserId(req))
      const codes = await regenerateRecoveryCodes(currentUserId(req))
      await recordSecurity({
        userId: currentUserId(req),
        type: 'recovery-regenerated',
        summary: 'Recovery codes were replaced.',
        ipCoarse: coarseIp(req.ip),
      })
      res.json({ recoveryCodes: codes })
    }),
  )

  router.post(
    '/login/mfa',
    asyncHandler(async (req, res) => {
      const input = parseBody(mfaSchema, req.body)
      const userId = pendingUser(req)
      const user = await users.byIdSecret(userId)
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      const ok =
        input.method === 'totp'
          ? Boolean(user.totpSecret && verifyTotp(user.totpSecret, input.code))
          : await consumeRecoveryCode(user.id, input.code)
      if (!ok) {
        await recordSecurity({
          userId: user.id,
          type: 'mfa-failed',
          summary: 'A two-factor code was rejected.',
          ipCoarse: coarseIp(req.ip),
        })
        throw new HttpError(401, 'That code is not valid.')
      }
      res.clearCookie('pending', { path: '/' })
      await ensurePersonalWorkspace(user.id)
      const started = await startSession(req, res, user.id)
      await recordSecurity({
        userId: user.id,
        type: 'sign-in',
        summary: input.method === 'totp' ? 'Signed in with an authenticator code.' : 'Signed in with a recovery code.',
        ipCoarse: coarseIp(req.ip),
      })
      res.json({ ...publicUser(user), newDevice: started.newDevice })
    }),
  )

  router.post(
    '/step-up',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = parseBody(stepUpSchema, req.body)
      if (body.password) {
        await assertStepUp(req, body.password, currentUserId(req))
        res.status(204).send()
        return
      }
      if (body.code && body.method !== 'recovery') {
        const user = await users.byIdSecret(currentUserId(req))
        if (!user?.totpSecret || !verifyTotp(user.totpSecret, body.code)) {
          throw new HttpError(400, 'That code is not valid.')
        }
        if (req.sessionId) await markStepUp(req.sessionId)
        res.status(204).send()
        return
      }
      if (body.code) {
        const ok = await consumeRecoveryCode(currentUserId(req), body.code)
        if (!ok) throw new HttpError(400, 'That code is not valid.')
        if (req.sessionId) await markStepUp(req.sessionId)
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
          createdAt: event.createdAt.toISOString(),
        })),
      )
    }),
  )

  router.post(
    '/passkeys/register/options',
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await users.byId(currentUserId(req))
      if (!user) throw new HttpError(401, 'Sign in to continue.')
      res.json(await registrationOptions(req, user.id, user.email))
    }),
  )

  router.post(
    '/passkeys/register/verify',
    requireAuth,
    asyncHandler(async (req, res) => {
      const name = typeof req.body?.name === 'string' ? req.body.name : 'Passkey'
      await verifyRegistration(req, currentUserId(req), req.body as RegistrationResponseJSON, name)
      await recordSecurity({
        userId: currentUserId(req),
        type: 'passkey-added',
        summary: 'A passkey was added.',
        ipCoarse: coarseIp(req.ip),
      })
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
      await assertStepUp(req, body.password, currentUserId(req))
      const removed = await deletePasskey(currentUserId(req), req.params.id)
      if (!removed) throw new HttpError(404, 'Passkey not found.')
      await recordSecurity({
        userId: currentUserId(req),
        type: 'passkey-removed',
        summary: 'A passkey was removed.',
        ipCoarse: coarseIp(req.ip),
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
      const started = await startSession(req, res, user.id)
      await recordSecurity({
        userId: user.id,
        type: 'sign-in',
        summary: 'Signed in with a passkey.',
        ipCoarse: coarseIp(req.ip),
      })
      res.json({ ...publicUser(user), newDevice: started.newDevice })
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
      if (req.sessionId) await markStepUp(req.sessionId)
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
