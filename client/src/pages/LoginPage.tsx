import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/auth-context.ts'
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
  useDocumentTitle('Sign in')

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
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-medium tracking-tight text-neutral-950">Align</h1>
        <p className="mt-2 text-sm text-neutral-500">Sign in to your workspace.</p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          <Field label="Email" htmlFor="email" error={error}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'email-error' : undefined}
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
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-6 text-sm text-neutral-500">
          New here?{' '}
          <Link to="/register" className="focus-ring rounded-sm text-neutral-900 underline underline-offset-4">
            Create an account
          </Link>
        </p>
        <div className="mt-10 border-t border-neutral-200 pt-6">
          <button
            type="button"
            className="focus-ring rounded-sm text-sm text-neutral-900 underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-900 disabled:opacity-40"
            disabled={pending}
            onClick={() => {
              setEmail(DEMO_EMAIL)
              setPassword(DEMO_PASSWORD)
              void signIn(DEMO_EMAIL, DEMO_PASSWORD)
            }}
          >
            Use the demo account
          </button>
          <p className="mt-2 text-xs text-neutral-400">demo@align.app · password</p>
        </div>
      </div>
    </div>
  )
}
