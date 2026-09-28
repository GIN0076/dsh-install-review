/**
 * 审查 → 方案审批 → 改动 → 安装（Host half，v2）。
 *
 * Five same-origin POST routes on `webServer`:
 *   POST /dsh-install-review/audit    { target, fresh? }        → { report, proposals }
 *   POST /dsh-install-review/execute  { rawTarget, approved[], values } → NDJSON lines
 *   POST /dsh-install-review/cancel   {}                        → cancellation outcome
 *   POST /dsh-install-review/status   {}                        → the execution in flight
 *   POST /dsh-install-review/catalog  { q, category, sort, offset, limit, refresh? }
 *                                     → { state: 'loading' | 'ready', entries[], categories[] }
 *
 * Install goes through `ctx.pluginManager.installBundle`, config writes through
 * `ctx.configEditor.edit`; this plugin never edits third-party plugin code and
 * never writes the profile without taking a timestamped backup first.
 *
 * v2 adds the catalog browse route and switches the audit to `catalog.js`
 * (disk cache + shared download). `host-v1.js` is the frozen copy the ESM URL
 * cache still holds for this process — the row's `name` is what selects this file.
 */
import { runAudit, AUDIT_DEFAULTS } from './audit-v2.js'
import { ensureCatalog, catalogBrief, queryCatalog } from './catalog.js'
import { buildProposals } from './proposals.js'
import { runExecute, activeInstall, forwardInstallEvent } from './runner-v2.js'

/** Required host services; without them the plugin stays inactive instead of throwing. */
export const inject = ['webServer', 'pluginManager', 'profileContext']

const DEFAULT_BACKUP_DIR = '.install-review-backup' /* archived generation; machine path scrubbed for the public release */
const BODY_LIMIT = 64 * 1024

/*
 * No `export const Config`: cordis resolves a declared Config through the
 * Standard Schema protocol (`runtime.Config["~standard"].validate`), and this
 * dependency-free bundle cannot build a schemastery schema. The knobs below are
 * instead read defensively from the row's `config` (any wrong type simply keeps
 * its default), documented here and in the row comment:
 *   catalogUrl, slotCatalogPath, backupDir, fetchTimeoutMs, maxArtifactBytes, cacheTtlMs
 */

/** Merge the row's config over the defaults, keeping only well-typed values. */
function optionsOf(config) {
  const raw = typeof config === 'object' && config !== null && !Array.isArray(config) ? config : {}
  const text = key => (typeof raw[key] === 'string' && raw[key].trim() !== '' ? raw[key] : undefined)
  const number = key => (typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] > 0 ? raw[key] : undefined)
  return {
    ...AUDIT_DEFAULTS,
    catalogUrl: text('catalogUrl') ?? AUDIT_DEFAULTS.catalogUrl,
    slotCatalogPath: text('slotCatalogPath'),
    backupDir: text('backupDir') ?? DEFAULT_BACKUP_DIR,
    fetchTimeoutMs: number('fetchTimeoutMs') ?? AUDIT_DEFAULTS.fetchTimeoutMs,
    maxArtifactBytes: number('maxArtifactBytes') ?? AUDIT_DEFAULTS.maxArtifactBytes,
    cacheTtlMs: number('cacheTtlMs') ?? AUDIT_DEFAULTS.cacheTtlMs,
    catalogTimeoutMs: number('catalogTimeoutMs') ?? 120000,
    diskTtlMs: number('diskTtlMs') ?? 86400000,
  }
}

/** Same-origin fence: the Origin host (or sec-fetch-site) must match this request. */
function sameOrigin(req) {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  const site = req.headers['sec-fetch-site']
  return typeof site === 'string' && site === 'same-origin'
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('请求体超过 64KB'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/** Guards shared by every route; true when the response has already been answered. */
function refuse(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: '只接受 POST' })
    return true
  }
  if (!sameOrigin(req)) {
    sendJson(res, 403, { error: '同源校验失败' })
    return true
  }
  return false
}

/**
 * Mount the review routes and forward host install events into the running execution.
 * @param ctx - host plugin context.
 * @param config - the row's config from the profile patch.
 * @returns nothing; cleanup runs through `ctx.effect`.
 */
