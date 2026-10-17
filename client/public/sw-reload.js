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
  // Workbox must not see mutations. respondWith would race it; stopping the
  // event lets the browser perform the POST itself.
  event.stopImmediatePropagation()
  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') return
  // Reach probes are the page's job. Intercepting them caches a 200 that
  // looks like connectivity, and the worker's own fetch doubles every probe.
  if (isReachProbe(url)) return
  event.respondWith(networkFirstApi(event.request))
})

function isReachProbe(url) {
  if (url.pathname === '/api/health') return true
  return url.pathname === '/api/auth/session' && url.searchParams.has('reach')
}

function asCacheHit(response) {
  const headers = new Headers(response.headers)
  headers.set('X-Align-Cache', 'hit')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

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
    if (cached) return asCacheHit(cached)
    // A synthesized 504 looks like the server failed. Reject instead, so the
    // page treats a dead network as a network error.
    throw new Error('offline')
  }
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
