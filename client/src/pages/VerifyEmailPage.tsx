import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/index.ts'
import { useAuth } from '../auth/auth-context.ts'
import { AuthFrame } from '../components/AuthFrame.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function VerifyEmailPage() {
  const { user, acceptSession } = useAuth()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [error, setError] = useState(token ? '' : 'This verification link is invalid or has expired.')
  const [done, setDone] = useState(false)
  const started = useRef(false)
  useDocumentTitle('Verify email')

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    let cancelled = false
    api
      .verifyEmail(token)
      .then(async () => {
        const sessionUser = await api.session()
        if (cancelled) return
        if (sessionUser) acceptSession(sessionUser)
        setDone(true)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorMessage(caught))
      })
    return () => {
      cancelled = true
    }
  }, [acceptSession, token])

  return (
    <AuthFrame title="Verify email" lede="This confirms the address on your account.">
      {done ? (
        <p className="text-sm leading-6 text-neutral-700">Your email is verified.</p>
      ) : error ? (
        <p role="alert" className="text-sm text-neutral-800">
          {error}
        </p>
      ) : (
        <p className="text-sm leading-6 text-neutral-700">Checking this link…</p>
      )}
      <p className="mt-6 text-sm text-neutral-500">
        <Link to={user ? '/settings' : '/login'} className="focus-ring text-neutral-950 underline underline-offset-4">
          {user ? 'Back to settings' : 'Back to sign in'}
        </Link>
      </p>
    </AuthFrame>
  )
}
