import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/auth-context.ts'
import { api } from '../api/index.ts'
import type { AuthSession } from '../api/types.ts'
import { useToast } from '../components/toast-context.ts'
import { PageHeader } from '../components/chrome.tsx'
import { AccentPicker, ThemeToggle } from '../components/ThemeControls.tsx'
import { PasswordMeter } from '../components/PasswordMeter.tsx'
import { Button, ConfirmDialog, Field, Input, ListSkeleton } from '../components/ui.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
import { isMediumPassword, MEDIUM_PASSWORD_HINT, MEDIUM_PASSWORD_MESSAGE } from '../lib/passwordStrength.ts'
import { clearSignedOut, markSignedOut } from '../lib/signedOut.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function SettingsPage() {
  const { user, updateProfile, logout, deleteAccount } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [name, setName] = useState(user?.name ?? '')
  const [nameError, setNameError] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [sessions, setSessions] = useState<AuthSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState('')
  const [verifyToken, setVerifyToken] = useState('')
  const [verifyMessage, setVerifyMessage] = useState('')
  const [sendingVerify, setSendingVerify] = useState(false)
  useDocumentTitle('Settings')

  useEffect(() => {
    let cancelled = false
    api
      .listSessions()
      .then((items) => {
        if (!cancelled) setSessions(items)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setSessionsError(errorMessage(caught))
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!user) return null

  async function onSaveName(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setNameError('Name is required.')
      return
    }
    setNameError('')
    setSavingName(true)
    try {
      const next = await updateProfile({ name })
      setName(next.name)
      toast('Name saved')
    } catch (caught) {
      setNameError(errorMessage(caught))
    } finally {
      setSavingName(false)
    }
  }

  async function onChangePassword(event: FormEvent) {
    event.preventDefault()
    if (!currentPassword) {
      setPasswordError('Enter your current password.')
      return
    }
    if (!isMediumPassword(newPassword)) {
      setPasswordError(MEDIUM_PASSWORD_MESSAGE)
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.')
      return
    }
    setPasswordError('')
    setSavingPassword(true)
    try {
      await api.changePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast('Password updated')
    } catch (caught) {
      setPasswordError(errorMessage(caught))
    } finally {
      setSavingPassword(false)
    }
  }

  async function onSendVerification() {
    setSendingVerify(true)
    setVerifyMessage('')
    setVerifyToken('')
    try {
      const result = await api.sendVerification()
      setVerifyMessage(result.message)
      setVerifyToken(result.verifyToken ?? '')
    } catch (caught) {
      setVerifyMessage(errorMessage(caught))
    } finally {
      setSendingVerify(false)
    }
  }

  async function onRevoke(session: AuthSession) {
    try {
      await api.revokeSession(session.id)
      if (session.current) {
        await onSignOut()
        return
      }
      setSessions((current) => current.filter((item) => item.id !== session.id))
    } catch (caught) {
      toast(errorMessage(caught))
    }
  }

  async function onSignOutEverywhere() {
    markSignedOut()
    try {
      await api.revokeAllSessions()
      await logout()
      navigate('/', { replace: true })
    } catch (caught) {
      clearSignedOut()
      toast(errorMessage(caught))
    }
  }

  async function onSignOut() {
    markSignedOut()
    try {
      await logout()
      navigate('/', { replace: true })
    } catch (caught) {
      clearSignedOut()
      toast(errorMessage(caught))
    }
  }

  async function onDelete() {
    setDeleting(true)
    markSignedOut()
    try {
      await deleteAccount()
      navigate('/', { replace: true })
    } catch (caught) {
      clearSignedOut()
      setDeleting(false)
      toast(errorMessage(caught))
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Account" title="Settings" description={user.email} />

      <section className="mt-6 max-w-lg border border-neutral-200 p-5">
        <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Appearance</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-500">Theme stays on this device. Accent color follows your account.</p>
        <div className="mt-4">
          <ThemeToggle />
        </div>
        <div className="mt-4">
          <AccentPicker />
        </div>
      </section>

      <section className="mt-4 max-w-lg border border-neutral-200 p-5">
        <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Profile</h2>
        <form onSubmit={onSaveName} className="mt-4 space-y-4" noValidate>
          <Field label="Name" htmlFor="profile-name" error={nameError}>
            <Input
              id="profile-name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'profile-name-error' : undefined}
            />
          </Field>
          <Button type="submit" disabled={savingName}>
            {savingName ? 'Saving…' : 'Save name'}
          </Button>
        </form>
      </section>

      <section className="mt-4 max-w-lg border border-neutral-200 p-5">
        <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Password</h2>
        <form onSubmit={onChangePassword} className="mt-4 space-y-4" noValidate>
          <Field label="Current password" htmlFor="current-password">
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              aria-invalid={passwordError ? true : undefined}
            />
          </Field>
          <Field label="New password" htmlFor="new-password" hint={MEDIUM_PASSWORD_HINT}>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <PasswordMeter password={newPassword} />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm-password">
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </Field>
          {passwordError ? (
            <p role="alert" className="text-sm text-neutral-800">
              {passwordError}
            </p>
          ) : null}
          <Button type="submit" disabled={savingPassword}>
            {savingPassword ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </section>

      {user.emailVerified ? null : (
        <section className="mt-4 max-w-lg border border-neutral-200 p-5">
          <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Email</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-500">This address is not verified yet.</p>
          <Button variant="secondary" className="mt-4" disabled={sendingVerify} onClick={() => void onSendVerification()}>
            {sendingVerify ? 'Sending…' : 'Send verification link'}
          </Button>
          {verifyMessage ? <p className="mt-3 text-sm leading-6 text-neutral-700">{verifyMessage}</p> : null}
          {verifyToken ? (
            <Link
              to={`/verify?token=${encodeURIComponent(verifyToken)}`}
              className="focus-ring mt-2 inline-flex min-h-11 items-center text-sm text-neutral-950 underline underline-offset-4"
            >
              Verify email
            </Link>
          ) : null}
        </section>
      )}

      <section className="mt-4 max-w-lg border border-neutral-200 p-5">
        <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Sessions</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-500">Devices that are signed in to this account.</p>
        {sessionsError ? (
          <p role="alert" className="mt-3 text-sm text-neutral-800">
            {sessionsError}
          </p>
        ) : null}
        {sessionsLoading ? (
          <div className="mt-4" aria-busy="true" aria-label="Loading sessions">
            <ListSkeleton rows={2} header={false} />
          </div>
        ) : (
        <ul className="mt-4 divide-y divide-neutral-200 border border-neutral-200">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <div>
                <p className="text-sm text-neutral-950">
                  {session.device}
                  {session.current ? ' · This device' : ''}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  Last seen {new Date(session.lastSeenAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
              <Button variant="secondary" onClick={() => void onRevoke(session)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void onSignOut()}>
            Sign out
          </Button>
          <Button variant="secondary" onClick={() => void onSignOutEverywhere()}>
            Sign out everywhere
          </Button>
        </div>
      </section>

      <section className="mt-4 max-w-lg border border-dashed border-neutral-300 p-5">
        <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Delete account</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-500">
          This permanently removes your projects, tasks, and notes.
        </p>
        <Button variant="secondary" className="mt-4" onClick={() => setConfirmDelete(true)}>
          Delete account
        </Button>
      </section>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete account"
        body="Delete your account? Projects, tasks, and notes are removed permanently."
        confirmLabel="Delete account"
        pending={deleting}
        onConfirm={() => void onDelete()}
        onClose={() => {
          if (!deleting) setConfirmDelete(false)
        }}
      />
    </div>
  )
}
