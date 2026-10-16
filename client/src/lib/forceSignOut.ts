const REASON_KEY = 'align-signout-reason'

let handler: (() => void) | null = null

export function setForceSignOutHandler(next: (() => void) | null): void {
  handler = next
}

export function markForcedSignOut(): void {
  try {
    sessionStorage.setItem(REASON_KEY, '1')
  } catch {
    // Private mode can reject storage. The redirect still leaves the workspace.
  }
}

export function consumeForcedSignOut(): boolean {
  try {
    if (sessionStorage.getItem(REASON_KEY) !== '1') return false
    sessionStorage.removeItem(REASON_KEY)
    return true
  } catch {
    return false
  }
}

/** Drop in-memory auth after a revoked session. Does not call the API. */
export function forceSignOut(): void {
  markForcedSignOut()
  handler?.()
}
