import { startRegistration } from '@simplewebauthn/browser'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../api/index.ts'
import type { Passkey, SecurityEvent } from '../api/types.ts'
import { StepUpDialog } from '../components/StepUpDialog.tsx'
import { Button, Field, Input } from '../components/ui.tsx'
import { useToast } from '../components/toast-context.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { stepUpRequired } from '../lib/stepUp.ts'

export function SecurityPanel() {
  const toast = useToast()
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [password, setPassword] = useState('')
  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [busy, setBusy] = useState(false)
  const [stepUpOpen, setStepUpOpen] = useState(false)
  const retryRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([api.listSecurityEvents(), api.listPasskeys()])
      .then(([nextEvents, nextPasskeys]) => {
        if (cancelled) return
        setEvents(nextEvents)
        setPasskeys(nextPasskeys)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  async function onSetup() {
    setBusy(true)
    try {
      const next = await api.totpSetup()
      setSetup({ secret: next.secret, qr: next.qr })
    } catch (caught) {
      toast(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function onConfirm(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const next = await api.totpConfirm(code.trim())
      setCodes(next.recoveryCodes)
      setSetup(null)
      setEvents(await api.listSecurityEvents())
      toast('Two-factor authentication is on')
    } catch (caught) {
      toast(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  function askStepUp(action: () => Promise<void>) {
    retryRef.current = action
    setStepUpOpen(true)
  }

  async function onDisable() {
    setBusy(true)
    const credential = { password }
    const save = async () => {
      await api.totpDisable(credential)
      setCodes([])
      setEvents(await api.listSecurityEvents())
      toast('Two-factor authentication is off')
    }
    try {
      await save()
    } catch (caught) {
      if (stepUpRequired(caught)) {
        askStepUp(save)
        return
      }
      toast(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function onRegenerate() {
    setBusy(true)
    const credential = { password }
    const save = async () => {
      const next = await api.regenerateRecoveryCodes(credential)
      setCodes(next.recoveryCodes)
      setEvents(await api.listSecurityEvents())
    }
    try {
      await save()
    } catch (caught) {
      if (stepUpRequired(caught)) {
        askStepUp(save)
        return
      }
      toast(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function onPasskey() {
    setBusy(true)
    try {
      const options = await api.passkeyRegisterOptions()
      const credential = await startRegistration({ optionsJSON: options as never })
      await api.passkeyRegisterVerify({ ...credential, name: 'This device' })
      setPasskeys(await api.listPasskeys())
      toast('Passkey saved')
    } catch (caught) {
      toast(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-4 max-w-lg border border-neutral-200 p-5" aria-labelledby="security-heading">
      <h2 id="security-heading" className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">
        Security
      </h2>
      <p className="mt-2 text-sm leading-6 text-neutral-500">
        Authenticator codes, recovery codes, passkeys, and recent security activity.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void onSetup()}>
          Set up authenticator
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void onPasskey()}>
          Add passkey
        </Button>
      </div>
      {setup ? (
        <form className="mt-4 space-y-3" onSubmit={(event) => void onConfirm(event)}>
          {setup.qr ? <img src={setup.qr} alt="Authenticator QR code" className="h-40 w-40 border border-neutral-200" /> : null}
          <p className="text-sm text-neutral-800">
            Secret <span data-secret={setup.secret}>{setup.secret}</span>
          </p>
          <Field label="Authenticator code" htmlFor="totp-code">
            <Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
          </Field>
          <Button type="submit" disabled={busy}>
            Confirm code
          </Button>
        </form>
      ) : null}
      {codes.length > 0 ? (
        <ul className="mt-4 grid grid-cols-2 gap-2 text-sm" aria-label="Recovery codes">
          {codes.map((value) => (
            <li key={value} className="border border-neutral-200 px-2 py-1 font-mono">
              {value}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 space-y-3">
        <p className="text-sm leading-6 text-neutral-500">
          Enter your current password to turn off the authenticator or replace recovery codes. A recent sign-in is not enough.
        </p>
        <Field label="Current password" htmlFor="security-password">
          <Input
            id="security-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => void onDisable()}>
            Turn off authenticator
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void onRegenerate()}>
            Replace recovery codes
          </Button>
        </div>
      </div>
      {passkeys.length > 0 ? (
        <ul className="mt-4 divide-y divide-neutral-200 border border-neutral-200">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{passkey.name}</span>
              <Button
                variant="secondary"
                onClick={() => {
                  const credential = { password }
                  const save = async () => {
                    await api.passkeyDelete(passkey.id, credential)
                    setPasskeys((current) => current.filter((item) => item.id !== passkey.id))
                    setEvents(await api.listSecurityEvents())
                  }
                  void save().catch((caught: unknown) => {
                    if (stepUpRequired(caught)) {
                      askStepUp(save)
                      return
                    }
                    toast(errorMessage(caught))
                  })
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <h3 className="mt-6 font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Activity</h3>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">No security events yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-neutral-200 border border-neutral-200" aria-label="Security activity">
          {events.map((event) => (
            <li key={event.id} className="px-3 py-2 text-sm">
              <p>{event.summary}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {new Date(event.createdAt).toLocaleString()}
                {[event.device, event.deviceType, event.location, event.ip].filter(Boolean).length
                  ? ` · ${[event.device, event.deviceType, event.location, event.ip].filter(Boolean).join(' · ')}`
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
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
    </section>
  )
}
