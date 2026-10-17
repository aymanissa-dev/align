const CHANNEL = 'align-data'
const tabId = crypto.randomUUID()

type DataMessage = { type: 'invalidate'; tabId: string }

export function broadcastWorkspaceChange(): void {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(CHANNEL)
  const message: DataMessage = { type: 'invalidate', tabId }
  channel.postMessage(message)
  channel.close()
}

export function subscribeWorkspaceChange(onRemote: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined
  const channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (event: MessageEvent<DataMessage>) => {
    if (event.data?.type === 'invalidate' && event.data.tabId !== tabId) onRemote()
  }
  return () => channel.close()
}
