import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/auth-context.ts'
import { api } from '../api/index.ts'
import { useToast } from '../components/toast-context.ts'
import { Button, ConfirmDialog, Field, Input } from '../components/ui.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
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
  useDocumentTitle('Settings')

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
      const next = await updateProfile(name)
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
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.')
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
      <h1 className="text-2xl font-medium tracking-tight text-neutral-950">Settings</h1>
      <p className="mt-2 text-sm text-neutral-500">{user.email}</p>

      <section className="mt-10 max-w-md">
        <h2 className="text-base font-medium text-neutral-950">Profile</h2>
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

      <section className="mt-12 max-w-md border-t border-neutral-200 pt-8">
        <h2 className="text-base font-medium text-neutral-950">Password</h2>
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
          <Field label="New password" htmlFor="new-password" hint="At least 8 characters.">
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
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

      <section className="mt-12 max-w-md border-t border-neutral-200 pt-8">
        <h2 className="text-base font-medium text-neutral-950">Session</h2>
        <Button variant="secondary" className="mt-4" onClick={() => void onSignOut()}>
          Sign out
        </Button>
      </section>

      <section className="mt-12 max-w-md border-t border-neutral-200 pt-8">
        <h2 className="text-base font-medium text-neutral-950">Delete account</h2>
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
