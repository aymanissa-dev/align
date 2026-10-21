import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import playwright from 'playwright-core'

const swReloadPath = fileURLToPath(new URL('../public/sw-reload.js', import.meta.url))

const OLD_SW = `
const PAGE = 'align-pages'
const PRE = 'workbox-precache-v2-old'
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const page = await caches.open(PAGE)
    await page.put(new Request('/'), new Response('<!doctype html><title>old</title>', { headers: { 'content-type': 'text/html' } }))
    const pre = await caches.open(PRE)
    await pre.put(new Request('/index.html'), new Response('<!doctype html><title>shell</title>', { headers: { 'content-type': 'text/html' } }))
    await pre.put(new Request('/assets/app.js'), new Response('<!doctype html><title>poison</title>', { headers: { 'content-type': 'text/html' } }))
    await self.skipWaiting()
  })())
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (!url.pathname.startsWith('/assets/')) return
  event.respondWith(
    caches.open(PRE).then((cache) => cache.match('/index.html')).then((hit) => hit || fetch(event.request)),
  )
})
`

const NEW_SW = `importScripts('/sw-reload.js')\nself.skipWaiting()\n`

let phase = 'old'

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  res.setHeader('cache-control', 'no-store')
  if (url.pathname === '/sw.js') {
    res.setHeader('content-type', 'application/javascript')
    res.end(phase === 'old' ? OLD_SW : NEW_SW)
    return
  }
  if (url.pathname === '/sw-reload.js') {
    res.setHeader('content-type', 'application/javascript')
    res.end(await readFile(swReloadPath))
    return
  }
  if (url.pathname === '/assets/app.js') {
    res.setHeader('content-type', 'text/javascript')
    res.end('globalThis.__alignAsset = 1')
    return
  }
  if (url.pathname === '/assets/poison.js') {
    res.setHeader('content-type', 'text/html')
    res.end('<!doctype html><title>shell</title>')
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    res.statusCode = 404
    res.setHeader('content-type', 'text/plain')
    res.end('missing')
    return
  }
  res.setHeader('content-type', 'text/html')
  res.end(`<!doctype html><html><head><title>upgrade</title></head><body>
<script>
navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
</script>
</body></html>`)
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const origin = `http://127.0.0.1:${port}`

const browser = await playwright.chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

async function readAsset(page, path) {
  return page.evaluate(async (assetPath) => {
    const response = await fetch(assetPath)
    return {
      status: response.status,
      type: response.headers.get('content-type') || '',
      body: (await response.text()).slice(0, 80),
    }
  }, path)
}

try {
  const page = await browser.newPage()
  await page.goto(origin)
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  const before = await readAsset(page, '/assets/missing.js')
  if (!before.type.includes('text/html')) {
    throw new Error(`previous worker did not serve the shell for a missing asset: ${JSON.stringify(before)}`)
  }

  phase = 'new'
  const reloaded = page.waitForNavigation({ waitUntil: 'load' })
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) throw new Error('missing registration')
    await registration.update()
  })
  await reloaded
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  const version = await page.evaluate(
    () =>
      new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('message', function onMessage(event) {
          if (!event.data || event.data.type !== 'align-sw-version') return
          navigator.serviceWorker.removeEventListener('message', onMessage)
          resolve(event.data.version)
        })
        navigator.serviceWorker.controller?.postMessage({ type: 'align-sw-version' })
      }),
  )
  if (version !== 'v2') throw new Error(`expected v2 after upgrade, got ${version}`)

  const real = await readAsset(page, '/assets/app.js')
  const poison = await readAsset(page, '/assets/poison.js')
  const missing = await readAsset(page, '/assets/missing.js')
  const keys = await page.evaluate(() => caches.keys())

  if (real.status !== 200 || !real.type.includes('javascript') || !real.body.includes('__alignAsset')) {
    throw new Error(`real asset was not served: ${JSON.stringify(real)}`)
  }
  if (poison.status !== 404 || poison.type.includes('text/html') || poison.body.includes('<!doctype')) {
    throw new Error(`html asset response was not turned into a 404: ${JSON.stringify(poison)}`)
  }
  if (missing.status !== 404 || missing.type.includes('text/html')) {
    throw new Error(`missing asset was not a 404: ${JSON.stringify(missing)}`)
  }
  if (keys.includes('align-pages')) throw new Error(`legacy page cache survived: ${keys.join(',')}`)

  console.log(JSON.stringify({ version, real, poison, missing, keys }))
} finally {
  await browser.close()
  server.close()
}
