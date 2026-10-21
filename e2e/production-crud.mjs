import { createHmac } from 'node:crypto'
import playwright from 'playwright-core'

const { chromium } = playwright

const base = 'https://align-hazel-kappa.vercel.app'
const stamp = Date.now().toString(36)
const email = `e2e-${stamp}@align.test`
let password = 'AlignLamp-e2e-2026x'
const projectName = `E2E Lamp ${stamp}`
const taskTitle = `Cut the wick ${stamp}`
const renamedTask = `Trim the wick ${stamp}`
const noteTitle = `Materials ${stamp}`
const todayTitle = `Pack the crate ${stamp}`
const labelName = `Wick ${stamp}`
const profileName = `E2E Renamed ${stamp}`

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

const context = await browser.newContext({
  timezoneId: 'Asia/Riyadh',
  serviceWorkers: 'block',
  viewport: { width: 1280, height: 800 },
})
const page = await context.newPage()
page.setDefaultTimeout(20_000)
page.on('dialog', (dialog) => void dialog.accept())

async function continuePastRecoveryKey(target) {
  const key = (await target.locator('#recovery-key').innerText()).trim()
  if (!/^[0-9a-f]{4}(?:-[0-9a-f]{4}){7}$/i.test(key)) throw new Error('recovery key was not shown')
  await target.getByRole('button', { name: "I've saved this key" }).click()
  return key
}

const TOTP_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function totpCode(secret) {
  const cleaned = secret.replace(/=+$/g, '').toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const bytes = []
  for (const char of cleaned) {
    const index = TOTP_ALPHABET.indexOf(char)
    if (index === -1) continue
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  const counter = Math.floor(Date.now() / 1000 / 30)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(buffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return binary.toString().padStart(6, '0')
}

async function apiHeaders(browserContext) {
  const { cookies } = await browserContext.storageState()
  const csrf = cookies.find((cookie) => cookie.name === 'csrf')?.value
  return csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}
}

const results = []
function pass(name) {
  results.push(name)
  console.log('PASS', name)
}

async function offlineServiceWorkers(browser, conditions) {
  const browserSession = await browser.newBrowserCDPSession()
  try {
    const { targetInfos } = await browserSession.send('Target.getTargets')
    for (const info of targetInfos) {
      if (info.type !== 'service_worker') continue
      const { sessionId } = await browserSession.send('Target.attachToTarget', {
        targetId: info.targetId,
        flatten: false,
      })
      await browserSession.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({
          id: 1,
          method: 'Network.emulateNetworkConditions',
          params: conditions,
        }),
      })
    }
  } finally {
    await browserSession.detach().catch(() => {})
  }
}

/** Gaps while the server is unreachable: 1s, 2s, then 3s, and 5s only after the first minute. */
function assertUnreachableCadence(times, label) {
  const gaps = times.slice(1).map((time, index) => time - times[index])
  if (times.length < 8 || times.length > 40) {
    throw new Error(`${label} probe count ${times.length} gaps ${gaps.join(',')}`)
  }
  const steps = [1000, 2000, 3000]
  let step = steps.findIndex((candidate) => Math.abs(gaps[0] - candidate) <= candidate * 0.35)
  if (step < 0) throw new Error(`${label} backoff ${gaps.join(',')} is not 1s, 2s, then 3s`)
  for (let index = 0; index < gaps.length; index += 1) {
    const started = times[index] - times[0]
    const steady = steps[Math.min(step, steps.length - 1)]
    const expected = started >= 60_000 ? 5000 : steady
    const nearCap = started >= 55_000
    const matches = (value) => Math.abs(gaps[index] - value) <= value * 0.35
    if (!matches(expected) && !(nearCap && (matches(3000) || matches(5000)))) {
      throw new Error(`${label} backoff ${gaps.join(',')} expected ${expected} at ${index}`)
    }
    if (step < steps.length - 1) step += 1
  }
  return gaps
}

/** CDP offline, same shape as DevTools Offline. The service worker is active. */
async function holdOfflineBar(browser, signedIn) {
  const state = await signedIn.storageState()
  const swContext = await browser.newContext({
    timezoneId: 'Asia/Riyadh',
    viewport: { width: 1280, height: 800 },
    storageState: state,
  })
  const swPage = await swContext.newPage()
  swPage.setDefaultTimeout(25_000)
  const probes = []
  const started = new WeakMap()
  swPage.on('request', (request) => {
    try {
      if (new URL(request.url()).pathname === '/api/health') started.set(request, Date.now())
    } catch {
      // Ignore malformed URLs.
    }
  })
  swPage.on('requestfailed', (request) => {
    const at = started.get(request)
    if (at === undefined) return
    probes.push({ t: at, failed: true, status: 0, error: request.failure()?.errorText ?? 'failed' })
  })
  swPage.on('requestfinished', async (request) => {
    const at = started.get(request)
    if (at === undefined) return
    const response = await request.response()
    probes.push({ t: at, failed: false, status: response?.status() ?? 0, error: '' })
  })

  try {
    await swPage.goto(`${base}/`)
    await swPage.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 })
    await swPage.getByRole('heading', { level: 1, name: /E2E/ }).waitFor()
    // Activation reloads the tab once. Let that finish before the network drops.
    await swPage.waitForTimeout(2000)
    await swPage.getByRole('heading', { level: 1, name: /E2E/ }).waitFor()
    const controlled = await swPage.evaluate(() => Boolean(navigator.serviceWorker?.controller))
    if (!controlled) throw new Error('service worker is not controlling the page')

    const conditions = {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    }
    const pageSession = await swContext.newCDPSession(swPage)
    await pageSession.send('Network.emulateNetworkConditions', conditions)
    await offlineServiceWorkers(browser, conditions).catch((error) => {
      console.log('service worker offline', error instanceof Error ? error.message : error)
    })

    const offlineAt = Date.now()
    const bar = swPage.locator('[role="status"]').filter({ hasText: /You're offline\.|Can't reach the server\./ })
    await bar.waitFor({ timeout: 45_000 })
    const appeared = Date.now()
    const until = appeared + 60_000
    while (Date.now() < until) {
      if (!(await bar.isVisible())) throw new Error(`offline bar cleared after ${Date.now() - appeared}ms`)
      await swPage.waitForTimeout(2000)
    }
    await swPage.waitForTimeout(300)

    const hits = probes.filter((probe) => probe.t >= offlineAt).sort((a, b) => a.t - b.t)
    const answered = hits.filter((probe) => !probe.failed)
    if (answered.length) throw new Error(`health was answered while offline ${JSON.stringify(answered)}`)
    const gaps = assertUnreachableCadence(hits.map((hit) => hit.t), 'cdp offline')
    console.log('offline probes', hits.length, 'gaps', gaps.join(','))

    // DevTools' "No throttling" is this CDP call. Do not dispatch a synthetic
    // online event — the page has to notice the real transition itself.
    await setTargetsOffline(browser, pageSession, false)
    const restoredAt = Date.now()
    await bar.waitFor({ state: 'hidden', timeout: 2_000 })
    console.log('cdp bar cleared', Date.now() - restoredAt, 'ms')
  } finally {
    await swContext.close()
  }
}

