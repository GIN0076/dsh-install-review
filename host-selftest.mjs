/**
 * Exercise the Host entry: mount routes, then drive the audit route through
 * fake req/res objects — fence included, with and without the composition's
 * `connection` service (the Desktop shell forwards without Origin/Sec-Fetch-Site).
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { apply, inject } from './index.js'

const scratch = join(process.cwd(), '_selftest-host')
await rm(scratch, { recursive: true, force: true })
await mkdir(scratch, { recursive: true })
await writeFile(join(scratch, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
}, null, 2))
await writeFile(join(scratch, 'cordis.patch.yml'), '- id: llm-pi-ai\n  name: "@deepseek-ai/dsh-llm-pi-ai"\n  config: {}\n')

const routes = []
const listeners = []
const cleanups = []
/**
 * Faithful mirror of the Host `connection.requestRejection` decision
 * (`@deepseek-ai/dsh-client-connection`): loopback Host fence, cross-site
 * rejection, Origin equality when present, then the browser cookie.
 */
const connectionCalls = []
const connection = {
  requestRejection(request) {
    connectionCalls.push(request.headers)
    const host = request.headers.host
    if (typeof host !== 'string' || host === '') return 403
    if (request.headers['sec-fetch-site'] === 'cross-site') return 403
    const origin = request.headers.origin
    if (origin !== undefined && new URL(origin).host !== host) return 403
    return typeof request.headers.cookie === 'string' && request.headers.cookie !== '' ? undefined : 401
  },
}
const ctx = {
  profileContext: {
    dir: scratch,
    patchPath: join(scratch, 'cordis.patch.yml'),
    installAnchor: 'E:\\DSH-OneClick\\install-manifest.json',
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => { const at = routes.indexOf(route); if (at >= 0) routes.splice(at, 1) }
    },
  },
  pluginManager: {
    registries: async () => ({ registry: 'https://registry.npmjs.org/', fallbackRegistries: [], resolved: 'https://registry.npmjs.org/' }),
    inspect: async spec => ({ status: 'accepted', kind: 'registry', name: spec, bundle: true, registry: 'https://registry.npmjs.org/' }),
    listVersionExemptions: () => ({ exemptions: {}, warnings: [] }),
    listPlugins: async () => [],
    cancelInstall: async () => ({ status: 'not-running' }),
  },
  on(event, callback) {
    listeners.push({ event, callback })
  },
  effect(fn, label) {
    const dispose = fn()
    cleanups.push({ label, dispose })
    return () => {}
  },
  get: name => (name === 'connection' ? connection : undefined),
}

let failures = 0
function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  if (!ok) {
    failures += 1
    console.log(`FAIL ${label}\n  actual ${JSON.stringify(actual)}\n  wanted ${JSON.stringify(wanted)}`)
  } else {
    console.log(`ok   ${label}`)
  }
}

function makeReq(method, headers, body) {
  const handlers = {}
  const req = {
    method,
    headers,
    on(event, callback) {
      (handlers[event] ??= []).push(callback)
    },
    destroy() {},
  }
  queueMicrotask(() => {
    if (body !== undefined) {
      for (const callback of handlers.data ?? []) callback(Buffer.from(body))
    }
    for (const callback of handlers.end ?? []) callback()
  })
  return req
}

function makeRes() {
  return {
    statusCode: null,
    headers: null,
    chunks: [],
    writableEnded: false,
    on() {},
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers
    },
    write(chunk) {
      this.chunks.push(String(chunk))
    },
    end(chunk) {
      if (chunk !== undefined) this.chunks.push(String(chunk))
      this.writableEnded = true
    },
    text() {
      return this.chunks.join('')
    },
  }
}

async function invoke(route, method, headers, body) {
  const res = makeRes()
  await route.handler(makeReq(method, headers, body), res)
  return res
}

/* mount */
apply(ctx, {
  backupDir: join(process.cwd(), '_selftest-host-backup'),
  catalogUrl: 'http://127.0.0.1:9/no-such-catalog.json',
  catalogTimeoutMs: 1500,
})
expect('inject list', inject, ['webServer', 'pluginManager', 'profileContext'])
expect('routes registered', routes.map(route => route.path).sort(), [
  '/dsh-install-review/audit',
  '/dsh-install-review/cancel',
  '/dsh-install-review/catalog',
  '/dsh-install-review/execute',
  '/dsh-install-review/status',
])
expect('route kinds', [...new Set(routes.map(route => route.kind))], ['exact'])
expect('install events forwarded', listeners.map(entry => entry.event), ['plugin-manager/install-log', 'plugin-manager/install-state'])
expect('effect labels', cleanups.map(entry => entry.label), ['install-review: routes'])

const byPath = Object.fromEntries(routes.map(route => [route.path, route]))
const origin = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', cookie: 'dsh-auth-127.0.0.1:3080=stub', 'content-type': 'application/json' }

