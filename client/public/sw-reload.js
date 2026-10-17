// Runs inside the generated service worker, before Workbox registers its fetch
// handler. skipWaiting and clientsClaim activate this worker, but an open tab
// keeps executing the previous bundle until it loads again. Navigate after
// activate has finished: waiting on the navigation inside activate deadlocks,
// because this worker is what serves that request.

const API_CACHE = 'align-api'
const PAGE_CACHE = 'align-pages'

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
  if (url.origin !== self.location.origin) return
  // The app shell is precached. A navigation tries the network, and only if
  // that fetch rejects do we serve the cached document. A slow response is
  // still the network's response, so an old bundle is not swapped in early.
  if (event.request.mode === 'navigate') {
    event.stopImmediatePropagation()
    event.respondWith(networkFirstDocument(event.request))
    return
  }
  if (!url.pathname.startsWith('/api/')) return
  // The page performs every API call itself, including /api/auth/* and
  // /api/auth/me. Nothing here is written to Cache Storage. A cached session
  // would keep the signed-in shell after logout, and workspace data belongs
  // in the per-user query cache instead.
  event.stopImmediatePropagation()
})

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'align-purge-api') return
  event.waitUntil(purgeApiCaches())
})

async function purgeApiCaches() {
  const keys = await caches.keys()
  await Promise.all(
    keys.filter((key) => key === API_CACHE || key.startsWith(`${API_CACHE}-`)).map((key) => caches.delete(key)),
  )
}

async function networkFirstDocument(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(PAGE_CACHE)
      cache.put(request, response.clone()).catch(() => {})
    }
    return response
  } catch {
    const cached = await caches.open(PAGE_CACHE).then((cache) => cache.match(request)).catch(() => undefined)
    if (cached) return cached
    const shell = await precachedShell()
    if (shell) return shell
    throw new Error('offline')
  }
}

async function precachedShell() {
  const names = await caches.keys()
  for (const name of names) {
    if (!name.includes('precache')) continue
    const cache = await caches.open(name)
    const requests = await cache.keys()
    for (const request of requests) {
      let path = ''
      try {
        path = new URL(request.url).pathname
      } catch {
        continue
      }
      if (path !== '/' && path !== '/index.html') continue
      const hit = await cache.match(request)
      if (hit) return hit
    }
  }
  return undefined
}