async function setTargetsOffline(browser, pageSession, offline) {
  const conditions = {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  }
  await pageSession.send('Network.emulateNetworkConditions', conditions)
  await offlineServiceWorkers(browser, conditions).catch((error) => {
    console.log('service worker offline', error instanceof Error ? error.message : error)
  })
}

/**
 * Outage where the browser never goes offline: /api/* is aborted, navigator.onLine
 * stays true, and restoring the route dispatches no online/offline/focus/visibility event.
 * The bar has to clear on the 3s/5s timer.
 */
async function reconnectWhileBrowserStaysOnline(browser, signedIn) {
  const state = await signedIn.storageState()
  const ctx = await browser.newContext({
    timezoneId: 'Asia/Riyadh',
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 800 },
    storageState: state,
  })
  const swPage = await ctx.newPage()
  swPage.setDefaultTimeout(25_000)
  const probes = []
  swPage.on('request', (request) => {
    try {
      if (new URL(request.url()).pathname === '/api/health') probes.push(Date.now())
    } catch {
      // Ignore malformed URLs.
    }
  })
  const abortApi = (route) => route.abort('failed')
  try {
    await swPage.goto(`${base}/`)
    await swPage.getByRole('heading', { level: 1, name: /E2E/ }).waitFor()
    await swPage.evaluate(() => {
      window.__alignNet = []
      for (const type of ['online', 'offline', 'focus', 'visibilitychange']) {
        window.addEventListener(type, () => {
          window.__alignNet.push(type)
        })
      }
    })
    await swPage.route('**/api/**', abortApi)
    const blockedAt = Date.now()
    const bar = swPage.locator('[role="status"]').filter({ hasText: "Can't reach the server." })
    await bar.waitFor({ timeout: 45_000 })
    const appeared = Date.now()
    const until = appeared + 60_000
    while (Date.now() < until) {
      if (!(await bar.isVisible())) throw new Error(`bar cleared during request outage after ${Date.now() - appeared}ms`)
      const onLine = await swPage.evaluate(() => navigator.onLine)
      if (onLine !== true) throw new Error(`navigator.onLine became ${String(onLine)}`)
      await swPage.waitForTimeout(2000)
    }
    const during = probes.filter((time) => time >= blockedAt)
    const gaps = assertUnreachableCadence(during, 'request outage')
    console.log('online-flag outage probes', during.length, 'gaps', gaps.join(','))

    const eventsBefore = await swPage.evaluate(() => window.__alignNet.length)
    await swPage.unroute('**/api/**', abortApi)
    const restoredAt = Date.now()
    await bar.waitFor({ state: 'hidden', timeout: 6_000 })
    const events = await swPage.evaluate(() => window.__alignNet)
    const duringRestore = events.slice(eventsBefore)
    if (duringRestore.length) throw new Error(`browser events during restore: ${duringRestore.join(',')}`)
    console.log('online-flag bar cleared', Date.now() - restoredAt, 'ms')
  } finally {
    await ctx.close()
  }
}

/** Browser offline (navigator.onLine false) for 20s+, then restore. No synthetic online event. */
async function reconnectAfterBrowserOffline(browser, signedIn) {
  const state = await signedIn.storageState()
  const swContext = await browser.newContext({
    timezoneId: 'Asia/Riyadh',
    viewport: { width: 1280, height: 800 },
    storageState: state,
  })
  const swPage = await swContext.newPage()
  swPage.setDefaultTimeout(25_000)
  try {
    await swPage.goto(`${base}/`)
    await swPage.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 })
    await swPage.getByRole('heading', { level: 1, name: /E2E/ }).waitFor()
    await swPage.waitForTimeout(1500)
    await swContext.setOffline(true)
    const bar = swPage.locator('[role="status"]').filter({ hasText: /You're offline\.|Can't reach the server\./ })
    await bar.waitFor({ timeout: 20_000 })
    await swPage.waitForTimeout(20_000)
    if (!(await bar.isVisible())) throw new Error('bar cleared during the browser-offline hold')
    await swContext.setOffline(false)
    const restoredAt = Date.now()
    await bar.waitFor({ state: 'hidden', timeout: 2_000 })
    console.log('browser offline bar cleared', Date.now() - restoredAt, 'ms')
  } finally {
    await swContext.close()
  }
}