export function apply(ctx, config) {
  const options = optionsOf(config)

  ctx.on('plugin-manager/install-log', chunk => forwardInstallEvent({
    step: 'log',
    requestId: chunk.requestId,
    jobId: chunk.jobId,
    stream: chunk.stream,
    text: chunk.text,
    exitCode: chunk.exitCode,
  }))
  ctx.on('plugin-manager/install-state', progress => forwardInstallEvent({
    step: 'install-state',
    requestId: progress.requestId,
    phase: progress.phase,
    attempt: progress.attempt,
  }))

  const audit = async (req, res) => {
    if (refuse(req, res)) return
    let payload
    try {
      payload = await readBody(req)
    } catch (error) {
      sendJson(res, 400, { error: String(error?.message ?? error) })
      return
    }
    try {
      const report = await runAudit(ctx, options, { rawTarget: payload.target, fresh: payload.fresh === true })
      sendJson(res, 200, { report, proposals: buildProposals(report) })
    } catch (error) {
      sendJson(res, 500, { error: String(error?.message ?? error) })
    }
  }

  const execute = async (req, res) => {
    if (refuse(req, res)) return
    let payload
    try {
      payload = await readBody(req)
    } catch (error) {
      sendJson(res, 400, { error: String(error?.message ?? error) })
      return
    }
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    })
    let closed = false
    res.on('close', () => { closed = true })
    try {
      for await (const line of runExecute(ctx, options, payload)) {
        if (closed || res.writableEnded) break
        res.write(`${JSON.stringify(line)}\n`)
      }
    } catch (error) {
      if (!closed && !res.writableEnded) res.write(`${JSON.stringify({ step: 'error', message: String(error?.message ?? error) })}\n`)
    }
    if (!res.writableEnded) res.end()
  }

  const cancel = async (req, res) => {
    if (refuse(req, res)) return
    const current = activeInstall()
    if (current === null) {
      sendJson(res, 200, { status: 'not-running' })
      return
    }
    try {
      const outcome = await ctx.pluginManager.cancelInstall(current.requestId)
      sendJson(res, 200, outcome)
    } catch (error) {
      sendJson(res, 500, { error: String(error?.message ?? error) })
    }
  }

  const status = async (req, res) => {
    if (refuse(req, res)) return
    sendJson(res, 200, { active: activeInstall() })
  }

  /**
   * Browse the curated catalog without shipping 5MB to the browser: search,
   * category, sort and paging all run here; the answer is one page of rows.
   * The first load downloads the catalog in the background (20-80s) and this
   * route answers `state: 'loading'` until it lands; later loads hit the disk cache.
   */
  const catalog = async (req, res) => {
    if (refuse(req, res)) return
    let payload
    try {
      payload = await readBody(req)
    } catch (error) {
      sendJson(res, 400, { error: String(error?.message ?? error) })
      return
    }
    try {
      if (payload.refresh === true) {
        void ensureCatalog(options, { fresh: true }).catch(() => {})
        sendJson(res, 200, { state: 'loading', refreshing: true })
        return
      }
      const brief = await catalogBrief()
      if (brief.state === 'ready') {
        const loaded = await ensureCatalog(options)
        sendJson(res, 200, { state: 'ready', ...brief, ...queryCatalog(loaded, payload) })
        return
      }
      if (brief.state === 'loading') {
        sendJson(res, 200, { state: 'loading', error: brief.error })
        return
      }
      if (brief.state === 'error') {
        sendJson(res, 200, { state: 'error', error: brief.error })
        return
      }
      void ensureCatalog(options).catch(() => {})
      sendJson(res, 200, { state: 'loading' })
    } catch (error) {
      sendJson(res, 500, { error: String(error?.message ?? error) })
    }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({ kind: 'exact', path: '/dsh-install-review/audit', handler: audit }),
      ctx.webServer.register({ kind: 'exact', path: '/dsh-install-review/execute', handler: execute }),
      ctx.webServer.register({ kind: 'exact', path: '/dsh-install-review/cancel', handler: cancel }),
      ctx.webServer.register({ kind: 'exact', path: '/dsh-install-review/status', handler: status }),
      ctx.webServer.register({ kind: 'exact', path: '/dsh-install-review/catalog', handler: catalog }),
    ]
    return () => {
      for (const dispose of disposers) {
        try {
          dispose?.()
        } catch {
          /* a disposed route is not worth failing the teardown for */
        }
      }
    }
  }, 'install-review: routes')
}
