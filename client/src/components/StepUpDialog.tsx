import { startAuthentication } from '@simplewebauthn/browser'
import { useState, type FormEvent } from 'react'
import { api } from '../api/index.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { Button, Field, Input, Modal } from './ui.tsx'

export function StepUpDialog({
  open,
  onClose,
  onConfirmed,
}: {
  open: boolean
  onClose: () => void
  onConfirmed: () => Promise<void>
}) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function finish(run: () => Promise<void>) {
    setPending(true)
    setError('')
    try {
      await run()
      setPassword('')
      setCode('')
      await onConfirmed()
      onClose()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = code.trim()
    if (!trimmed && !password) {
      setError('Enter your password or an authenticator code.')
      return
    }
    void finish(async () => {
      if (trimmed) await api.stepUp({ code: trimmed, method: 'totp' })
      else await api.stepUp({ password, method: 'password' })
    })
  }

  return (
    <Modal open={open} title="Verify it's you" onClose={pending ? () => undefined : onClose}>
      <form onSubmit={onSubmit}>
        <p className="text-sm leading-6 text-neutral-600">
          This needs a fresh sign-in check. Enter your password or an authenticator code, or use a passkey. The password already in the form does not count.
        </p>
        <div className="mt-4 space-y-3">
          <Field label="Password" htmlFor="step-up-password">
            <Input
              id="step-up-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label="Authenticator code" htmlFor="step-up-code">
            <Input
              id="step-up-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-neutral-800">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={pending}
            onClick={() =>
              void finish(async () => {
                const options = await api.passkeyStepUpOptions()
                const credential = await startAuthentication({ optionsJSON: options as never })
                await api.passkeyStepUpVerify(credential)
              })
            }
          >
            Use a passkey
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Checking…' : 'Continue'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
