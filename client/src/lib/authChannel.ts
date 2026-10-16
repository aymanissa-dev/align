const CHANNEL = 'align-auth'
const tabId = crypto.randomUUID()

type AuthMessage = { type: 'signed-out'; tabId: string }

export function broadcastSignedOut(): void {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(CHANNEL)
  const message: AuthMessage = { type: 'signed-out', tabId }
  channel.postMessage(message)
  channel.close()
}

export function subscribeSignedOut(onRemote: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined
  const channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (event: MessageEvent<AuthMessage>) => {
    if (event.data?.type === 'signed-out' && event.data.tabId !== tabId) onRemote()
  }
  return () => channel.close()
}