/** Cached project data stays up for 60s offline, and one queued add syncs once. */
async function offlineProjectRoundTrip(browser, signedIn, projectUrl, existingTitle) {
  const projectId = projectUrl.split('/projects/')[1]?.split(/[?#]/)[0]
  if (!projectId) throw new Error(`project url ${projectUrl}`)
  const state = await signedIn.storageState()
  const swContext = await browser.newContext({
    timezoneId: 'Asia/Riyadh',
    viewport: { width: 1280, height: 800 },
    storageState: state,
  })
  const swPage = await swContext.newPage()
  swPage.setDefaultTimeout(25_000)
  const offlineTitle = `Offline wick ${Date.now().toString(36)}`
  try {
    await swPage.goto(projectUrl)
    await swPage.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 })
    await swPage.getByRole('heading', { level: 1, name: /E2E Lamp/ }).waitFor()
    await swPage.waitForTimeout(2000)
    await swPage.getByText(existingTitle).waitFor()
    const tasksUrl = `${base}/api/projects/${projectId}/tasks`
    const before = await (await swContext.request.get(tasksUrl)).json()
    if (!before.some((task) => task.title === existingTitle)) throw new Error('task missing before offline')

    const pageSession = await swContext.newCDPSession(swPage)
    await setTargetsOffline(browser, pageSession, true)
    const until = Date.now() + 60_000
    while (Date.now() < until) {
      if (await swPage.getByRole('heading', { name: 'Something went wrong' }).count()) {
        throw new Error('project page showed the error state while offline')
      }
      if (!(await swPage.getByText(existingTitle).first().isVisible())) {
        throw new Error('cached task disappeared while offline')
      }
      await swPage.waitForTimeout(2000)
    }

    await swPage.getByLabel('Task title').fill(offlineTitle)
    await swPage.getByRole('button', { name: 'Add', exact: true }).click()
    await swPage.getByText(offlineTitle).waitFor()
    const queued = await (await swContext.request.get(tasksUrl)).json()
    if (queued.some((task) => task.title === offlineTitle)) throw new Error('offline add reached the server')

    await setTargetsOffline(browser, pageSession, false)
    await swPage.evaluate(() => {
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    let seen = 0
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      const tasks = await (await swContext.request.get(tasksUrl)).json()
      seen = tasks.filter((task) => task.title === offlineTitle).length
      if (seen > 1) throw new Error(`offline add synced ${seen} times`)
      if (seen === 1) break
      await swPage.waitForTimeout(500)
    }
    if (seen !== 1) throw new Error(`offline add synced ${seen} times`)
    await swPage.waitForTimeout(2000)
    const after = await (await swContext.request.get(tasksUrl)).json()
    const count = after.filter((task) => task.title === offlineTitle).length
    if (count !== 1) throw new Error(`offline add synced ${count} times`)
  } finally {
    await swContext.close()
  }
}

/** Queue an add while /api/* fails and onLine stays true. The probe flush must POST once. */
async function queuedAddFlushesWithoutEvents(browser, signedIn, projectUrl) {
  const projectId = projectUrl.split('/projects/')[1]?.split(/[?#]/)[0]
  if (!projectId) throw new Error(`project url ${projectUrl}`)
  const state = await signedIn.storageState()
  const ctx = await browser.newContext({
    timezoneId: 'Asia/Riyadh',
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 800 },
    storageState: state,
  })
  const swPage = await ctx.newPage()
  swPage.setDefaultTimeout(25_000)
  const title = `Queued wick ${Date.now().toString(36)}`
  const posts = []
  const taskPostAt = []
  const noteTaskPost = (request, finished) => {
    try {
      const url = new URL(request.url())
      if (request.method() !== 'POST' || url.pathname !== `/api/projects/${projectId}/tasks`) return
      if (finished) posts.push(request.url())
      else taskPostAt.push(Date.now())
    } catch {
      // Ignore malformed URLs.
    }
  }
  swPage.on('request', (request) => noteTaskPost(request, false))
  swPage.on('requestfinished', (request) => noteTaskPost(request, true))
  const abortApi = (route) => route.abort('failed')
  try {
    await swPage.goto(projectUrl)
    await swPage.getByRole('heading', { level: 1, name: /E2E Lamp/ }).waitFor()
    await swPage.getByLabel('Task title').waitFor()
    await swPage.evaluate(() => {
      window.__alignNet = []
      for (const type of ['online', 'offline', 'focus', 'visibilitychange']) {
        window.addEventListener(type, () => {
          window.__alignNet.push(type)
        })
      }
    })
    await swPage.route('**/api/**', abortApi)
    await swPage.getByLabel('Task title').fill(title)
    await swPage.getByRole('button', { name: 'Add', exact: true }).click()
    await swPage.getByText('Queued', { exact: true }).waitFor()
    const during = await (await ctx.request.get(`${base}/api/projects/${projectId}/tasks`)).json()
    if (during.some((task) => task.title === title)) throw new Error('queued add reached the server while requests were aborted')

    const queuedAt = Date.now()
    await swPage.waitForTimeout(20_000)
    if (!(await swPage.getByText('Queued', { exact: true }).isVisible())) throw new Error('queued add flushed during the outage')

    const eventsBefore = await swPage.evaluate(() => window.__alignNet.length)
    await swPage.unroute('**/api/**', abortApi)
    const restoredAt = Date.now()
    const retries = taskPostAt.filter((at) => at >= queuedAt && at < restoredAt)
    const span = Math.max(restoredAt - queuedAt, 1)
    const allowed = Math.floor(span / 15_000) + 1
    if (retries.length > allowed) {
      const offsets = retries.map((at) => at - queuedAt).join(',')
      throw new Error(`queue posted ${retries.length} times in ${span}ms, cap is one attempt per 15s (${allowed}), offsets ${offsets}`)
    }
    const toast = swPage.getByText('Synced 1 saved change.')
    await Promise.all([
      toast.waitFor({ timeout: 8_000 }),
      swPage.getByText('Queued', { exact: true }).waitFor({ state: 'hidden', timeout: 8_000 }),
    ])
    const elapsed = Date.now() - restoredAt
    await swPage.waitForTimeout(4_000)
    if (!(await toast.isVisible())) throw new Error('synced toast hid before 4s')
    const events = await swPage.evaluate(() => window.__alignNet)
    const duringRestore = events.slice(eventsBefore)
    if (duringRestore.length) throw new Error(`browser events during queued flush: ${duringRestore.join(',')}`)
    if (posts.length !== 1) throw new Error(`queued add posted ${posts.length} times`)
    const after = await (await ctx.request.get(`${base}/api/projects/${projectId}/tasks`)).json()
    const count = after.filter((task) => task.title === title).length
    if (count !== 1) throw new Error(`queued add synced ${count} times`)
    console.log('queued add flushed', elapsed, 'ms')
  } finally {
    await ctx.close()
  }
}

/** /trash was opened online. A full reload while offline must show that cached item. */
async function offlineTrashCache(browser, signedIn, projectName) {
  const state = await signedIn.storageState()
  const ctx = await browser.newContext({
    timezoneId: 'Asia/Riyadh',
    viewport: { width: 1280, height: 800 },
    storageState: state,
  })
  const swPage = await ctx.newPage()
  swPage.setDefaultTimeout(25_000)
  try {
    await swPage.goto(`${base}/trash`)
    await swPage.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 })
    await swPage.getByRole('heading', { name: 'Trash', exact: true }).waitFor()
    await swPage.getByRole('button', { name: `Restore ${projectName}` }).waitFor()
    await swPage.waitForFunction(
      (name) =>
        Object.keys(localStorage).some(
          (key) => key.startsWith('align-rq:') && (localStorage.getItem(key) ?? '').includes(name),
        ),
      projectName,
    )
    await ctx.setOffline(true)
    await swPage.goto(`${base}/trash`)
    await swPage.getByRole('heading', { name: 'Trash', exact: true }).waitFor()
    await swPage.getByRole('button', { name: `Restore ${projectName}` }).waitFor()
    if (await swPage.getByRole('heading', { name: "You're offline. This page will load when you reconnect." }).count()) {
      throw new Error('offline trash reload showed the empty state')
    }
    console.log('offline trash reload kept', projectName)
  } finally {
    await ctx.setOffline(false).catch(() => {})
    await ctx.close()
  }
}