/* fences */
const wrongOrigin = await invoke(byPath['/dsh-install-review/audit'], 'POST', { host: '127.0.0.1:3080', origin: 'http://evil.test', cookie: origin.cookie }, '{"target":"x"}')
expect('wrong origin rejected', wrongOrigin.statusCode, 403)
const crossSite = await invoke(byPath['/dsh-install-review/status'], 'POST', { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site', cookie: origin.cookie }, '{}')
expect('cross-site marker rejected', crossSite.statusCode, 403)
const wrongMethod = await invoke(byPath['/dsh-install-review/status'], 'GET', origin)
expect('GET rejected', wrongMethod.statusCode, 405)

/* the Desktop shell forwards WITHOUT origin / sec-fetch-site and injects the Host cookie
   (resources/app.asar/lib/main.js forwardWebRequest) — the composition must admit it */
const desktop = await invoke(byPath['/dsh-install-review/status'], 'POST', { host: '127.0.0.1:19387', cookie: origin.cookie, 'content-type': 'application/json' }, '{}')
expect('desktop-shaped request admitted', [desktop.statusCode, JSON.parse(desktop.text()).active], [200, null])
expect('connection service consulted', connectionCalls.length > 0, true)
const anonymous = await invoke(byPath['/dsh-install-review/status'], 'POST', { host: '127.0.0.1:19387', 'content-type': 'application/json' }, '{}')
expect('anonymous desktop request 401', anonymous.statusCode, 401)
const refusal = JSON.parse(anonymous.text())
expect('refusal carries a hint', typeof refusal.hint, 'string')
expect('refusal carries the header summary', [refusal.seen.host, refusal.seen.origin, refusal.seen.site, refusal.seen.cookie], ['127.0.0.1:19387', '(无)', '(无)', '无'])

/* fallback: a composition without `connection` keeps the local v1–v7 fence */
const serviceBackup = ctx.get
ctx.get = () => undefined
const fallbackHappy = await invoke(byPath['/dsh-install-review/status'], 'POST', origin, '{}')
expect('fallback accepts matching origin', fallbackHappy.statusCode, 200)
const fallbackBare = await invoke(byPath['/dsh-install-review/status'], 'POST', { host: '127.0.0.1:3080', 'content-type': 'application/json' }, '{}')
expect('fallback rejects a request with no browser markers', fallbackBare.statusCode, 403)
ctx.get = serviceBackup

/* status */
const status = await invoke(byPath['/dsh-install-review/status'], 'POST', origin, '{}')
expect('status ok', [status.statusCode, JSON.parse(status.text()).active], [200, null])

/* audit round trip */
const audit = await invoke(byPath['/dsh-install-review/audit'], 'POST', origin, JSON.stringify({ target: 'dsh-find-plugin' }))
const payload = JSON.parse(audit.text())
expect('audit status', audit.statusCode, 200)
expect('audit payload keys', Object.keys(payload).sort(), ['proposals', 'report'])
expect('audit target parsed', payload.report.target?.name, 'dsh-find-plugin')
expect('audit summary present', typeof payload.report.summary?.block, 'number')
expect('audit has proposals', Array.isArray(payload.proposals), true)

/* catalog route: answers instantly in one of three states, never hangs */
const catalogFirst = await invoke(byPath['/dsh-install-review/catalog'], 'POST', origin, JSON.stringify({ q: '' }))
const catalogFirstPayload = JSON.parse(catalogFirst.text())
expect('catalog status', catalogFirst.statusCode, 200)
expect('catalog state known', ['loading', 'ready', 'error'].includes(catalogFirstPayload.state), true)
if (catalogFirstPayload.state === 'ready') {
  expect('catalog ready shape', [typeof catalogFirstPayload.total, Array.isArray(catalogFirstPayload.entries)], ['number', true])
}
await new Promise(resolve => setTimeout(resolve, 400))
const catalogSecond = await invoke(byPath['/dsh-install-review/catalog'], 'POST', origin, JSON.stringify({ q: '', refresh: false }))
expect('catalog second call status', catalogSecond.statusCode, 200)

/* fences apply to the catalog route too */
const catalogWrongOrigin = await invoke(byPath['/dsh-install-review/catalog'], 'POST', { host: '127.0.0.1:3080', origin: 'http://evil.test', cookie: origin.cookie }, '{}')
expect('catalog wrong origin rejected', catalogWrongOrigin.statusCode, 403)

/* teardown removes routes */
for (const entry of cleanups) entry.dispose()
expect('routes removed on dispose', routes.length, 0)

await rm(scratch, { recursive: true, force: true })
await rm(join(process.cwd(), '_selftest-host-backup'), { recursive: true, force: true })
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
if (failures > 0) process.exitCode = 1
