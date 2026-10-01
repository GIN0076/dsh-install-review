/**
 * 审查 → 方案审批 → 改动 → 安装（Host half，v10）。
 *
 * Five same-origin POST routes on `webServer`:
 *   POST /dsh-install-review/audit    { target, fresh? }        → { report, proposals }
 *   POST /dsh-install-review/execute  { rawTarget, approved[], values, approvedBuilds? }
 *                                     → NDJSON lines
 *   POST /dsh-install-review/cancel   {}                        → cancellation outcome
 *   POST /dsh-install-review/status   {}                        → the execution in flight
 *   POST /dsh-install-review/catalog  { q, category, sort, offset, limit, refresh? }
 *                                     → { state: 'loading' | 'ready', entries[], categories[] }
 *
 * Install goes through `ctx.pluginManager.installBundle`, config writes through
 * `ctx.configEditor.edit`; this plugin never edits third-party plugin code and
 * never writes the profile without taking a timestamped backup first.
 *
 * v2 added the catalog browse route; v3 added the Chinese projection and the
 * capability/red-line enrichment; v4 (from the dsh-plugin-precheck / dsh-mall
 * evaluation) added the walk-up slot-catalog derivation, the 「无法确认 ≠ 放行」
 * promotion, `patch-audit.js` override checks, and the `cordis.yml` backup.
 * **v5** (from auditing `@linxin666/dsh-remote-web-ui`):
 *   - `engines.dsh` is read from **both** placements (`engines.dsh` and the
 *     bundle face `dsh.engines.dsh` — that package declares only the latter);
 *   - the execute route forwards `approvedBuilds` so the panel's「批准并重试」
 *     button can approve a *dependency's* blocked script (`cloudflared`'s
 *     binary fetch) through the official `approveBuilds` path — the target's
 *     own manifest can be script-free and still be blocked.
 * **v6 (2026-09-29)**: the backup default was a machine-specific absolute
 * path — a local-layout leak in a public repo, and it resolved nowhere on
 * any other machine. It now derives from the running profile
 * (`<profile>/install-review-backup` via `patchPath`); the row's `backupDir`
 * still overrides. The archived generations keep a relative placeholder.
 * **v7 (2026-10-01, packaged Desktop 0.2.0-rc.2)**: the install anchor now
 * lives *inside* `app.asar` and the installation ships no `src/…` tree, so the
 * v4 walk-up found no `slot-catalog.ts` and the slot check degraded to a
 * warning on every audit. Catalog discovery moved into `audit-v4.js`
 * (`slotCatalogCandidates`, compiled-catalog aware); this half just asks it for
 * the first existing candidate.
 * **v8 (2026-10-01, user report「清单加载失败 / 同源校验失败」on the Desktop
 * build)**: the Desktop window's origin is `dsh-app://app` and its protocol
 * handler strips `origin`, `sec-fetch-site` and `cookie` before forwarding to
 * the Host, then injects the Host-issued session cookie — so the v1–v7 Origin
 * equality could never pass there and *every* panel call was 403. The fence now
 * asks the composition's `connection.requestRejection` first (the channel
 * `@deepseek-ai/dsh-host-open-in-app` uses), keeps the local Origin check only
 * as the fallback, returns 401/403 with the offending header summary, and the
 * panel shows the service's `hint`. v7 was an unreleased intermediate: it was
 * retired the same day, before v1.1.0 shipped.
 * **v9 (2026-10-01, user decision 「要给一个『我接受风险，照样装』的按钮」)**:
 * generation bump for the blocked-report remedies — `audit-v5.js` now reports
 * `report.exemption` and marks how each block may be crossed, `proposals-v2.js`
 * offers the exemption grant/revoke buttons, and `runner-v6.js` validates the
 * panel's `acknowledged: string[]`, grants the exemption **before** installing
 * and keeps a standalone revoke run. This half only wires the new modules; the
 * execute payload passes through unchanged, `acknowledged` included.
 * **v10 (2026-10-01, user decision 「这些都做吧」)**: generation bump for the
 * capability proposals — `audit-v6.js` reports registry candidates, the config
 * template, live activation and update availability; `proposals-v3.js` adds the
 * `registry` / `rows` / `upgrade` buttons; `runner-v7.js` passes the chosen
 * registry into `installBundle`, enables declared-but-off rows and verifies
 * activation after the install. This half only wires the new modules.
 * Superseded generations stay on disk for history — the row's `name` is what
 * selects the live file.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runAudit, AUDIT_DEFAULTS, parseTarget, slotCatalogCandidates } from './audit-v6.js'
import { ensureCatalog, catalogBrief } from './catalog.js'
import { queryCatalogView, augmentAudit } from './catalog-view.js'
import { auditPatchOverrides, recountReport } from './patch-audit.js'
import { buildProposals } from './proposals-v3.js'
import { runExecute, activeInstall, forwardInstallEvent } from './runner-v7.js'

/** Required host services; without them the plugin stays inactive instead of throwing. */
export const inject = ['webServer', 'pluginManager', 'profileContext']