/** An unvisited route with no cache shows the offline empty state, then loads on its own. */
async function unvisitedRouteRecovers(browser, signedIn, projectName) {
  const state = await signedIn.storageState()
  const ctx = await browser.newContext({
    timezoneId: 'Asia/Riyadh',
    viewport: { width: 1280, height: 800 },
    storageState: state,
  })
  const swPage = await ctx.newPage()
  swPage.setDefaultTimeout(25_000)
  let gateway = 0
  swPage.on('response', (response) => {
    try {
      if (response.status() === 504 && new URL(response.url()).pathname.startsWith('/api/')) gateway += 1
    } catch {
      // Ignore malformed URLs.
    }
  })
  try {
    await swPage.goto(`${base}/`)
    await swPage.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 })
    await swPage.getByRole('heading', { level: 1, name: /E2E/ }).waitFor()
    await swPage.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('align-rq') || key.startsWith('align-recent-projects')) localStorage.removeItem(key)
      }
    })
    await swPage.reload()
    await swPage.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 })
    await swPage.getByRole('heading', { level: 1, name: /E2E/ }).waitFor()
    await swPage.waitForTimeout(1000)
    await swPage.evaluate(async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key === 'align-api').map((key) => caches.delete(key)))
    })
    gateway = 0
    await ctx.setOffline(true)
    await swPage.getByLabel('Primary').getByRole('link', { name: 'Projects' }).click()
    await swPage.getByRole('heading', { name: "You're offline. This page will load when you reconnect." }).waitFor()
    if (await swPage.getByRole('heading', { name: 'Something went wrong' }).count()) {
      throw new Error('unvisited projects page showed the error state')
    }
    if (gateway) throw new Error(`service worker synthesized ${gateway} 504s`)
    await ctx.setOffline(false)
    await swPage.getByRole('link', { name: projectName, exact: true }).waitFor({ timeout: 8_000 })
    if (await swPage.getByRole('button', { name: 'Try again' }).count()) {
      throw new Error('projects page still offered Try again after reconnect')
    }
    console.log('unvisited projects recovered without a click')
  } finally {
    await ctx.setOffline(false).catch(() => {})
    await ctx.close()
  }
}

/**
 * A second account visits the workspace, opens one project, and leaves another
 * unopened. Logout must not leave the name, email, or a service-worker session.
 */
