import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/index.ts'
import { AuthFrame } from '../components/AuthFrame.tsx'
import { Button, Field, Input } from '../components/ui.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [resetToken, setResetToken] = useState('')
  const [sentMessage, setSentMessage] = useState('')
  const [sent, setSent] = useState(false)
  useDocumentTitle('Reset password')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!email.trim()) {
      setError('Email is required.')
      return
    }
    setPending(true)
    try {
      const result = await api.forgotPassword(email.trim())
      setSent(true)
      setSentMessage(result.message)
      setResetToken(result.resetToken ?? '')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthFrame title="Reset password" lede="If an account exists, we’ll email a one-time link.">
      {sent ? (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-neutral-700">{sentMessage}</p>
          {resetToken ? (
            <div className="border border-neutral-200 p-4">
              <p className="text-sm leading-6 text-neutral-700">
                Dev tokens are enabled on this server. Use this one-time link. It expires in one hour.
              </p>
              <Link
                to={`/reset?token=${encodeURIComponent(resetToken)}`}
                className="focus-ring mt-3 inline-flex min-h-11 items-center text-sm text-neutral-950 underline underline-offset-4"
              >
                Reset your password
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Email" htmlFor="email" error={error}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
      <p className="mt-6 text-sm text-neutral-500">
        <Link to="/login" className="focus-ring text-neutral-950 underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </AuthFrame>
  )
}