/**
 * Backup directory: row config `backupDir` wins; otherwise
 * `<profile>/install-review-backup` — derived from the patch path so the
 * default works on any machine (the pre-release default hard-coded a
 * workspace-only absolute path: a local-layout leak, and it could not
 * resolve elsewhere at all).
 * @param patchPath - `ctx.profileContext.patchPath` of the running profile.
 * @returns a profile-relative directory, or undefined when unknown.
 */
export function defaultBackupDir(patchPath) {
  return typeof patchPath === 'string' && patchPath !== '' ? join(dirname(patchPath), 'install-review-backup') : undefined
}
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
function optionsOf(config, patchPath) {
  const raw = typeof config === 'object' && config !== null && !Array.isArray(config) ? config : {}
  const text = key => (typeof raw[key] === 'string' && raw[key].trim() !== '' ? raw[key] : undefined)
  const number = key => (typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] > 0 ? raw[key] : undefined)
  return {
    ...AUDIT_DEFAULTS,
    catalogUrl: text('catalogUrl') ?? AUDIT_DEFAULTS.catalogUrl,
    slotCatalogPath: text('slotCatalogPath'),
    backupDir: text('backupDir') ?? defaultBackupDir(patchPath),
    fetchTimeoutMs: number('fetchTimeoutMs') ?? AUDIT_DEFAULTS.fetchTimeoutMs,
    maxArtifactBytes: number('maxArtifactBytes') ?? AUDIT_DEFAULTS.maxArtifactBytes,
    cacheTtlMs: number('cacheTtlMs') ?? AUDIT_DEFAULTS.cacheTtlMs,
    catalogTimeoutMs: number('catalogTimeoutMs') ?? 120000,
    diskTtlMs: number('diskTtlMs') ?? 86400000,
  }
}

/**
 * The v1–v7 local fence, kept as the fallback for a composition without a
 * `connection` service: the Origin host (or `sec-fetch-site`) must be ours.
 * @param req - the incoming HTTP request.
 * @returns undefined when the route may answer, otherwise the rejection to send.
 */
function localOriginRejection(req) {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return { status: 403, error: '同源校验失败：缺少 Host 头' }
  const site = req.headers['sec-fetch-site']
  if (site === 'cross-site') return { status: 403, error: '同源校验失败：跨站请求' }
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    try {
      if (new URL(origin).host === host) return undefined
    } catch {
      /* an unparsable Origin is a rejection, not a pass */
    }
    return { status: 403, error: '同源校验失败：Origin 与本机 Host 不一致' }
  }
  return site === 'same-origin' ? undefined : { status: 403, error: '同源校验失败：缺少 Origin 与 same-origin 标记' }
}

/**
 * Route fence: one decision, taken by the composition when it can.
 *
 * A plain web profile is a browser talking to the Host directly, so comparing
 * the Origin host with the request Host (v1–v7) is enough. The packaged
 * **Desktop** app is a browser of a different shape: the window's origin is
 * `dsh-app://app` and its protocol handler *deletes* `origin`,
 * `sec-fetch-site` and `cookie` before forwarding to the Host, then injects the
 * Host-issued session cookie (`resources/app.asar/lib/main.js`,
 * `forwardWebRequest`). Origin equality can therefore never pass there — every
 * panel call answered 403「同源校验失败」on Desktop 0.2.0-rc.2.
 *
 * So the primary decision moved to the composition's `connection` service
 * (`requestRejection`) — the same channel
 * `@deepseek-ai/dsh-host-open-in-app` uses for its own routes: loopback/trusted
 * Host fence, `sec-fetch-site: cross-site` rejection, Origin equality when an
 * Origin is attached, then browser cookie authentication (401 without it). The
 * local check above stays only as the fallback when that service is absent.
 * @param ctx - host plugin context.
 * @param req - the incoming HTTP request.
 * @returns undefined when the route may answer, otherwise `{ status, error, hint? }`.
 */