async function signedOutOfflineAndUnvisited(browser) {
  const stamp = Date.now().toString(36)
  const name = `E2E Priv ${stamp}`
  const email = `e2e-priv-${stamp}@align.test`
  const password = 'AlignLamp-e2e-2026x'
  const openedName = `Opened shade ${stamp}`
  const hiddenName = `Unvisited shade ${stamp}`
  const label = `Wax ${stamp}`
  const ctx = await browser.newContext({
    timezoneId: 'Asia/Riyadh',
    viewport: { width: 1280, height: 800 },
  })
  const swPage = await ctx.newPage()
  swPage.setDefaultTimeout(25_000)
  const sessionFromWorker = []
  let watchSession = false
  swPage.on('response', (response) => {
    if (!watchSession) return
    try {
      const url = new URL(response.url())
      if (url.pathname !== '/api/auth/session' && url.pathname !== '/api/auth/me') return
      if (response.fromServiceWorker() || response.status() === 200) {
        sessionFromWorker.push(`${response.status()} ${url.pathname} sw=${response.fromServiceWorker()}`)
      }
    } catch {
      // Ignore malformed URLs.
    }
  })
  try {
    await swPage.goto(`${base}/register`)
    await swPage.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 })
    // Activation reloads the tab once. Fill the form after that, or the reload cancels submit.
    await swPage.waitForTimeout(1500)
    await swPage.locator('#name').waitFor()
    await swPage.locator('#name').fill(name)
    await swPage.locator('#email').fill(email)
    await swPage.locator('#password').fill(password)
    await swPage.getByRole('button', { name: 'Create account' }).click()
    await continuePastRecoveryKey(swPage)
    await swPage.getByRole('heading', { level: 1, name: /E2E/ }).waitFor()
    await swPage.getByLabel('Primary').getByRole('link', { name: 'Projects' }).click()
    await swPage.getByRole('button', { name: 'New project' }).click()
    await swPage.locator('#project-name').fill(openedName)
    await swPage.getByRole('button', { name: 'Create project' }).click()
    await swPage.getByRole('heading', { name: openedName }).waitFor()
    await swPage.getByLabel('Label name').fill(label)
    await swPage.getByRole('button', { name: 'Add label' }).click()
    await swPage.getByRole('listitem').getByText(label, { exact: true }).waitFor()
    await swPage.getByLabel('Primary').getByRole('link', { name: 'Today' }).click()
    await swPage.getByRole('heading', { name: 'Today', exact: true }).waitFor()
    await swPage.goBack()
    await swPage.getByRole('heading', { name: openedName }).waitFor()
    await swPage.waitForTimeout(1500)

    await ctx.setOffline(true)
    await swPage.reload()
    await swPage.getByRole('heading', { name: openedName }).waitFor()
    await swPage.getByRole('listitem').getByText(label, { exact: true }).waitFor()
    if (!(await swPage.getByText(name, { exact: true }).count())) throw new Error('signed-in offline reload hid the account name')
    await ctx.setOffline(false)
    await swPage.getByRole('heading', { name: openedName }).waitFor()

    const created = await ctx.request.post(`${base}/api/projects`, {
      data: { name: hiddenName },
      headers: await apiHeaders(ctx),
    })
    if (!created.ok()) throw new Error(`second project ${created.status()}`)
    const hidden = await created.json()
    if (!hidden.id) throw new Error('second project has no id')
    await ctx.setOffline(true)
    await swPage.goto(`${base}/projects/${hidden.id}`)
    await swPage.getByRole('heading', { name: "You're offline. This page will load when you reconnect." }).waitFor()
    if (await swPage.getByRole('heading', { name: 'Something went wrong' }).count()) {
      throw new Error('unvisited project showed the error state')
    }
    if (await swPage.getByRole('heading', { name: hiddenName }).count()) {
      throw new Error('unvisited project rendered cached data')
    }
    await ctx.setOffline(false)
    await swPage.getByRole('heading', { level: 1, name: hiddenName }).waitFor({ timeout: 8_000 })
    if (await swPage.getByRole('button', { name: 'Try again' }).count()) {
      throw new Error('unvisited project still offered Try again after reconnect')
    }
    pass('unvisited project offline')

    await swPage.goto(`${base}/settings`)
    await swPage.getByRole('button', { name: 'Sign out', exact: true }).click()
    await swPage.getByRole('heading', { name: 'Keep your work in alignment.' }).waitFor()
    sessionFromWorker.length = 0
    watchSession = true
    await ctx.setOffline(true)
    await swPage.goto(`${base}/projects`)
    await swPage.getByRole('heading', { name: 'Sign in' }).waitFor({ timeout: 15_000 })
    const html = await swPage.content()
    if (html.includes(name) || html.includes(email)) throw new Error('signed-out offline page still contains the account')
    if (await swPage.getByRole('button', { name: 'New project' }).count()) {
      throw new Error('signed-out offline page still showed the workspace')
    }
    if (sessionFromWorker.length) throw new Error(`session served after logout: ${sessionFromWorker.join('; ')}`)
    console.log('signed-out offline projects hid the account')
    pass('logged-out offline hides identity')
  } finally {
    await ctx.setOffline(false).catch(() => {})
    const login = await ctx.request.post(`${base}/api/auth/login`, { data: { email, password }, headers: await apiHeaders(ctx) }).catch(() => null)
    if (login?.ok()) {
      const stepped = await ctx.request.post(`${base}/api/auth/step-up`, { headers: await apiHeaders(ctx), data: { password } })
      if (!stepped.ok()) throw new Error(`private account step-up ${stepped.status()}`)
      const removed = await ctx.request.delete(`${base}/api/auth/me`, { headers: await apiHeaders(ctx), data: { password } })
      if (!removed.ok()) throw new Error(`private account delete ${removed.status()}`)
    }
    await ctx.close()
  }
}

