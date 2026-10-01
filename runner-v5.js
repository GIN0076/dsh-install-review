/**
 * Execution half: backup → approved config changes → install → verify.
 *
 * The generator yields NDJSON lines the panel streams. Install runs through
 * `ctx.pluginManager.installBundle` (the same channel as the GUI plugin page),
 * config writes go through `ctx.configEditor.edit` (lock, validation, rollback),
 * and every profile file is copied to a timestamped backup first.
 *
 * v2: audits come from `audit-v2.js` (which reads the shared disk-cached
 * catalog); `runner.js` is the frozen generation this process may still hold.
 *
 * v3: the backup set gained `cordis.yml` — the composition root — so all four
 * profile text files a failed change could touch are recoverable (the same
 * four `dsh-plugin-precheck` keeps).
 *
 * v4: audits come from `audit-v3.js` (both `engines.dsh` placements), and the
 * request may carry `approvedBuilds: string[]` — the panel's「批准并重试」
 * button passes the exact names pnpm reported as pending; `approveBuilds`
 * refuses any name that is no longer pending (`stale-approval`), which the
 * stream surfaces as a failed install rather than a silent no-op. This closes
 * the gap where a dependency's own script (e.g. `cloudflared`'s binary fetch)
 * blocks the install while the target manifest itself declares none.
 *
 * v5 (2026-10-01): audits come from `audit-v4.js` (slot catalog resolved for a
 * packaged Desktop install), so the pre-install re-audit inside this generator
 * reports the same checks the panel showed instead of the v3 walk-up warning.
 */
import { copyFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runAudit } from './audit-v4.js'
import { buildProposals, blockingChecks } from './proposals.js'

/** The one execution in flight, if any. */
let active = null

/** Live install requests the panel may cancel. */
export function activeInstall() {
  return active === null ? null : { requestId: active.requestId, spec: active.spec, startedAt: active.startedAt }
}

/** Route a host install event into the running execution's stream. */
export function forwardInstallEvent(event) {
  if (active === null || event.requestId !== active.requestId) return
  active.queue.push(event)
}

function createQueue() {
  const items = []
  let ended = false
  let notify = null
  const wake = () => {
    const fn = notify
    notify = null
    if (fn !== null) fn()
  }
  return {
    push(line) {
      items.push(line)
      wake()
    },
    end() {
      ended = true
      wake()
    },
    /** Next queued line, or null once the queue ended and drained. */
    async take() {
      for (;;) {
        if (items.length > 0) return items.shift()
        if (ended) return null
        await new Promise(resolve => { notify = resolve })
      }
    },
    drain() {
      return items.splice(0, items.length)
    },
  }
}

/**
 * Yield queued lines while `work` settles; the last object yielded is
 * `{ settle: { v } }` on fulfillment or `{ settle: { e } }` on rejection.
 */
async function* interleave(work, queue) {
  let settled = false
  const guarded = work.then(
    value => { settled = true; return { v: value } },
    error => { settled = true; return { e: error } },
  )
  for (;;) {
    if (settled) {
      yield { settle: await guarded }
      return
    }
    const raced = await Promise.race([queue.take().then(line => ({ line })), guarded.then(result => ({ result }))])
    if (raced.result !== undefined) {
      yield { settle: raced.result }
      return
    }
    if (raced.line === null) {
      yield { settle: { e: new Error('事件流提前结束') } }
      return
    }
    yield { line: raced.line }
  }
}

async function backupProfile(ctx, options) {
  const root = options.backupDir ?? join(ctx.profileContext.dir, '_install-review-backups')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(root, stamp)
  await mkdir(dir, { recursive: true })
  const files = []
  for (const name of ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'cordis.yml']) {
    const from = join(ctx.profileContext.dir, name)
    if (existsSync(from)) {
      await copyFile(from, join(dir, name))
      files.push(name)
    }
  }
  return { dir, files }
}

