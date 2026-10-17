const PURGE = 'align-purge-api'

/** Drop cached API responses, including a session saved by an older worker. */
export function purgeApiCaches(): void {
  if (typeof window === 'undefined') return
  const message = { type: PURGE }
  try {
    navigator.serviceWorker?.controller?.postMessage(message)
    void navigator.serviceWorker?.getRegistrations?.().then((registrations) => {
      for (const registration of registrations) registration.active?.postMessage(message)
    })
  } catch {
    // The page delete below still clears Cache Storage.
  }
  if (typeof caches === 'undefined') return
  void caches
    .keys()
    .then((keys) =>
      Promise.all(keys.filter((key) => key === 'align-api' || key.startsWith('align-api-')).map((key) => caches.delete(key))),
    )
    .catch(() => {
      // A missing Cache Storage API leaves nothing to purge.
    })
}