try {
  await page.goto(`${base}/register`)
  await page.getByText('Use 10+ characters. Under 10, mix at least two of lowercase, uppercase, numbers, and symbols — three if under 8.').waitFor()
  pass('password hint')
  await page.locator('#name').fill('E2E Owner')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  const recoveryKey = await continuePastRecoveryKey(page)
  await page.getByRole('heading', { name: /E2E/ }).waitFor()
  pass('register')

  await page.getByLabel('Primary').getByRole('link', { name: 'Projects' }).click()
  await page.getByRole('button', { name: 'New project' }).click()
  await page.locator('#project-name').fill(projectName)
  await page.locator('#project-description').fill('A beeswax shade for the e2e lamp.')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.getByRole('heading', { name: projectName }).waitFor()
  pass('create project')

  await page.getByLabel('Label name').fill(labelName)
  await page.getByRole('button', { name: 'Add label' }).click()
  await page.getByRole('listitem').getByText(labelName, { exact: true }).waitFor()
  pass('create label')

  await page.getByLabel('Task title').fill(taskTitle)
  await page.getByLabel('Due date').fill('2026-10-18')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByText(taskTitle).waitFor()
  pass('create task')

  await page.getByRole('button', { name: `Edit “${taskTitle}”` }).click()
  await page.getByRole('listitem').getByLabel('Task title').fill(renamedTask)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText(renamedTask).waitFor()
  pass('update task')

  await page.getByRole('tab', { name: 'Notes' }).click()
  await page.getByRole('button', { name: 'New note' }).click()
  await page.getByLabel('Title').fill(noteTitle)
  await page.getByLabel('Note body').fill('Use beeswax, not paraffin.')
  await page.getByRole('status').filter({ hasText: 'Saved' }).waitFor()
  pass('create note')

  await page.goBack()
  await page.getByRole('tab', { name: 'Activity' }).click()
  await page.getByText(/Created/).first().waitFor()
  pass('activity')

  await page.getByRole('tab', { name: 'Whiteboard' }).click()
  const canvas = page.getByLabel('Project whiteboard')
  await canvas.waitFor()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('whiteboard has no box')
  await page.mouse.move(box.x + 30, box.y + 30)
  await page.mouse.down()
  await page.mouse.move(box.x + 140, box.y + 90, { steps: 8 })
  await page.mouse.up()
  await page.getByText('Saved', { exact: true }).waitFor()
  pass('whiteboard save')

  await page.reload()
  await page.getByRole('heading', { name: projectName }).waitFor()
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.getByText(renamedTask).waitFor()
  await page.getByRole('listitem').getByText(labelName, { exact: true }).waitFor()
  pass('reload project')

  const projectUrl = page.url().split('?')[0]
  const listed = await context.request.get(`${base}/api/projects?status=active`)
  const projects = await listed.json()
  const project = projects.find((item) => item.name === projectName)
  if (!project) throw new Error('project missing from API after reload')
  const tasks = await (await context.request.get(`${base}/api/projects/${project.id}/tasks`)).json()
  if (!tasks.some((task) => task.title === renamedTask && task.dueDate === '2026-10-18')) {
    throw new Error(`task missing ${JSON.stringify(tasks)}`)
  }
  const notes = await (await context.request.get(`${base}/api/projects/${project.id}/notes`)).json()
  if (!notes.some((note) => note.title === noteTitle && note.body.includes('beeswax'))) {
    throw new Error(`note missing ${JSON.stringify(notes)}`)
  }
  const labels = await (await context.request.get(`${base}/api/labels`)).json()
  const label = labels.find((item) => item.name === labelName)
  if (!label) throw new Error('label missing')
  const patched = await context.request.patch(`${base}/api/labels/${label.id}`, {
    data: { name: `${labelName} edited` },
    headers: await apiHeaders(context),
  })
  if (patched.status() !== 200) throw new Error(`label patch ${patched.status()}`)
  const board = await (await context.request.get(`${base}/api/projects/${project.id}/whiteboard`)).json()
  if (!board.scene?.strokes?.length) throw new Error('whiteboard stroke did not persist')
  pass('api round trip')

  await page.reload()
  await page.getByRole('listitem').getByText(`${labelName} edited`, { exact: true }).waitFor()
  pass('label rename visible')

  const page2 = await context.newPage()
  page2.setDefaultTimeout(20_000)
  await page2.goto(projectUrl)
  await page2.getByText(renamedTask).waitFor()
  await page2.getByRole('listitem').getByText(`${labelName} edited`, { exact: true }).waitFor()
  await page2.getByRole('tab', { name: 'Notes' }).click()
  await page2.getByText(noteTitle).waitFor()
  await page2.getByRole('tab', { name: 'Whiteboard' }).click()
  const board2 = await (await page2.request.get(`${base}/api/projects/${project.id}/whiteboard`)).json()
  if (!board2.scene?.strokes?.length) throw new Error('second tab lost the whiteboard')
  pass('second tab')

  await page.goto(`${base}/today`)
  await page.getByLabel('Task').fill(todayTitle)
  await page.getByRole('button', { name: 'Add for today' }).click()
  await page.getByText(todayTitle).waitFor()
  await page.reload()
  await page.getByText(todayTitle).waitFor()
  const today = await (await context.request.get(`${base}/api/today?date=2026-10-17`)).json()
  const planned = [...today.planned, ...today.available, ...today.overdue, ...today.carried]
  if (!planned.some((task) => task.title === todayTitle)) throw new Error('today task missing from API')
  pass('today')

  await page.locator('#sidebar-search').fill(`wick ${stamp}`)
  await page.waitForURL(/\/search\?/)
  await page.getByText(renamedTask).waitFor()
  pass('search')

  await page.goto(projectUrl)
  await page.getByRole('tab', { name: 'Tasks' }).click()
  const overdueTitle = `R2 overdue ${stamp}`
  const futureTitle = `R2 future ${stamp}`
  await page.getByLabel('Task title').fill(overdueTitle)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByText(overdueTitle).waitFor()
  await page.getByLabel('Task title').fill(futureTitle)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByText(futureTitle).waitFor()
  await page.locator('#sidebar-search').fill(`R2 ov ${stamp}`)
  await page.waitForURL(/\/search\?/)
  await page.getByText(overdueTitle).waitFor()
  await page.getByText(futureTitle).waitFor({ state: 'hidden' })
  pass('multi-word search')

  const conflictTitle = `Conflict base ${stamp}`
  const conflictNext = `Title from A ${stamp}`
  await page.goto(projectUrl)
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.getByLabel('Task title').fill(conflictTitle)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByText(conflictTitle).waitFor()
  const stale = await context.newPage()
  const watcher = await context.newPage()
  stale.setDefaultTimeout(20_000)
  watcher.setDefaultTimeout(20_000)
  await stale.goto(projectUrl)
  await watcher.goto(projectUrl)
  await stale.getByText(conflictTitle).waitFor()
  await watcher.getByText(conflictTitle).waitFor()
  await stale.getByRole('button', { name: `Edit “${conflictTitle}”` }).click()
  await page.getByRole('button', { name: `Edit “${conflictTitle}”` }).click()
  await page.getByRole('listitem').getByLabel('Task title').fill(conflictNext)
  await page.getByRole('listitem').getByLabel('Priority').selectOption('high')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText(conflictNext).waitFor()
  await watcher.getByText(conflictNext).waitFor()
  await stale.getByRole('listitem').getByLabel('Priority').selectOption('low')
  await stale.getByRole('button', { name: 'Save', exact: true }).click()
  await stale.getByRole('dialog', { name: 'This was changed elsewhere' }).waitFor()
  const during = await (await context.request.get(`${base}/api/projects/${project.id}/tasks`)).json()
  const duringTask = during.find((task) => task.title === conflictNext)
  if (!duringTask || duringTask.priority !== 'high') throw new Error(`stale write landed ${JSON.stringify(during)}`)
  await stale.getByRole('button', { name: 'Overwrite' }).click()
  await stale.getByText(conflictNext).waitFor()
  const after = await (await context.request.get(`${base}/api/projects/${project.id}/tasks`)).json()
  const afterTask = after.find((task) => task.title === conflictNext)
  if (!afterTask || afterTask.priority !== 'low') throw new Error(`overwrite ${JSON.stringify(afterTask)}`)
  await stale.close()
  await watcher.close()
  pass('two-tab conflict')

  await page.getByRole('button', { name: /Notifications/ }).click()
  await page.getByRole('button', { name: `Mark “${renamedTask}” read` }).click()
  pass('notification')

  await page.goto(`${base}/settings`)
  await page.locator('#profile-name').fill(profileName)
  await page.getByRole('button', { name: 'Save name' }).click()
  await page.getByText('Name saved').waitFor()
  await page.reload()
  await page.locator('#profile-name').waitFor()
  const savedName = await page.locator('#profile-name').inputValue()
  if (savedName !== profileName) throw new Error(`name is ${savedName}`)
  await page2.goto(`${base}/settings`)
  if ((await page2.locator('#profile-name').inputValue()) !== profileName) throw new Error('second tab name')
  pass('settings')

  const probeStart = Date.now()
  const probeHits = []
  const onProbe = (request) => {
    if (new URL(request.url()).pathname === '/api/health') probeHits.push(Date.now())
  }
  page.on('request', onProbe)
  await context.setOffline(true)
  await page.getByText("You're offline.").waitFor()
  await page.waitForTimeout(7500)
  page.off('request', onProbe)
  await context.setOffline(false)
  const gaps = probeHits.map((hit, index) => (index === 0 ? 0 : hit - probeHits[index - 1])).slice(1)
  // One in-flight probe can overlap the first recovery probe as the network drops.
  const ladder = gaps[0] < 450 ? gaps.slice(1) : gaps
  if (probeHits.length < 3 || probeHits.length > 8) {
    throw new Error(`probe count ${probeHits.length} in ${Date.now() - probeStart}ms gaps ${gaps.join(',')}`)
  }
  if (ladder.some((gap) => gap < 450)) throw new Error(`probe gaps too small ${gaps.join(',')}`)
  if (ladder.some((gap) => gap > 4500)) throw new Error(`probe backed off too far ${gaps.join(',')}`)
  if (!ladder.some((gap) => gap >= 1800)) throw new Error(`probe did not reach 2s ${gaps.join(',')}`)
  pass('probe backoff')

  const laterTitle = `Far due ${stamp}`
  await page.goto(projectUrl)
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.getByLabel('Task title').fill(laterTitle)
  await page.getByLabel('Due date').fill('2026-11-20')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByText(laterTitle).waitFor()
  await page.goto(`${base}/`)
  const upcoming = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Upcoming', exact: true }) })
  await upcoming.getByText(renamedTask).waitFor()
  await upcoming.getByText(laterTitle).waitFor({ state: 'hidden' })
  const viewAll = upcoming.getByRole('link', { name: /View all dated \(\d+\)/ })
  const viewAllLabel = await viewAll.innerText()
  const datedCount = Number(viewAllLabel.match(/\((\d+)\)/)?.[1])
  const badgeCount = Number((await upcoming.locator('div').first().locator('span').innerText()).trim())
  if (!Number.isFinite(badgeCount) || !Number.isFinite(datedCount) || badgeCount >= datedCount) {
    throw new Error(`upcoming ${badgeCount} vs ${viewAllLabel}`)
  }
  await viewAll.click()
  const dated = page.locator('section').filter({ has: page.getByRole('heading', { name: 'All dated', exact: true }) })
  await dated.getByText(laterTitle).waitFor()
  pass('upcoming labels')

  await holdOfflineBar(browser, context)
  pass('offline bar holds')

  await reconnectWhileBrowserStaysOnline(browser, context)
  pass('online-flag reconnect')

  await reconnectAfterBrowserOffline(browser, context)
  pass('browser offline reconnect')

  await offlineProjectRoundTrip(browser, context, projectUrl, renamedTask)
  pass('offline project cache')

  await queuedAddFlushesWithoutEvents(browser, context, projectUrl)
  pass('queued add flushes')

  await unvisitedRouteRecovers(browser, context, projectName)
  pass('unvisited route recovers')

  await signedOutOfflineAndUnvisited(browser)

  await page.goto(projectUrl)
  await page.getByRole('button', { name: `Delete “${renamedTask}”` }).click()
  await page.getByLabel('Delete task').getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('listitem').getByText(renamedTask, { exact: true }).waitFor({ state: 'hidden' })
  await page2.goto(projectUrl)
  await page2.getByText(renamedTask).waitFor({ state: 'hidden' })
  pass('delete task')

  await page.getByRole('button', { name: `Delete label ${labelName} edited` }).click()
  await page.getByRole('listitem').getByText(`${labelName} edited`, { exact: true }).waitFor({ state: 'hidden' })
  pass('delete label')

  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByLabel('Delete project').getByRole('button', { name: 'Delete' }).click()
  await page.waitForURL(/\/projects\/?$/)
  await page.getByRole('link', { name: projectName, exact: true }).waitFor({ state: 'detached' })
  pass('delete project')

  await offlineTrashCache(browser, context, projectName)
  pass('trash offline cache')

  await page.getByLabel('Primary').getByRole('link', { name: 'Trash' }).click()
  await page.getByRole('heading', { name: 'Trash', exact: true }).waitFor()
  await page.getByRole('button', { name: `Restore ${projectName}` }).click()
  await page.getByRole('button', { name: `Restore ${renamedTask}` }).click()
  await page.getByLabel('Primary').getByRole('link', { name: 'Projects' }).click()
  await page.getByRole('link', { name: projectName, exact: true }).waitFor()
  pass('trash restore')

  const other = await browser.newContext({
    timezoneId: 'Asia/Riyadh',
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  await page.goto(`${base}/settings`)
  await page.getByText('This device').waitFor()
  await page.getByRole('button', { name: /Notifications/ }).click()
  const secondLogin = await other.request.post(`${base}/api/auth/login`, {
    data: { email, password },
    headers: await apiHeaders(other),
  })
  if (!secondLogin.ok()) throw new Error(`second login ${secondLogin.status()}`)
  await page.getByRole('dialog', { name: 'Notifications' }).getByText(/New sign-in from Safari on iOS/).waitFor({ timeout: 15_000 })
  pass('new device notification')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Notifications' }).waitFor({ state: 'hidden' })
  await page.reload()
  await page.getByText('This device').waitFor()
  const otherRow = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Revoke' }) }).filter({ hasNotText: 'This device' })
  await otherRow.waitFor()
  const revoked = page.waitForResponse(
    (response) => response.url().includes('/api/auth/sessions/') && response.request().method() === 'DELETE',
  )
  await otherRow.getByRole('button', { name: 'Revoke' }).click()
  if ((await revoked).status() !== 204) throw new Error('revoke did not succeed')
  if ((await other.request.get(`${base}/api/auth/me`)).status() !== 401) throw new Error('revoked session still worked')
  await other.close()
  pass('revoke session')

  const currentSession = page.getByRole('listitem').filter({ hasText: 'This device' })
  await currentSession.locator('input[aria-label^="Rename"]').fill('Desk browser')
  await currentSession.getByRole('button', { name: 'Rename' }).click()
  await page.getByText('Session renamed').waitFor()
  pass('rename session')

  await page.locator('#security-password').fill(password)
  await page.getByRole('button', { name: 'Set up authenticator' }).click()
  await page.getByRole('dialog', { name: "Verify it's you" }).waitFor()
  await page.locator('#step-up-password').fill(password)
  await page.getByRole('dialog', { name: "Verify it's you" }).getByRole('button', { name: 'Continue' }).click()
  const secret = await page.locator('[data-secret]').getAttribute('data-secret')
  if (!secret) throw new Error('totp secret missing')
  await page.locator('#totp-code').fill(totpCode(secret))
  await page.getByRole('button', { name: 'Confirm code' }).click()
  const recovery = (await page.getByLabel('Recovery codes').locator('li').first().innerText()).trim()
  if (!recovery) throw new Error('recovery code missing')
  pass('enable totp')

  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('heading', { name: 'Keep your work in alignment.' }).waitFor()
  await page.goto(`${base}/login`)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.locator('#mfa-code').fill(totpCode(secret))
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Primary').getByRole('link', { name: 'Settings' }).waitFor()
  pass('login with totp')

  await page.goto(`${base}/settings`)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('heading', { name: 'Keep your work in alignment.' }).waitFor()
  await page.goto(`${base}/login`)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: 'Use a recovery code' }).click()
  await page.locator('#mfa-code').fill(recovery)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Primary').getByRole('link', { name: 'Settings' }).waitFor()
  pass('login with recovery code')

  await page.goto(`${base}/settings`)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('heading', { name: 'Keep your work in alignment.' }).waitFor()
  await page.goto(`${base}/forgot`)
  const resetPassword = 'AlignLamp-reset-2026x'
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(resetPassword)
  await page.locator('#confirm').fill(resetPassword)
  await page.locator('#account-recovery-key').fill(recoveryKey)
  await page.getByRole('button', { name: 'Reset password' }).click()
  await continuePastRecoveryKey(page)
  await page.getByLabel('Primary').getByRole('link', { name: 'Settings' }).waitFor()
  password = resetPassword
  pass('reset with recovery key')

  await page.goto(`${base}/settings`)
  await page.getByRole('button', { name: 'Delete account' }).click()
  await page.getByRole('dialog', { name: "Confirm it's you" }).waitFor()
  await page.locator('#delete-password').fill(password)
  await page.getByRole('dialog', { name: "Confirm it's you" }).getByRole('button', { name: 'Delete account' }).click()
  await page.getByRole('dialog', { name: "Verify it's you" }).waitFor()
  await page.locator('#step-up-password').fill(password)
  await page.getByRole('dialog', { name: "Verify it's you" }).getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL(/\/login|\/$/)
  const session = await context.request.get(`${base}/api/auth/session`)
  const body = await session.json()
  if (body.user) throw new Error('account still signed in')
  pass('delete account')

  const health = await (await context.request.get(`${base}/api/health`)).json()
  if (health.db !== 'up' || health.ok !== true || health.latencyMs || health.migration) {
    throw new Error(`health ${JSON.stringify(health)}`)
  }
  const shellResponse = await context.request.get(base)
  const shell = await shellResponse.text()
  const csp = shellResponse.headers()['content-security-policy'] ?? ''
  if (!/script-src 'self'(;|$)/.test(csp) || !csp.includes("object-src 'none'") || !csp.includes("base-uri 'self'") || !csp.includes("frame-ancestors 'none'") || !csp.includes("connect-src 'self'")) {
    throw new Error(`csp ${csp}`)
  }
  if (/<script\b[^>]*>\s*[^<\s]/.test(shell) || !shell.includes('src="/boot.js"')) throw new Error('inline script still in the shell')
  pass('health')
  console.log(JSON.stringify({ email, results }, null, 2))
} catch (error) {
  await page.screenshot({ path: '/tmp/align-e2e/fail.png', fullPage: true }).catch(() => {})
  console.error('FAIL', error)
  console.log('URL', page.url())
  await context.request.delete(`${base}/api/auth/me`, { headers: await apiHeaders(context), data: { password } }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  process.exit(process.exitCode ?? 0)
}
