import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/auth-context.ts'
import { Button, Field, Input } from '../components/ui.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function RegisterPage() {
  const { register } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
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
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setError('')
    setPending(true)
    try {
      await register({ name, email, password })
    } catch (caught) {
      setError(errorMessage(caught))
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Link to="/" className="focus-ring rounded-sm text-sm font-medium tracking-tight text-neutral-950">
          Align
        </Link>
        <h1 className="mt-6 text-2xl font-medium tracking-tight text-neutral-950">Create an account</h1>
        <p className="mt-2 text-sm text-neutral-500">A workspace for projects, tasks, and notes.</p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          <Field label="Name" htmlFor="name">
            <Input
              id="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
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
          <Field label="Password" htmlFor="password" hint="At least 8 characters.">
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
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
            {pending ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
        <p className="mt-6 text-sm text-neutral-500">
          Already have an account?{' '}
          <Link to="/login" className="focus-ring rounded-sm text-neutral-900 underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
