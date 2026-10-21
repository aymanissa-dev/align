import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/auth-context.ts'
import { api } from '../api/index.ts'
import type { AuthSession, Passkey } from '../api/types.ts'
import { useToast } from '../components/toast-context.ts'
import { PageHeader } from '../components/chrome.tsx'
import { AccentPicker, ThemeToggle } from '../components/ThemeControls.tsx'
import { PasswordMeter } from '../components/PasswordMeter.tsx'
import { RecoveryKeyNotice } from '../components/RecoveryKeyNotice.tsx'
import { SecurityPanel } from './SecurityPanel.tsx'
import { StepUpDialog } from '../components/StepUpDialog.tsx'
import { Button, ConfirmDialog, Field, Input, ListSkeleton } from '../components/ui.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
import { invalidateSecurityLog } from '../lib/securityLog.ts'
import { stepUpRequired } from '../lib/stepUp.ts'
import { isMediumPassword, MEDIUM_PASSWORD_HINT, MEDIUM_PASSWORD_MESSAGE } from '../lib/passwordStrength.ts'
import { markAccountDeleted } from '../lib/accountDeleted.ts'
import { clearSignedOut, markSignedOut } from '../lib/signedOut.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function SettingsPage() {
  const { user, updateProfile, logout, deleteAccount, acceptSession } = useAuth()
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
  const [nextEmail, setNextEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [issuingKey, setIssuingKey] = useState(false)
  const [revokeMode, setRevokeMode] = useState<'all' | 'others' | null>(null)
  const [accountPasskeys, setAccountPasskeys] = useState<Passkey[]>([])
  const [revokePassword, setRevokePassword] = useState('')
  const [revoking, setRevoking] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [stepUpOpen, setStepUpOpen] = useState(false)
  const retryRef = useRef<(() => Promise<void>) | null>(null)
  const [sessions, setSessions] = useState<AuthSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState('')
  useDocumentTitle('Settings')

  useEffect(() => {
    let cancelled = false
    const load = (initial: boolean) => {
      api
        .listSessions()
        .then((items) => {
          if (!cancelled) setSessions(items)
        })
        .catch((caught: unknown) => {
          if (!cancelled && initial) setSessionsError(errorMessage(caught))
        })
        .finally(() => {
          if (!cancelled && initial) setSessionsLoading(false)
        })
    }
    load(true)
    // A new sign-in can arrive while this page is open. Refresh the list so
    // that device can be revoked without a manual reload.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(false)
    }, 4_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') load(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    if (revokeMode !== 'all') return
    let cancelled = false
    void api
      .listPasskeys()
      .then((next) => {
        if (!cancelled) setAccountPasskeys(next)
      })
      .catch(() => {
        if (!cancelled) setAccountPasskeys([])
      })
    return () => {
      cancelled = true
    }
  }, [revokeMode])

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
    const save = async () => {
      await api.changePassword({ currentPassword, newPassword })
      await invalidateSecurityLog()
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast('Password updated')
    }
    try {
      await save()
    } catch (caught) {
      if (stepUpRequired(caught)) {
        retryRef.current = save
        setStepUpOpen(true)
        return
      }
      setPasswordError(errorMessage(caught))
    } finally {
      setSavingPassword(false)
    }
  }

  async function onRevoke(session: AuthSession) {
    try {
      await api.revokeSession(session.id)
      await invalidateSecurityLog()
      if (session.current) {
        await onSignOut()
        return
      }
      setSessions((current) => current.filter((item) => item.id !== session.id))
    } catch (caught) {
      toast(errorMessage(caught))
    }
  }

  async function onChangeEmail(event: FormEvent) {
    event.preventDefault()
    setEmailError('')
    setSavingEmail(true)
    const save = async () => {
      const updated = await api.changeEmail({ email: nextEmail.trim() })
      acceptSession(updated)
      await invalidateSecurityLog()
      setNextEmail('')
      toast('Email updated')
    }
    try {
      await save()
    } catch (caught) {
      if (stepUpRequired(caught)) {
        retryRef.current = save
        setStepUpOpen(true)
        return
      }
      setEmailError(errorMessage(caught))
    } finally {
      setSavingEmail(false)
    }
  }

  async function onCreateRecoveryKey() {
    setIssuingKey(true)
    const save = async () => {
      const issued = await api.createRecoveryKey()
      setRecoveryKey(issued.recoveryKey)
      await invalidateSecurityLog()
    }
    try {
      await save()
    } catch (caught) {
      if (stepUpRequired(caught)) {
        retryRef.current = save
        setStepUpOpen(true)
        return
      }
      toast(errorMessage(caught))
    } finally {
      setIssuingKey(false)
    }
  }

  async function onRevokeSessions() {
    const others = revokeMode === 'others'
    setRevoking(true)
    const save = async () => {
      if (others) {
        await api.revokeOtherSessions(revokePassword)
        await invalidateSecurityLog()
        setSessions((current) => current.filter((session) => session.current))
        setRevokePassword('')
        setRevokeMode(null)
        toast('Other sessions were signed out')
        return
      }
      markSignedOut()
      await api.revokeAllSessions(revokePassword)
      await logout()
      navigate('/', { replace: true })
    }
    try {
      await save()
    } catch (caught) {
      clearSignedOut()
      setRevoking(false)
      if (stepUpRequired(caught)) {
        retryRef.current = save
        setStepUpOpen(true)
        return
      }
      toast(errorMessage(caught))
    } finally {
      if (others) setRevoking(false)
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
    const save = async () => {
      markSignedOut()
      await deleteAccount(deletePassword)
      markAccountDeleted()
      navigate('/?deleted=1', { replace: true })
    }
    try {
      await save()
    } catch (caught) {
      clearSignedOut()
      setDeleting(false)
      if (stepUpRequired(caught)) {
        retryRef.current = save
        setStepUpOpen(true)
        return
      }
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
              name="name"
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
              name="current-password"
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
              name="new-password"
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
              name="confirm-password"
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
                  {session.location ? ` · ${session.location}` : ''}
                  {session.ip ? ` · ${session.ip}` : ''}
                </p>
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const data = new FormData(event.currentTarget)
                    const name = String(data.get('name') ?? '').trim()
                    if (!name) return
                    void api.renameSession(session.id, name).then(async () => {
                      setSessions((current) => current.map((item) => (item.id === session.id ? { ...item, device: name } : item)))
                      await invalidateSecurityLog()
                      toast('Session renamed')
                    })
                  }}
                >
                  <Input
                    id={`session-name-${session.id}`}
                    name="name"
                    autoComplete="off"
                    aria-label={`Rename ${session.device}`}
                    defaultValue={session.device}
                    className="h-9"
                  />
                  <Button variant="secondary" type="submit">
                    Rename
                  </Button>
                </form>
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
          <Button variant="secondary" onClick={() => setRevokeMode('others')}>
            Sign out all other sessions
          </Button>
          <Button variant="secondary" onClick={() => setRevokeMode('all')}>
            Sign out everywhere
          </Button>
        </div>
      </section>

      <section className="mt-4 max-w-lg border border-neutral-200 p-5">
        <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Email address</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-500">
          Changing the address asks you to confirm it is you. Align does not send a confirmation email.
        </p>
        <form onSubmit={(event) => void onChangeEmail(event)} className="mt-4 space-y-4" noValidate>
          <Field label="New email" htmlFor="next-email" error={emailError}>
            <Input
              id="next-email"
              name="email"
              type="email"
              autoComplete="email"
              value={nextEmail}
              onChange={(event) => setNextEmail(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={savingEmail}>
            {savingEmail ? 'Updating…' : 'Update email'}
          </Button>
        </form>
      </section>

      <section className="mt-4 max-w-lg border border-neutral-200 p-5">
        <h2 className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Account recovery</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-500">
          A recovery key resets your password without email. Creating a new one replaces the previous key.
        </p>
        {recoveryKey ? (
          <div className="mt-4">
            <RecoveryKeyNotice recoveryKey={recoveryKey} onSaved={() => setRecoveryKey('')} />
          </div>
        ) : (
          <Button variant="secondary" className="mt-4" disabled={issuingKey} onClick={() => void onCreateRecoveryKey()}>
            {issuingKey ? 'Creating…' : 'Create a new recovery key'}
          </Button>
        )}
      </section>

      <SecurityPanel />

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
        open={revokeMode !== null}
        title="Confirm it's you"
        body={
          revokeMode === 'others'
            ? 'Enter your password to sign out every other device. This browser stays signed in.'
            : 'Enter your password to sign out every device, including this one. Signing out does not remove authenticator codes or passkeys.'
        }
        confirmLabel={revokeMode === 'others' ? 'Sign out other sessions' : 'Sign out everywhere'}
        pending={revoking}
        onConfirm={() => void onRevokeSessions()}
        onClose={() => {
          if (!revoking) setRevokeMode(null)
        }}
      >
        {revokeMode === 'all' ? (
          <div className="mt-4 text-sm leading-6 text-neutral-800">
            <p>Review the factors on this account before you continue.</p>
            {accountPasskeys.length === 0 ? (
              <p className="mt-2 text-neutral-500">No passkeys on this account. Authenticator codes, if any, stay until you turn them off.</p>
            ) : (
              <ul className="mt-2 list-disc pl-5" aria-label="Passkeys to review">
                {accountPasskeys.map((passkey) => (
                  <li key={passkey.id}>{passkey.name}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        <div className="mt-4">
          <Field label="Password" htmlFor="revoke-password">
            <Input
              id="revoke-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={revokePassword}
              onChange={(event) => setRevokePassword(event.target.value)}
            />
          </Field>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDelete}
        title="Confirm it's you"
        body="Enter your password to delete this account. Projects, tasks, and notes are removed permanently."
        confirmLabel="Delete account"
        pending={deleting}
        onConfirm={() => void onDelete()}
        onClose={() => {
          if (!deleting) setConfirmDelete(false)
        }}
      >
        <div className="mt-4">
          <Field label="Password" htmlFor="delete-password">
            <Input
              id="delete-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
            />
          </Field>
        </div>
      </ConfirmDialog>
      <StepUpDialog
        open={stepUpOpen}
        onClose={() => setStepUpOpen(false)}
        onConfirmed={async () => {
          const action = retryRef.current
          if (!action) return
          await action()
          retryRef.current = null
        }}
      />
    </div>
  )
}
