import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/index.ts'
import { useAuth } from '../auth/auth-context.ts'
import { AuthFrame } from '../components/AuthFrame.tsx'
import { Button, Field, Input } from '../components/ui.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

const DEMO_EMAIL = 'demo@align.app'
const DEMO_PASSWORD = 'password'

export function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [google, setGoogle] = useState(false)
  useDocumentTitle('Sign in')

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
    setPending(true)
    try {
      await login({ email: nextEmail, password: nextPassword })
    } catch (caught) {
      setError(errorMessage(caught))
      setPending(false)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!email.trim() || !password) {
      setError('Email and password are required.')
      return
    }
    void signIn(email, password)
  }

  return (
    <AuthFrame title="Sign in" lede="Welcome back to your workspace.">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
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
          {error ? (
            <p role="alert" className="text-sm text-neutral-800">
              {error}
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
