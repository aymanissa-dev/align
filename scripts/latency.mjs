/**
 * Samples production latency. Login stays under the 10/15min account cap.
 * Refresh rotates, so each sample uses the newest refresh cookie only.
 *
 *   node scripts/latency.mjs https://align-hazel-kappa.vercel.app
 */
const base = (process.argv[2] ?? 'https://align-hazel-kappa.vercel.app').replace(/\/$/, '')
const email = `latency-${Date.now().toString(36)}@align.test`
const password = 'password12'

function percentile(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function report(name, samples, errors) {
  console.log(
    JSON.stringify({
      name,
      n: samples.length,
      errors,
      p50: percentile(samples, 50),
      p95: percentile(samples, 95),
    }),
  )
}

async function timed(url, init) {
  const started = Date.now()
  const response = await fetch(url, init)
  return { ms: Date.now() - started, response }
}

function cookieHeader(response, jar) {
  const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  for (const cookie of list) {
    const pair = cookie.split(';')[0]
    const name = pair.slice(0, pair.indexOf('='))
    jar.set(name, pair)
  }
  return [...jar.values()].join('; ')
}

const jar = new Map()
const register = await timed(`${base}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Latency', email, password }),
})
if (!register.response.ok) throw new Error(`register ${register.response.status}`)
let cookie = cookieHeader(register.response, jar)
const csrf = jar.get('csrf')?.slice('csrf='.length)

const loginSamples = []
let loginErrors = 0
for (let i = 0; i < 5; i += 1) {
  const result = await timed(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': decodeURIComponent(csrf ?? '') },
    body: JSON.stringify({ email, password }),
  })
  cookie = cookieHeader(result.response, jar) || cookie
  if (result.response.ok) loginSamples.push(result.ms)
  else loginErrors += 1
}
report('login', loginSamples, loginErrors)

const created = await fetch(`${base}/api/projects`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': decodeURIComponent(csrf ?? '') },
  body: JSON.stringify({ name: 'Latency' }),
})
cookie = cookieHeader(created, jar) || cookie
const project = await created.json()

async function sampleGet(name, path, count) {
  const samples = []
  let errors = 0
  for (let i = 0; i < count; i += 1) {
    const result = await timed(`${base}${path}`, { headers: { Cookie: cookie } })
    if (result.response.ok) samples.push(result.ms)
    else errors += 1
  }
  report(name, samples, errors)
}

await sampleGet('list tasks', `/api/projects/${project.id}/tasks`, 15)
await sampleGet('today', '/api/today?date=2026-10-20', 15)

const refreshSamples = []
let refreshErrors = 0
for (let i = 0; i < 4; i += 1) {
  const result = await timed(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: cookie, 'X-CSRF-Token': decodeURIComponent(csrf ?? '') },
  })
  cookie = cookieHeader(result.response, jar) || cookie
  if (result.response.ok) refreshSamples.push(result.ms)
  else refreshErrors += 1
}
report('refresh', refreshSamples, refreshErrors)

await fetch(`${base}/api/auth/me`, { method: 'DELETE', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf ?? '') }, body: '{}' })
