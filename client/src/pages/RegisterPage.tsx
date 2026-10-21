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

export function RegisterPage() {
  const { acceptSession } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [created, setCreated] = useState<User | null>(null)
  useDocumentTitle('Create account')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email.')
      return
    }
    if (!isMediumPassword(password)) {
      setError(MEDIUM_PASSWORD_MESSAGE)
      return
    }
    setError('')
    setPending(true)
    try {
      const result = await api.register({ name, email, password })
      const { recoveryKey: key, ...user } = result
      setRecoveryKey(key)
      setCreated(user)
    } catch (caught) {
      setError(errorMessage(caught))
      setPending(false)
    }
  }

  return (
    <AuthFrame
      title={recoveryKey ? 'Save your recovery key' : 'Create an account'}
      lede={
        recoveryKey
          ? 'Align does not send email. This key is how you reset the password later.'
          : 'A workspace for projects, tasks, and notes.'
      }
    >
      {recoveryKey && created ? (
        <RecoveryKeyNotice recoveryKey={recoveryKey} onSaved={() => acceptSession(created)} />
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Name" htmlFor="name">
            <Input
              id="name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
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
          <Field label="Password" htmlFor="password" hint={MEDIUM_PASSWORD_HINT}>
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
          {error ? (
            <p role="alert" className="text-sm text-neutral-800">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      )}
      {recoveryKey ? null : (
        <p className="mt-6 text-sm text-neutral-500">
          Already have an account?{' '}
          <Link to="/login" className="focus-ring text-neutral-950 underline underline-offset-4">
            Sign in
          </Link>
        </p>
      )}
    </AuthFrame>
  )
}
