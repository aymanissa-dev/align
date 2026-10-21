// Runs inside the generated service worker, before Workbox registers its fetch
// handler. skipWaiting and clientsClaim activate this worker, but an open tab
// keeps executing the previous bundle until it loads again. Navigate after
// activate has finished: waiting on the navigation inside activate deadlocks,
// because this worker is what serves that request.
//
// Hashed files under /assets must never be answered with index.html. A missing
// or HTML response is a 404, so the page can recover instead of executing the
// shell as a module.

const CACHE_VERSION = 'v2'
const API_CACHE = 'align-api'
const PAGE_CACHE = `align-pages-${CACHE_VERSION}`

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => {
            if (key === PAGE_CACHE) return false
            if (key === 'align-pages' || key.startsWith('align-pages-')) return true
            if (key === API_CACHE || key.startsWith(`${API_CACHE}-`)) return true
            return false
          })
          .map((key) => caches.delete(key)),
      )
      await dropHtmlAssets()
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
  // A hashed asset is never the app shell. Workbox must not answer it from a
  // precache that stored index.html under this URL during a bad install.
  if (url.pathname.startsWith('/assets/')) {
    event.stopImmediatePropagation()
    event.respondWith(networkAsset(event.request))
    return
  }
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
  if (!event.data) return
  if (event.data.type === 'align-sw-version') {
    event.source?.postMessage({ type: 'align-sw-version', version: CACHE_VERSION })
    return
  }
  if (event.data.type !== 'align-purge-api') return
  event.waitUntil(purgeApiCaches())
})

async function purgeApiCaches() {
  const keys = await caches.keys()
  await Promise.all(
    keys.filter((key) => key === API_CACHE || key.startsWith(`${API_CACHE}-`)).map((key) => caches.delete(key)),
  )
}

function missingAsset() {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function looksLikeHtml(response) {
  const type = (response.headers.get('content-type') || '').toLowerCase()
  if (type.includes('text/html') || type.includes('application/xhtml')) return true
  if (
    type.includes('javascript') ||
    type.includes('ecmascript') ||
    type.includes('css') ||
    type.includes('font') ||
    type.includes('image') ||
    type.includes('wasm') ||
    type.includes('json')
  ) {
    return false
  }
  const bytes = await response.clone().arrayBuffer()
  const sample = new TextDecoder().decode(bytes.slice(0, 64)).trimStart().toLowerCase()
  return sample.startsWith('<!doctype') || sample.startsWith('<html') || sample.startsWith('<head')
}

async function networkAsset(request) {
  try {
    const response = await fetch(request)
    if (!response.ok || (await looksLikeHtml(response))) return missingAsset()
    return response
  } catch {
    const cached = await cachedAsset(request)
    if (cached) return cached
    return missingAsset()
  }
}

async function cachedAsset(request) {
  const names = await caches.keys()
  for (const name of names) {
    if (!name.includes('precache')) continue
    const cache = await caches.open(name)
    const hit = await cache.match(request)
    if (!hit || (await looksLikeHtml(hit))) continue
    return hit
  }
  return undefined
}

async function dropHtmlAssets() {
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
      if (!path.startsWith('/assets/')) continue
      const hit = await cache.match(request)
      if (hit && (await looksLikeHtml(hit))) await cache.delete(request)
    }
  }
}

async function networkFirstDocument(request) {
  try {
    const response = await fetch(request)
    const type = (response.headers.get('content-type') || '').toLowerCase()
    if (response.ok && (type.includes('text/html') || type === '')) {
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
      if (hit && (await looksLikeHtml(hit))) return hit
    }
  }
  return undefined
}
