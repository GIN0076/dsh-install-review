/**
 * Target-patch override audit — the one check `dsh-plugin-precheck` has and
 * we did not: beyond "does this plugin insert an id that is already taken",
 * a patch may also *edit someone else's row* (`- id: x` at the top level with
 * `disabled:` / `config:` / another `name:`). Such a row is only safe when the
 * id exists in the current composition and nobody else is rewriting it too.
 *
 * Pure on purpose: the host gathers the patch text and the live composition,
 * this module parses and judges, so every rule is unit-testable offline.
 */

/**
 * Split a Loader patch document into inserted rows and override rows.
 * @param text - the YAML patch document.
 * @returns `{ insertIds, overrides }` where each override is `{ id, name?, disabled?, hasConfig }`.
 */
export function parsePatchRows(text) {
  const insertIds = []
  const overrides = []
  let insertIndent = null
  let current = null
  const finish = () => {
    if (current !== null) {
      overrides.push(current)
      current = null
    }
  }
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '')
    if (line.trim() === '') continue
    if (/^\s*-?\s*insert\s*:\s*$/.test(line)) {
      finish()
      insertIndent = line.indexOf('insert')
      continue
    }
    const item = /^(\s*)-\s+id:\s*['"]?([^'"#\s]+)['"]?\s*$/.exec(line)
    if (item !== null) {
      const indent = item[1].length
      if (insertIndent !== null && indent > insertIndent) {
        // a row inside an `insert:` block — the bundle *declares* this id
        finish()
        insertIds.push(item[2])
        continue
      }
      finish()
      insertIndent = null
      current = { id: item[2] }
      continue
    }
    if (current !== null && /^\s{2,}[A-Za-z][\w.-]*\s*:/.test(line)) {
      const name = line.match(/^\s+name:\s*['"]?([^'"#]+?)['"]?\s*$/)
      const disabled = line.match(/^\s+disabled:\s*(true|false)\s*$/)
      if (name !== null) current.name = name[1]
      if (disabled !== null) current.disabled = disabled[1] === 'true'
      if (/^\s+config\s*:/.test(line)) current.hasConfig = true
      continue
    }
    if (current !== null && !/^\s/.test(line)) finish()
  }
  finish()
  return { insertIds, overrides }
}

/**
 * Judge the override rows of a target patch against the live composition.
 * @param input - `{ overrideIds, liveIds: Set<string>, bundleOverrides: Map<id, bundleName[]>, self? }`.
 *   `self` is the target's own package name, so re-auditing an installed
 *   plugin does not report its own rows as a conflict.
 * @returns one check object, or `undefined` when the target overrides nothing.
 */
export function checkOverrides({ overrideIds, liveIds, bundleOverrides, self }) {
  const ids = [...new Set(overrideIds ?? [])]
  if (ids.length === 0) return undefined
  const others = id => (bundleOverrides.get(id) ?? []).filter(name => name !== self)
  const missing = ids.filter(id => !liveIds.has(id))
  const doubled = ids.filter(id => others(id).length > 0)
  if (missing.length > 0 || doubled.length > 0) {
    const parts = []
    if (missing.length > 0) parts.push(`补丁目标在本机不存在：${missing.join(', ')}`)
    if (doubled.length > 0) {
      parts.push(`已被其他插件改写，将双重覆盖：${doubled.map(id => `${id}（${others(id).join('、')}）`).join('；')}`)
    }
    return {
      id: 'patch-override',
      status: 'warn',
      title: '目标 patch 改写既有配置行（有风险）',
      detail: `${parts.join('；')}。这类行不参与 id 撞车检测，但改错了会让宿主配置被静默改写或整行失效。`,
    }
  }
  return {
    id: 'patch-override',
    status: 'info',
    title: '目标 patch 改写既有配置行（均有效）',
    detail: `${ids.join(', ')} 在本机存在，且没有其他插件在改写它们。`,
  }
}

const FETCH_TIMEOUT_MS = 15000

/** Fetch the target's patch document (npm tarball view / GitHub raw / local path). */
async function fetchPatchText(ctx, report, options) {
  const target = report.target ?? {}
  const patchPath = String(report.manifest?.bundlePatch ?? './cordis.patch.yml').replace(/^\.\//, '')
  if (target.kind === 'path') {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    return readFile(join(target.path, patchPath), 'utf8')
  }
  const urls = []
  if (target.kind === 'registry') {
    const name = target.name
    const version = report.manifest?.version
    urls.push(`https://unpkg.com/${name}@${version}/${patchPath}`)
    urls.push(`https://cdn.jsdelivr.net/npm/${name}@${version}/${patchPath}`)
  } else if (target.kind === 'git') {
    urls.push(`https://raw.githubusercontent.com/${target.repo}/HEAD/${patchPath}`)
    try {
      const api = await fetch(`https://api.github.com/repos/${target.repo}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (api.ok) {
        const branch = (await api.json())?.default_branch
        if (typeof branch === 'string' && branch !== '' && branch !== 'HEAD') {
          urls.push(`https://raw.githubusercontent.com/${target.repo}/${branch}/${patchPath}`)
        }
      }
    } catch {
      /* HEAD usually works; the branch retry is only a fallback */
    }
  }
  let lastError
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(options?.fetchTimeoutMs ?? FETCH_TIMEOUT_MS) })
      if (response.ok) return await response.text()
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = String(error?.message ?? error)
    }
  }
  throw new Error(`读取目标 patch 失败：${lastError ?? '无可用源'}`)
}

/**
 * Run the override audit for one audit report and append its check.
 * @param ctx - host context (needs `pluginManager`).
 * @param report - the report from `runAudit` (already carries `target` + `manifest`).
 * @param options - fetch options.
 * @returns the appended check, or `undefined` when it could not run (reported as info).
 */
export async function auditPatchOverrides(ctx, report, options) {
  if (report?.target === undefined || report?.manifest === undefined) return undefined
  let rows
  try {
    rows = parsePatchRows(await fetchPatchText(ctx, report, options))
  } catch (error) {
    const check = {
      id: 'patch-override',
      status: 'info',
      title: '补丁覆盖检查未完成',
      detail: String(error?.message ?? error),
    }
    report.checks.push(check)
    recount(report)
    return check
  }
  if (rows.overrides.length === 0) return undefined
  let liveIds = new Set()
  let bundleOverrides = new Map()
  try {
    liveIds = new Set((await ctx.pluginManager.listPlugins()).map(info => info.patchId).filter(id => typeof id === 'string'))
    for (const bundle of await ctx.pluginManager.listBundles()) {
      for (const id of bundle.overrides ?? []) {
        if (!bundleOverrides.has(id)) bundleOverrides.set(id, [])
        bundleOverrides.get(id).push(bundle.name)
      }
    }
  } catch {
    /* a manager that will not enumerate only weakens the conflict half */
  }
  const check = checkOverrides({
    overrideIds: rows.overrides.map(row => row.id),
    liveIds,
    bundleOverrides,
    self: report.installed?.name ?? report.manifest?.name,
  })
  if (check === undefined) return undefined
  report.checks.push(check)
  recount(report)
  return check
}

/** Recompute the block/warn/pass/info tally after checks were appended. */
function recount(report) {
  const summary = { block: 0, warn: 0, pass: 0, info: 0 }
  for (const item of report.checks) summary[item.status] = (summary[item.status] ?? 0) + 1
  report.summary = summary
}

export { recount as recountReport }
