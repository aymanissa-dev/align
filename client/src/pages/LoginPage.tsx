import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/index.ts'
import { ApiError } from '../api/errors.ts'
import { useAuth } from '../auth/auth-context.ts'
import { AuthFrame } from '../components/AuthFrame.tsx'
import { Button, Field, Input } from '../components/ui.tsx'
import { consumeForcedSignOut } from '../lib/forceSignOut.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { preloadDashboard } from '../lib/preloadDashboard.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

preloadDashboard()

const DEMO_EMAIL = 'demo@align.app'
const DEMO_PASSWORD = 'password'

function retryClock(totalSeconds: number): string {
  const whole = Math.max(0, Math.ceil(totalSeconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const seconds = whole % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`
}

function lockoutText(message: string, remaining: number | null): string {
  if (remaining === null) return message
  if (!message.startsWith('Too many attempts')) {
    return remaining > 0 ? `${message} Try again in ${retryClock(remaining)}.` : message
  }
  if (remaining <= 0) return 'Too many attempts. You can try again now.'
  return `Too many attempts. Try again in ${retryClock(remaining)}.`
}

export function LoginPage() {
  const { login, acceptSession } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [retryUntil, setRetryUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [pending, setPending] = useState(false)
  const [mfa, setMfa] = useState(false)
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [google, setGoogle] = useState(false)
  const [params] = useSearchParams()
  const [signedOut] = useState(() => params.get('signedOut') === '1' || consumeForcedSignOut())
  useDocumentTitle('Sign in')

  useEffect(() => {
    if (retryUntil === null) return
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= retryUntil) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [retryUntil])

  const remaining = retryUntil === null ? null : Math.max(0, Math.ceil((retryUntil - now) / 1000))
  const alertText = error ? lockoutText(error, remaining) : ''

  function noteFailure(caught: unknown) {
    setError(errorMessage(caught))
    if (caught instanceof ApiError && typeof caught.retryAfter === 'number') {
      const current = Date.now()
      setNow(current)
      setRetryUntil(current + caught.retryAfter * 1000)
    } else {
      setRetryUntil(null)
    }
    setPending(false)
  }

  useEffect(() => {
    let cancelled = false
    api
      .authProviders()
      .then((providers) => {
        if (!cancelled) setGoogle(providers.google)
      })
      .catch(() => {
        if (!cancelled) setGoogle(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function signIn(nextEmail: string, nextPassword: string) {
    setError('')
    setRetryUntil(null)
    setPending(true)
    try {
      const result = await login({ email: nextEmail, password: nextPassword })
      if ('mfaRequired' in result && result.mfaRequired) {
        setMfa(true)
        setPending(false)
      }
    } catch (caught) {
      noteFailure(caught)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!email.trim() || !password) {
      setRetryUntil(null)
      setError('Email and password are required.')
      return
    }
    void signIn(email, password)
  }

  return (
    <AuthFrame title="Sign in" lede="Welcome back to your workspace.">
        {signedOut ? (
          <p role="status" className="mb-4 border border-neutral-200 px-3 py-2 text-sm text-neutral-800">
            You were signed out.
          </p>
        ) : null}
        {mfa ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              setError('')
              setPending(true)
              void api
                .completeMfa({ code, method: useRecovery ? 'recovery' : 'totp' })
                .then((user) => {
                  acceptSession(user)
                })
                .catch((caught: unknown) => {
                  noteFailure(caught)
                })
            }}
          >
            <Field label={useRecovery ? 'Recovery code' : 'Authenticator code'} htmlFor="mfa-code">
              <Input
                id="mfa-code"
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </Field>
            {alertText ? (
              <p role="alert" className="text-sm text-neutral-800">
                {alertText}
              </p>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? 'Checking…' : 'Continue'}
            </Button>
            <button
              type="button"
              className="focus-ring text-sm text-neutral-700 underline underline-offset-4"
              onClick={() => setUseRecovery((value) => !value)}
            >
              {useRecovery ? 'Use an authenticator code' : 'Use a recovery code'}
            </button>
          </form>
        ) : null}
        <form onSubmit={onSubmit} className={mfa ? 'hidden' : 'space-y-4'} noValidate>
          <Field label="Email" htmlFor="email">
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
          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          {alertText ? (
            <p role="alert" className="text-sm text-neutral-800">
              {alertText}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        {google ? (
          <a
            href="/api/auth/google"
            className="focus-ring mt-3 flex min-h-11 w-full items-center justify-center border border-neutral-300 text-sm text-neutral-950"
          >
            Continue with Google
          </a>
        ) : null}
        <p className="mt-4 text-sm">
          <Link to="/forgot" className="focus-ring text-neutral-950 underline underline-offset-4">
            Forgot password?
          </Link>
        </p>
        <p className="mt-6 text-sm text-neutral-500">
          New here?{' '}
          <Link to="/register" className="focus-ring text-neutral-950 underline underline-offset-4">
            Create an account
          </Link>
        </p>
        <div className="mt-8 border-t border-dashed border-neutral-300 pt-6">
          <button
            type="button"
            className="focus-ring text-sm text-neutral-950 underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-950 disabled:opacity-40"
            disabled={pending}
            onClick={() => {
              setEmail(DEMO_EMAIL)
              setPassword(DEMO_PASSWORD)
              void signIn(DEMO_EMAIL, DEMO_PASSWORD)
            }}
          >
            Use the demo account
          </button>
        </div>
    </AuthFrame>
  )
}