function routeRejection(ctx, req) {
  const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
  if (connection !== undefined && typeof connection.requestRejection === 'function') {
    try {
      const rejection = connection.requestRejection({ headers: req.headers })
      if (rejection === undefined) return undefined
      return rejection === 401
        ? { status: 401, error: '未认证：缺少 DSH 浏览器会话 cookie', hint: '在浏览器/桌面版里打开界面后重试；命令行探测需要带 dsh-auth-* cookie。' }
        : { status: 403, error: '同源/主机校验失败', hint: 'connection.requestRejection 判定该请求的主机或 Origin 不属于本机 Host。' }
    } catch {
      /* an unusable service falls back to the local fence below */
    }
  }
  return localOriginRejection(req)
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

/**
 * Guards shared by every route; true when the response has already been answered.
 * @param req - the incoming HTTP request.
 * @param res - the response that owns the refusal.
 * @param ctx - host plugin context (its `connection` service decides trust).
 * @returns true when the route must stop.
 */
function refuse(req, res, ctx) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: '只接受 POST' })
    return true
  }
  const rejection = routeRejection(ctx, req)
  if (rejection !== undefined) {
    sendJson(res, rejection.status, {
      error: rejection.error,
      ...rejection.hint === undefined ? {} : { hint: rejection.hint },
      seen: {
        host: req.headers.host ?? '(无)',
        origin: req.headers.origin ?? '(无)',
        site: req.headers['sec-fetch-site'] ?? '(无)',
        cookie: typeof req.headers.cookie === 'string' && req.headers.cookie !== '' ? '有' : '无',
      },
    })
    return true
  }
  return false
}

/**
 * Locate the installed slot catalog from the candidates `audit-v4.js` knows.
 *
 * The candidate list is ordered (packaged compiled catalog → profile
 * `node_modules` → source checkout above the anchor), so the first existing
 * entry is the best available one. In a source install the anchor's own
 * `src/apps/cli/package.json` layout is covered by that list's walk-up, which
 * is why the v4-era special case lives there now instead of here.
 * @param ctx - host context carrying `profileContext.installAnchor`.
 * @returns the absolute catalog path, or undefined when no candidate exists.
 */
function deriveSlotCatalog(ctx) {
  return slotCatalogCandidates({}, ctx).find(candidate => existsSync(candidate))
}

/**
 * 「无法确认 ≠ 放行」: a slot audit that could not run becomes a warning —
 * only "the manifest declares no client half" stays informational, because
 * that one is a fact, not a gap.
 * @param report - the assembled audit report, mutated in place.
 */
function promoteUnverifiedSlotCheck(report) {
  const check = report.checks.find(item => item.id === 'slot-audit' && item.status === 'info')
  if (check === undefined || /未声明 \.\/client/.test(check.detail ?? '')) return
  check.status = 'warn'
  check.title = '槽口核对未能完成'
  check.detail = `${check.detail}。按「无法确认 ≠ 放行」标为警告：装上后若它注册的槽口本机没有，对应界面会白屏（核对口径：slot-catalog.ts），修好路径或网络后可重试。`
  recountReport(report)
}

/**
 * Mount the review routes and forward host install events into the running execution.
 * @param ctx - host plugin context.
 * @param config - the row's config from the profile patch.
 * @returns nothing; cleanup runs through `ctx.effect`.
 */
export function apply(ctx, config) {
  const options = optionsOf(config, ctx.profileContext?.patchPath)
  if (options.slotCatalogPath === undefined) options.slotCatalogPath = deriveSlotCatalog(ctx)

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
    if (refuse(req, res, ctx)) return
    let payload
    try {
      payload = await readBody(req)
    } catch (error) {
      sendJson(res, 400, { error: String(error?.message ?? error) })
      return
    }
    try {
      const report = await runAudit(ctx, options, { rawTarget: payload.target, fresh: payload.fresh === true })
      try {
        augmentAudit(report, await ensureCatalog(options), parseTarget(payload.target))
      } catch {
        /* capability enrichment is best-effort: the 11 host checks stand alone */
      }
      try {
        await auditPatchOverrides(ctx, report, options)
      } catch {
        /* the override audit appends its own info check when it cannot run */
      }
      promoteUnverifiedSlotCheck(report)
      sendJson(res, 200, { report, proposals: buildProposals(report) })
    } catch (error) {
      sendJson(res, 500, { error: String(error?.message ?? error) })
    }
  }

  const execute = async (req, res) => {
    if (refuse(req, res, ctx)) return
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
    if (refuse(req, res, ctx)) return
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
    if (refuse(req, res, ctx)) return
    sendJson(res, 200, { active: activeInstall() })
  }

  /**
   * Browse the curated catalog without shipping 5MB to the browser: search,
   * category, sort and paging all run here; the answer is one page of rows.
   * The first load downloads the catalog in the background (20-80s) and this
   * route answers `state: 'loading'` until it lands; later loads hit the disk cache.
   */
  const catalog = async (req, res) => {
    if (refuse(req, res, ctx)) return
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
        sendJson(res, 200, { state: 'ready', ...brief, ...queryCatalogView(loaded, payload) })
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
