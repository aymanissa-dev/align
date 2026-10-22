let open = false
let controller = new AbortController()

/** Signed-in requests may refresh a session and keep their pollers. */
export function openSessionGate(): void {
  open = true
  if (controller.signal.aborted) controller = new AbortController()
}

/** Stop refresh attempts without cancelling the logout request itself. */
export function pauseSessionGate(): void {
  open = false
}

/** Drop the signed-in session and cancel requests that were already in flight. */
export function closeSessionGate(): void {
  open = false
  if (!controller.signal.aborted) controller.abort()
  controller = new AbortController()
}

export function sessionOpen(): boolean {
  return open
}

export function sessionSignal(): AbortSignal {
  return controller.signal
}
