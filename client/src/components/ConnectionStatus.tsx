import { useEffect, useState } from 'react'
import type { HealthReport } from '../../../shared/contract.ts'

const POLL_MS = 30_000

function isUp(body: unknown, ok: boolean): boolean {
  if (!ok || !body || typeof body !== 'object') return false
  return (body as HealthReport).db === 'up'
}

export function ConnectionStatus() {
  const [down, setDown] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const response = await fetch('/api/health', { cache: 'no-store', credentials: 'include' })
        const body: unknown = await response.json()
        if (!cancelled) setDown(!isUp(body, response.ok))
      } catch {
        if (!cancelled) setDown(true)
      }
    }
    void check()
    const id = window.setInterval(() => void check(), POLL_MS)
    const onOnline = () => void check()
    const onOffline = () => setDown(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      cancelled = true
      window.clearInterval(id)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  if (!down) return null

  return (
    <div role="status" className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-950 bg-white px-4 py-2 text-center">
      <p className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Can’t reach Align</p>
    </div>
  )
}