function service(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

async function applyConfig(ctx, edit) {
  const base = { step: 'config', phase: edit.phase, id: edit.rowId ?? edit.moduleName }
  const editor = service(ctx, 'configEditor')
  if (editor === undefined || editor === null) return { ...base, ok: false, error: '本 profile 没有 configEditor 服务' }
  try {
    const entry = editor.entries().find(row =>
      (edit.rowId !== undefined && row.options.id === edit.rowId) || row.options.name === edit.moduleName)
    if (entry === undefined) {
      return { ...base, ok: false, error: `找不到可寻址的配置行（id=${edit.rowId ?? '-'}，name=${edit.moduleName ?? '-'}）` }
    }
    await editor.edit(entry, current => ({ ...current, ...edit.config }))
    return { ...base, id: entry.options.id, ok: true, config: edit.config }
  } catch (error) {
    return { ...base, ok: false, error: String(error?.message ?? error) }
  }
}

function profileFacts(ctx, packageName) {
  let profile
  try {
    profile = JSON.parse(readFileSync(join(ctx.profileContext.dir, 'package.json'), 'utf8'))
  } catch {
    profile = undefined
  }
  const dependencies = profile?.dependencies ?? {}
  const bundles = profile?.dsh?.profile?.bundles ?? []
  return {
    packageName,
    spec: dependencies[packageName],
    selected: bundles.includes(packageName),
    installed: dependencies[packageName] !== undefined || bundles.includes(packageName),
  }
}

async function verifyState(ctx, plan) {
  const counts = new Map()
  const loader = service(ctx, 'loader')
  if (loader !== undefined && loader !== null) {
    try {
      for (const entry of loader.entries()) {
        const id = entry?.options?.id
        if (typeof id === 'string') counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    } catch {
      /* a loader that will not enumerate only costs the duplicate report */
    }
  }
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([id]) => id)
  return { ...profileFacts(ctx, plan.packageName), duplicates }
}

function parseConfigValue(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return {}
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`配置不是合法 JSON：${String(error?.message ?? error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('配置必须是 JSON 对象')
  return parsed
}

/** The final spec plus approved changes, re-derived from the report at execution time. */
async function resolvePlan(ctx, options, request) {
  const report = await runAudit(ctx, options, { rawTarget: request.rawTarget, fresh: request.fresh === true })
  const approved = new Set(Array.isArray(request.approved) ? request.approved : [])
  const values = typeof request.values === 'object' && request.values !== null ? request.values : {}
  const proposals = buildProposals(report)
  const chosen = proposals.filter(proposal => approved.has(proposal.id))

  let spec = report.target.spec
  for (const proposal of chosen) {
    if (proposal.kind === 'source') spec = proposal.npmName
  }
  const packageName = report.manifest?.name ?? report.target.name
  if (approved.has('version')) {
    const version = String(values.version?.version ?? '').trim()
    if (!/^[0-9A-Za-z.+-]{1,64}$/.test(version)) throw new Error(`版本号不合法：${version || '（空）'}`)
    const name = chosen.some(proposal => proposal.kind === 'source')
      ? proposals.find(proposal => proposal.id === 'source')?.npmName ?? report.target.name
      : report.target.name
    if (report.target.kind === 'git' && !chosen.some(proposal => proposal.kind === 'source')) {
      throw new Error('GitHub 源暂不支持固定版本（可先改用 npm 源再固定）')
    }
    spec = `${name}@${version}`
  }

  let configEdit
  const configProposal = chosen.find(proposal => proposal.kind === 'profile-config')
  if (configProposal !== undefined) {
    configEdit = {
      phase: configProposal.phase,
      rowId: configProposal.rowId,
      moduleName: configProposal.moduleName ?? packageName,
      config: parseConfigValue(values['profile-config']?.config),
    }
  }

  return {
    report,
    spec,
    packageName,
    blocked: blockingChecks(report),
    configEdit,
    autoRetryBuilds: approved.has('allowbuild'),
  }
}

function failureLine(error) {
  const incompatible = Array.isArray(error?.incompatible) ? error.incompatible : undefined
  return {
    step: 'install-result',
    application: 'failed',
    error: { code: error?.code ?? 'operation-error', message: error?.diagnostic ?? String(error?.message ?? error), incompatible },
  }
}

function successLine(value) {
  return {
    step: 'install-result',
    application: value.application,
    stage: value.stage,
    bundle: value.bundle,
    warnings: value.warnings,
    pendingBuilds: value.pendingBuilds,
    approvedBuilds: value.approvedBuilds,
    logPath: value.packageResult?.logPath,
    failedAt: value.failedAt,
    output: String(value.packageResult?.output ?? '').slice(-4000),
  }
}

/**
 * Run one approved execution, yielding NDJSON lines.
 * @param ctx - host plugin context (`pluginManager`, `profileContext`, optional `loader`/`configEditor`).
 * @param options - profile-configured audit/backup options.
 * @param request - `{ rawTarget, approved: string[], values, fresh?, approvedBuilds?: string[] }`.
 */
export async function* runExecute(ctx, options, request) {
  if (active !== null) {
    yield { step: 'error', message: '已有执行在进行中；如需中止请先点「取消安装」' }
    return
  }
  const requestId = `install-review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const queue = createQueue()
  active = { requestId, queue, spec: undefined, startedAt: Date.now() }
  try {
    yield { step: 'start', requestId }

    let plan
    try {
      plan = await resolvePlan(ctx, options, request)
    } catch (error) {
      yield { step: 'error', message: String(error?.message ?? error) }
      return
    }
    active.spec = plan.spec
    yield {
      step: 'plan',
      spec: plan.spec,
      packageName: plan.packageName,
      summary: plan.report.summary,
      blocked: plan.blocked.map(item => ({ id: item.id, title: item.title, detail: item.detail })),
      configPhase: plan.configEdit?.phase,
      autoRetryBuilds: plan.autoRetryBuilds,
    }
    if (plan.blocked.length > 0) {
      yield { step: 'error', message: '存在阻断项，未执行任何改动', blocked: plan.blocked.map(item => item.id) }
      return
    }

    try {
      const backup = await backupProfile(ctx, options)
      yield { step: 'backup', ok: true, dir: backup.dir, files: backup.files }
    } catch (error) {
      yield { step: 'backup', ok: false, error: String(error?.message ?? error) }
      yield { step: 'error', message: '备份失败，已中止（未改动任何文件）' }
      return
    }

    if (plan.configEdit?.phase === 'before') yield await applyConfig(ctx, plan.configEdit)

    yield { step: 'install-start', spec: plan.spec, requestId }
    let installSettle
    const requestedBuilds = Array.isArray(request?.approvedBuilds)
      ? request.approvedBuilds.filter(name => typeof name === 'string' && name.trim() !== '')
      : []
    let attemptOptions = requestedBuilds.length > 0 ? { approvedBuilds: requestedBuilds } : undefined
    let retried = false
    if (requestedBuilds.length > 0) {
      yield {
        step: 'build-approval',
        pendingBuilds: requestedBuilds,
        approved: true,
        retry: false,
        message: `已按你的批准写入 allowBuilds：${requestedBuilds.join('、')}（若名字已不在 pnpm 的待决清单里会以 stale-approval 拒绝）`,
      }
    }
    for (;;) {
      const work = ctx.pluginManager.installBundle(plan.spec, { requestId, ...(attemptOptions ?? {}) })
      for await (const item of interleave(work, queue)) {
        if (item.line !== undefined) yield item.line
        else installSettle = item.settle
      }
      for (const queued of queue.drain()) yield queued

      const value = installSettle?.v
      yield value === undefined ? failureLine(installSettle?.e) : successLine(value)
      if (value?.pendingBuilds?.length > 0 && plan.autoRetryBuilds && !retried) {
        retried = true
        attemptOptions = { approvedBuilds: value.pendingBuilds }
        yield { step: 'build-approval', pendingBuilds: value.pendingBuilds, retry: true, message: `已用 pnpm 报告的包名放行构建脚本并重试：${value.pendingBuilds.join('、')}` }
        continue
      }
      if (value?.pendingBuilds?.length > 0) {
        yield { step: 'build-approval', pendingBuilds: value.pendingBuilds, retry: false, message: `构建脚本未获批准，安装中止（依赖与配置已回滚）：${value.pendingBuilds.join('、')}` }
      }
      break
    }

    const installedValue = installSettle?.v
    const succeeded = installedValue !== undefined
      && ['applied', 'restart-required', 'overridden'].includes(installedValue.application)

    if (plan.configEdit?.phase === 'after') {
      if (succeeded) yield await applyConfig(ctx, plan.configEdit)
      else yield { step: 'config', phase: 'after', id: plan.configEdit.rowId ?? plan.configEdit.moduleName, ok: false, skipped: true, error: '安装未成功，跳过配置写入' }
    }

    const verify = await verifyState(ctx, plan)
    yield { step: 'verify', ...verify, restartRequired: installedValue?.application === 'restart-required' }
    yield {
      step: 'done',
      application: installedValue?.application ?? 'failed',
      succeeded,
      spec: plan.spec,
      warnings: installedValue?.warnings,
      error: installedValue === undefined ? (installSettle?.e?.diagnostic ?? String(installSettle?.e?.message ?? installSettle?.e)) : undefined,
    }
  } catch (error) {
    yield { step: 'error', message: String(error?.message ?? error) }
  } finally {
    queue.end()
    active = null
  }
  for (;;) {
    const line = await queue.take()
    if (line === null) return
    yield line
  }
}
