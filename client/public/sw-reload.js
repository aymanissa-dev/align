// Runs inside the generated service worker, before Workbox registers its fetch
// handler. skipWaiting and clientsClaim activate this worker, but an open tab
// keeps executing the previous bundle until it loads again. Navigate after
// activate has finished: waiting on the navigation inside activate deadlocks,
// because this worker is what serves that request.

const API_CACHE = 'align-api'
const PAGE_CACHE = 'align-pages'
const API_TIMEOUT_MS = 3000

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => key === PAGE_CACHE || key === API_CACHE).map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
  setTimeout(() => {
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if (!client.url.startsWith(self.location.origin)) continue
          client.navigate(client.url).catch(() => {})
        }
      })
      .catch(() => {})
  }, 50)
})

self.addEventListener('fetch', (event) => {
  let url
  try {
    url = new URL(event.request.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/api/')) return
  // Workbox must not see mutations. respondWith would race it; stopping the
  // event lets the browser perform the POST itself.
  event.stopImmediatePropagation()
  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') return
  event.respondWith(networkFirstApi(event.request))
})

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const response = await fetch(request, { signal: controller.signal, cache: 'no-store' })
    clearTimeout(timer)
    // A 304 has an empty body. Hand it back so the page can reuse its copy.
    if (response.status === 304) return response
    if (response.ok) cache.put(request, response.clone()).catch(() => {})
    return response
  } catch {
    clearTimeout(timer)
    const cached = await cache.match(request)
    if (cached) return cached
    return new Response(JSON.stringify({ error: 'Network error. Check your connection and try again.' }), {
      status: 504,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }
}
