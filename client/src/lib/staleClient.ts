const RESET_KEY = 'align-sw-reset'

/** Unregister the service worker, drop caches, and reload once per tab session. */
export async function purgeStaleClient(): Promise<void> {
  try {
    if (sessionStorage.getItem(RESET_KEY) === '1') return
    sessionStorage.setItem(RESET_KEY, '1')
  } catch {
    return
  }
  const jobs: Promise<unknown>[] = []
  if ('serviceWorker' in navigator) {
    jobs.push(
      navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      ),
    )
  }
  if ('caches' in window) {
    jobs.push(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))))
  }
  await Promise.all(jobs.map((job) => job.catch(() => undefined)))
  window.location.reload()
}
