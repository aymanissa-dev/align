import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/index.ts'
import type { User } from '../api/types.ts'
import { useAuth } from '../auth/auth-context.ts'
import { AuthFrame } from '../components/AuthFrame.tsx'
import { PasswordMeter } from '../components/PasswordMeter.tsx'
import { RecoveryKeyNotice } from '../components/RecoveryKeyNotice.tsx'
import { Button, Field, Input } from '../components/ui.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
import { isMediumPassword, MEDIUM_PASSWORD_HINT, MEDIUM_PASSWORD_MESSAGE } from '../lib/passwordStrength.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function ForgotPasswordPage() {
  const { acceptSession } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [issuedKey, setIssuedKey] = useState('')
  const [signedIn, setSignedIn] = useState<User | null>(null)
  useDocumentTitle('Reset password')

  function validatePassword(): boolean {
    if (!isMediumPassword(password)) {
      setError(MEDIUM_PASSWORD_MESSAGE)
      return false
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return false
    }
    return true
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email.')
      return
    }
    if (!validatePassword()) return
    if (!recoveryKey.trim()) {
      setError('Enter your account recovery key.')
      return
    }
    setPending(true)
    try {
      const result = await api.resetPassword({
        email: email.trim(),
        password,
        recoveryKey: recoveryKey.trim(),
        ...(code.trim() ? { code: code.trim() } : {}),
      })
      const { recoveryKey: nextKey, ...user } = result
      setIssuedKey(nextKey)
      setSignedIn(user)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  if (issuedKey && signedIn) {
    return (
      <AuthFrame title="Save your new recovery key" lede="The previous key no longer works. Align does not email a copy.">
        <RecoveryKeyNotice recoveryKey={issuedKey} onSaved={() => acceptSession(signedIn)} />
      </AuthFrame>
    )
  }

  return (
    <AuthFrame
      title="Reset password"
      lede="A reset always needs the account recovery key from signup. If two-factor authentication is on, it also needs a current authenticator code or a two-factor recovery code. A code by itself cannot reset the password. Align does not send email. To change the password with a passkey, sign in with that passkey and confirm it is you in Settings."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label="New password" htmlFor="password" hint={MEDIUM_PASSWORD_HINT}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <PasswordMeter password={password} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm">
          <Input
            id="confirm"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
          />
        </Field>
        <Field label="Account recovery key" htmlFor="account-recovery-key">
          <Input
            id="account-recovery-key"
            name="recovery-key"
            autoComplete="off"
            spellCheck={false}
            value={recoveryKey}
            onChange={(event) => setRecoveryKey(event.target.value)}
            required
          />
        </Field>
        <Field
          label="Authenticator or two-factor recovery code"
          htmlFor="reset-code"
          hint="Required when two-factor authentication is on. Leave this blank otherwise."
        >
          <Input
            id="reset-code"
            name="one-time-code"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-neutral-800">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? 'Resetting…' : 'Reset password'}
        </Button>
      </form>
      <p className="mt-6 text-sm text-neutral-500">
        <Link to="/login" className="focus-ring text-neutral-950 underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </AuthFrame>
  )
}
