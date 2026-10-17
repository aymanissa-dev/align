import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/index.ts'
import { useAuth } from '../auth/auth-context.ts'
import { AuthFrame } from '../components/AuthFrame.tsx'
import { PasswordMeter } from '../components/PasswordMeter.tsx'
import { Button, Field, Input } from '../components/ui.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
import { isMediumPassword, MEDIUM_PASSWORD_HINT, MEDIUM_PASSWORD_MESSAGE } from '../lib/passwordStrength.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function ResetPasswordPage() {
  const { acceptSession } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  useDocumentTitle('Choose a new password')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!token) {
      setError('This reset link is invalid or has expired.')
      return
    }
    if (!isMediumPassword(password)) {
      setError(MEDIUM_PASSWORD_MESSAGE)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setPending(true)
    try {
      const user = await api.resetPassword({ token, password })
      acceptSession(user)
      navigate('/', { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
      setPending(false)
    }
  }

  return (
    <AuthFrame title="Choose a new password" lede="This replaces the password on your account.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="New password" htmlFor="password" hint={MEDIUM_PASSWORD_HINT} error={error}>
          <Input
            id="password"
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
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" className="w-full" disabled={pending || !token}>
          {pending ? 'Saving…' : 'Update password'}
        </Button>
      </form>
      <p className="mt-6 text-sm text-neutral-500">
        <Link to="/forgot" className="focus-ring text-neutral-950 underline underline-offset-4">
          Request a new link
        </Link>
      </p>
    </AuthFrame>
  )
}
