import playwright from 'playwright-core'

const { chromium } = playwright

const base = 'https://align-hazel-kappa.vercel.app'
const stamp = Date.now().toString(36)
const email = `e2e-${stamp}@align.test`
const password = 'password12'
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

/** DevTools-style offline: the network is down, navigator.onLine stays true, and the service worker is active. */
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
    await swPage.getByRole('heading', { name: /E2E/ }).waitFor()
    // Activation reloads the tab once. Let that finish before the network drops.
    await swPage.waitForTimeout(2000)
    await swPage.getByRole('heading', { name: /E2E/ }).waitFor()
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
    const gaps = hits.slice(1).map((hit, index) => hit.t - hits[index].t)
    if (hits.length < 4 || hits.length > 12) {
      throw new Error(`offline probe count ${hits.length} gaps ${gaps.join(',')}`)
    }
    if (gaps.some((gap) => gap < 700)) throw new Error(`probes overlapped or did not back off ${gaps.join(',')}`)
    const floors = [800, 1500, 3000, 6000, 12000]
    const tail = gaps[0] > 5000 ? gaps.slice(1) : gaps
    for (let index = 0; index < Math.min(tail.length, floors.length); index += 1) {
      if (tail[index] + 250 < floors[index]) {
        throw new Error(`probe backoff ${tail.join(',')} expected at least ${floors[index]} at ${index}`)
      }
    }
    console.log('offline probes', hits.length, 'gaps', gaps.join(','))
  } finally {
    await swContext.close()
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
  if (probeHits.length < 3 || probeHits.length > 7) {
    throw new Error(`probe count ${probeHits.length} in ${Date.now() - probeStart}ms gaps ${gaps.join(',')}`)
  }
  if (gaps.some((gap) => gap < 700)) throw new Error(`probe gaps too small ${gaps.join(',')}`)
  if (gaps.length >= 2 && gaps[1] + 200 < gaps[0]) throw new Error(`probe did not back off ${gaps.join(',')}`)
  pass('probe backoff')

  const laterTitle = `Far due ${stamp}`
  await page.goto(projectUrl)
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.getByLabel('Task title').fill(laterTitle)
  await page.getByLabel('Due date').fill('2026-10-25')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByText(laterTitle).waitFor()
  await page.goto(`${base}/`)
  const upcoming = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Upcoming', exact: true }) })
  await upcoming.getByText(renamedTask).waitFor()
  await upcoming.getByText(laterTitle).waitFor({ state: 'hidden' })
  const viewAll = upcoming.getByRole('button', { name: /View all dated \(\d+\)/ })
  const viewAllLabel = await viewAll.innerText()
  const datedCount = Number(viewAllLabel.match(/\((\d+)\)/)?.[1])
  const badgeCount = Number((await upcoming.locator('div').first().locator('span').innerText()).trim())
  if (!Number.isFinite(badgeCount) || !Number.isFinite(datedCount) || badgeCount >= datedCount) {
    throw new Error(`upcoming ${badgeCount} vs ${viewAllLabel}`)
  }
  await viewAll.click()
  await page.getByRole('heading', { name: 'All dated', exact: true }).waitFor()
  await page.getByText(laterTitle).waitFor()
  pass('upcoming labels')

  await holdOfflineBar(browser, context)
  pass('offline bar holds')

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

  await page.goto(`${base}/settings`)
  await page.getByRole('button', { name: 'Delete account' }).click()
  await page.getByRole('button', { name: 'Delete account' }).last().click()
  await page.waitForURL(/\/login|\/$/)
  const session = await context.request.get(`${base}/api/auth/session`)
  const body = await session.json()
  if (body.user) throw new Error('account still signed in')
  pass('delete account')

  const health = await (await context.request.get(`${base}/api/health`)).json()
  if (health.db !== 'up') throw new Error(`health ${JSON.stringify(health)}`)
  pass('health')
  console.log(JSON.stringify({ email, results }, null, 2))
} catch (error) {
  await page.screenshot({ path: '/tmp/align-e2e/fail.png', fullPage: true }).catch(() => {})
  console.error('FAIL', error)
  console.log('URL', page.url())
  await context.request.delete(`${base}/api/auth/me`).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  process.exit(process.exitCode ?? 0)
}
