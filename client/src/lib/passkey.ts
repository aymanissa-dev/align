import { startAuthentication, startRegistration, type AuthenticationResponseJSON, type RegistrationResponseJSON } from '@simplewebauthn/browser'
import { api } from '../api/index.ts'
import { ApiError } from '../api/errors.ts'
import type { User } from '../api/types.ts'

export const PASSKEY_UNAVAILABLE = 'No passkey is available on this device. Use your password or recovery key.'

export function passkeySupported(): boolean {
  return typeof PublicKeyCredential !== 'undefined'
}

export function passkeyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return PASSKEY_UNAVAILABLE
}

function aborted(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function authenticate(options: unknown): Promise<AuthenticationResponseJSON> {
  if (!passkeySupported()) throw new Error(PASSKEY_UNAVAILABLE)
  try {
    return await startAuthentication({ optionsJSON: options as never })
  } catch (error) {
    if (aborted(error)) throw error
    throw new Error(PASSKEY_UNAVAILABLE)
  }
}

export async function signInWithPasskey(): Promise<User> {
  const options = await api.passkeyLoginOptions()
  const credential = await authenticate(options)
  return api.passkeyLoginVerify(credential)
}

export async function stepUpWithPasskey(): Promise<void> {
  const options = await api.passkeyStepUpOptions()
  const credential = await authenticate(options)
  await api.passkeyStepUpVerify(credential)
}

export async function registerPasskey(): Promise<RegistrationResponseJSON> {
  if (!passkeySupported()) throw new Error(PASSKEY_UNAVAILABLE)
  const options = await api.passkeyRegisterOptions()
  try {
    return await startRegistration({ optionsJSON: options as never })
  } catch (error) {
    if (aborted(error)) throw error
    throw new Error(PASSKEY_UNAVAILABLE)
  }
}

export async function conditionalPasskey(): Promise<User | null> {
  if (!passkeySupported() || !PublicKeyCredential.isConditionalMediationAvailable) return null
  const available = await PublicKeyCredential.isConditionalMediationAvailable()
  if (!available) return null
  const options = await api.passkeyLoginOptions()
  try {
    const credential = await startAuthentication({ optionsJSON: options as never, useBrowserAutofill: true })
    return await api.passkeyLoginVerify(credential)
  } catch (error) {
    if (aborted(error)) return null
    return null
  }
}
