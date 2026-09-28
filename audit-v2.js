/**
 * Pre-install audit for one catalog plugin, measured against this host.
 *
 * Every fact the report shows comes from one of: the package manifest (npm
 * registry / GitHub raw / a local path), the official `pluginManager.inspect`
 * verdict, the curated catalog, the target's own bundle patch, the local slot
 * catalog, and this profile's files. Nothing is guessed; an unavailable source
 * becomes an explicit `info`/`warn` check instead of a silent pass.
 *
 * v2: the curated catalog comes from `catalog.js` (disk cache + one shared
 * download + a race budget), so a cold 5MB download degrades to an `info`
 * check instead of blocking the audit. v1 (`audit.js`) is the frozen copy the
 * ESM URL cache still holds for this process.
 */
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { satisfies } from './semver-lite.js'
import { raceCatalog } from './catalog.js'

/** Network, cache, and catalog defaults; every one is overridable in the profile patch. */
export const AUDIT_DEFAULTS = {
  catalogUrl: 'https://awesome-dsh-plugin.com/plugins.json',
  fetchTimeoutMs: 15000,
  cacheTtlMs: 900000,
  maxArtifactBytes: 1500000,
}

const NPM_NAME = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i
const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const BUILD_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare']
const TERMINAL_HINT = /\b(?:tui|cli|tty|terminal|shell)\b|终端|命令行/i
const CORE_TAMPER_HINT = /monkey[- ]?patch|override(?:s|d)? the (?:host|core)|patch(?:es|ed)? dsh core|改动?\s*dsh\s*本体|修改宿主|覆盖\s*dsh/i

/** url -> { at, ok, status, text, error } */
const CACHE = new Map()

/* ------------------------------------------------------------------ targets */

/**
 * Read the install spec a person typed.
 * @param raw - npm name (`dsh-find-plugin`, `@scope/pkg`, `pkg@1.2.3`), `github:owner/repo`,
 * a GitHub URL, an awesome-list entry URL, or a filesystem path.
 * @returns `{ kind, spec, name?, pin?, repo? }` or `{ kind: 'unknown', reason }`.
 */
export function parseTarget(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return { kind: 'unknown', reason: '输入为空' }
  if (text.startsWith('github:')) {
    const rest = text.slice('github:'.length).replace(/\.git$/, '')
    return REPO_SLUG.test(rest)
      ? { kind: 'git', repo: rest, spec: `github:${rest}` }
      : { kind: 'unknown', reason: `不是 owner/repo 形式：${rest}` }
  }
  if (/^https?:\/\//i.test(text)) {
    let url
    try {
      url = new URL(text)
    } catch {
      return { kind: 'unknown', reason: `URL 无法解析：${text}` }
    }
    if (/(^|\.)github\.com$/i.test(url.hostname)) {
      const segments = url.pathname.split('/').filter(Boolean)
      if (segments.length >= 2) {
        const repo = `${segments[0]}/${segments[1].replace(/\.git$/, '')}`
        return REPO_SLUG.test(repo)
          ? { kind: 'git', repo, spec: `github:${repo}` }
          : { kind: 'unknown', reason: `无法从 URL 取到仓库：${text}` }
      }
      return { kind: 'unknown', reason: `GitHub URL 缺少 owner/repo：${text}` }
    }
    return { kind: 'unknown', reason: `暂只支持 npm 包名与 GitHub 仓库，收到：${url.hostname}` }
  }
  const at = text.lastIndexOf('@')
  if (at > 0) {
    const name = text.slice(0, at)
    const pin = text.slice(at + 1)
    if (NPM_NAME.test(name) && /^[0-9A-Za-z.+-]+$/.test(pin)) return { kind: 'registry', name, pin, spec: text }
  }
  if (NPM_NAME.test(text)) return { kind: 'registry', name: text, spec: text }
  if (REPO_SLUG.test(text)) return { kind: 'git', repo: text, spec: `github:${text}` }
  if (/^[./\\]|[A-Za-z]:[\\/]/.test(text)) {
    return existsSync(text) ? { kind: 'path', path: text, spec: text } : { kind: 'unknown', reason: `路径不存在：${text}` }
  }
  return { kind: 'unknown', reason: `不是可识别的包名、owner/repo 或路径：${text}` }
}

/* ------------------------------------------------------------------- network */

async function fetchText(url, options) {
  const ttl = options.cacheTtlMs ?? AUDIT_DEFAULTS.cacheTtlMs
  if (options.fresh !== true) {
    const hit = CACHE.get(url)
    if (hit !== undefined && Date.now() - hit.at < ttl) return hit
  }
  let value
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(options.fetchTimeoutMs ?? AUDIT_DEFAULTS.fetchTimeoutMs),
      headers: { accept: '*/*', 'user-agent': 'dsh-install-review/0.1.0' },
    })
    const text = await response.text()
    value = response.ok
      ? { at: Date.now(), ok: true, status: response.status, text }
      : { at: Date.now(), ok: false, status: response.status, text: '', error: `HTTP ${response.status}` }
  } catch (error) {
    value = { at: Date.now(), ok: false, status: 0, text: '', error: String(error?.message ?? error) }
  }
  CACHE.set(url, value)
  return value
}

async function fetchJson(url, options) {
  const result = await fetchText(url, options)
  if (!result.ok) return { ...result, data: undefined }
  try {
    return { ...result, data: JSON.parse(result.text) }
  } catch (error) {
    return { ok: false, status: result.status, text: '', error: `JSON 解析失败：${String(error?.message ?? error)}` }
  }
}

/* -------------------------------------------------------------------- catalog */

/** The curated catalog through the shared loader (disk cache, one download, race budget). */
async function loadCatalog(options) {
  return raceCatalog(options, 20000)
}

function catalogEntryOf(catalog, target) {
  const repo = (target.repo ?? '').toLowerCase()
  const npm = (target.name ?? '').toLowerCase()
  if (catalog?.ok !== true) return undefined
  for (const entry of catalog.entries) {
    const fullName = String(entry.fullName ?? (entry.owner && entry.repo ? `${entry.owner}/${entry.repo}` : '')).toLowerCase()
    const url = String(entry.url ?? entry.html_url ?? '').toLowerCase()
    if (repo !== '' && (fullName === repo || (url !== '' && url.includes(`github.com/${repo}`)))) return entry
  }
  if (npm === '') return undefined
  for (const entry of catalog.entries) {
    if (String(entry.npm ?? '').toLowerCase() === npm) return entry
  }
  for (const entry of catalog.entries) {
    if (String(entry.name ?? '').toLowerCase() === npm && String(entry.npm ?? '') === '') return entry
  }
  return undefined
}

/* ------------------------------------------------------------------ manifest */

async function registryBase(ctx) {
  try {
    const registries = await ctx.pluginManager.registries()
    for (const candidate of [registries.resolved, registries.registry, ...(registries.fallbackRegistries ?? [])]) {
      if (typeof candidate === 'string' && /^https?:\/\//.test(candidate)) {
        return candidate.endsWith('/') ? candidate : `${candidate}/`
      }
    }
  } catch {
    /* fall through to the default registry */
  }
  return 'https://registry.npmjs.org/'
}

/** GitHub's default branch for a repo, or 'HEAD' when the API cannot answer. */
async function githubBranch(repo, options) {
  const fetched = await fetchJson(`https://api.github.com/repos/${repo}`, { ...options, cacheTtlMs: 3600000 })
  const branch = fetched.data?.default_branch
  return typeof branch === 'string' && branch !== '' ? branch : 'HEAD'
}

/** The target's package.json: `{ manifest, source, location }`, or `{ error }`. */
async function fetchManifest(ctx, target, options) {
  if (target.kind === 'path') {
    try {
      const manifest = JSON.parse(await readFile(join(target.path, 'package.json'), 'utf8'))
      return { manifest, source: 'path', location: join(target.path, 'package.json') }
    } catch (error) {
      return { error: `读取本地 package.json 失败：${String(error?.message ?? error)}` }
    }
  }
  if (target.kind === 'registry') {
    const base = await registryBase(ctx)
    const url = `${base}${target.name.replace('/', '%2F')}/latest`
    const fetched = await fetchJson(url, options)
    if (!fetched.ok) return { error: `读取 npm 元数据失败（${url}）：${fetched.error ?? '未知错误'}` }
    return { manifest: fetched.data, source: 'registry', location: url }
  }
  const branch = await githubBranch(target.repo, options)
  const url = `https://raw.githubusercontent.com/${target.repo}/${branch}/package.json`
  const fetched = await fetchJson(url, options)
  if (!fetched.ok) return { error: `读取 GitHub package.json 失败（${url}）：${fetched.error ?? '未知错误'}` }
  return { manifest: fetched.data, source: 'raw', location: url, branch }
}

/** Path of the built client half as the manifest declares it, when it declares one. */
function clientPathOf(manifest) {
  const entry = manifest?.exports?.['./client']
  if (typeof entry === 'string') return entry
  if (entry !== null && typeof entry === 'object') {
    for (const key of ['default', 'import', 'require']) {
      if (typeof entry[key] === 'string') return entry[key]
    }
  }
  return undefined
}

/** The target's client bundle text (scanned for slot registrations), or a skip reason. */
async function fetchClientText(ctx, target, manifest, options) {
  const clientPath = clientPathOf(manifest)
  if (clientPath === undefined) return { text: undefined, reason: 'manifest 未声明 ./client 导出（无浏览器端代码）' }
  const clean = clientPath.replace(/^\.\//, '')
  const urls = []
  if (target.kind === 'registry') {
    urls.push(`https://unpkg.com/${target.name}@${manifest.version}/${clean}`)
    urls.push(`https://cdn.jsdelivr.net/npm/${target.name}@${manifest.version}/${clean}`)
  } else if (target.kind === 'git') {
    const branch = await githubBranch(target.repo, options)
    urls.push(`https://raw.githubusercontent.com/${target.repo}/${branch}/${clean}`)
  } else if (target.kind === 'path') {
    try {
      const text = await readFile(join(target.path, clean), 'utf8')
      return { text, reason: undefined, location: join(target.path, clean) }
    } catch (error) {
      return { text: undefined, reason: `读取本地 client 失败：${String(error?.message ?? error)}` }
    }
  }
  for (const url of urls) {
    const fetched = await fetchText(url, options)
    if (fetched.ok && fetched.text !== '') {
      const limit = options.maxArtifactBytes ?? AUDIT_DEFAULTS.maxArtifactBytes
      return { text: fetched.text.slice(0, limit), truncated: fetched.text.length > limit, location: url }
    }
  }
  return { text: undefined, reason: `拉取 client 产物失败：${urls.map(u => `${u}`).join(' / ')}` }
}

/* --------------------------------------------------------------- host facts */

/** The running DSH version, read from the installation manifest the profile points at. */
export function readRuntimeVersion(ctx) {
  try {
    const anchor = ctx.profileContext?.installAnchor
    if (typeof anchor !== 'string') return undefined
    const raw = JSON.parse(readFileSync(anchor, 'utf8'))
    const candidate = typeof raw.npmName === 'string' ? raw.npmName : typeof raw.version === 'string' ? raw.version : undefined
    if (candidate === undefined) return undefined
    const cleaned = candidate.replace(/^dsh-v?/i, '')
    return cleaned === '' ? undefined : cleaned
  } catch {
    return undefined
  }
}

function profileManifestOf(ctx) {
  try {
    return JSON.parse(readFileSync(join(ctx.profileContext.dir, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
}

/** Entry ids a YAML patch *inserts* (its `- id:` rows under an `insert:` block). */
export function insertedIds(patchText) {
  const ids = []
  let insertIndent = null
  for (const raw of String(patchText ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '')
    if (/^\s*-?\s*insert\s*:\s*$/.test(line)) {
      insertIndent = line.indexOf('insert')
      continue
    }
    const item = /^(\s*)-\s+id:\s*['"]?([^'"\s#]+)['"]?\s*$/.exec(line)
    if (item !== null) {
      const indent = item[1].length
      if (insertIndent !== null && indent > insertIndent) ids.push(item[2])
      else if (insertIndent !== null) insertIndent = null
      continue
    }
    if (insertIndent !== null && line.trim() !== '' && !/^\s/.test(line)) insertIndent = null
  }
  return ids
}

async function readProfilePatchText(ctx) {
  try {
    return await readFile(ctx.profileContext.patchPath, 'utf8')
  } catch {
    return ''
  }
}

/** Local slot keys from the installed source checkout's slot catalog. */
async function readSlotKeys(options, ctx) {
  const derived = ctx.profileContext?.installAnchor
    ? join(dirname(ctx.profileContext.installAnchor), 'src', 'packages', 'extensions', 'cordis-client-runner', 'src', 'client', 'slot-catalog.ts')
    : undefined
  const path = options.slotCatalogPath ?? derived
  if (path === undefined || !existsSync(path)) return { keys: undefined, reason: `本机槽口目录不可用（${path ?? '未配置路径'}）` }
  try {
    const text = await readFile(path, 'utf8')
    const keys = new Set()
    for (const match of text.matchAll(/key:\s*'([^']+)'/g)) keys.add(match[1])
    if (keys.size === 0) return { keys: undefined, reason: `槽口目录里没有 key 条目（${path}）` }
    return { keys, path }
  } catch (error) {
    return { keys: undefined, reason: `读取槽口目录失败：${String(error?.message ?? error)}` }
  }
}

/** Slot keys a client bundle registers, read from the two registration idioms only. */
export function registeredSlotKeys(clientText) {
  const found = new Set()
  const patterns = [
    /slots\.(?:inject|register)\(\s*['"]([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)['"]/gi,
    /slots\.(?:inject|register)\(\s*\{[\s\S]{0,400}?name\s*:\s*['"]([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)['"]/gi,
  ]
  for (const pattern of patterns) {
    for (const match of String(clientText ?? '').matchAll(pattern)) found.add(match[1])
  }
  return found
}

/* ----------------------------------------------------- compatibility (host logic) */

/**
 * Mirror of `app-boot/src/plugin-compatibility.ts`: every `@deepseek-ai/dsh*`
 * peer must be satisfied by the running runtime, prereleases included.
 * @returns `{ status: 'ok' | 'bad' | 'skip', peers?, key?, exempted? }`.
 */
export function peerCheck(manifest, runtime, exemptions) {
  const peers = manifest?.peerDependencies
  if (peers === undefined || peers === null || typeof peers !== 'object') return { status: 'skip', reason: 'manifest 未声明 peerDependencies' }
  if (runtime === undefined) return { status: 'skip', reason: '运行时版本未知，无法核对' }
  const bad = {}
  for (const [name, range] of Object.entries(peers)) {
    if (typeof range !== 'string') return { status: 'skip', reason: `peerDependencies[${name}] 不是字符串` }
    if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
    const requirement = ['workspace:^', 'workspace:~', 'workspace:*'].includes(range) ? runtime : range
    if (requirement.trim() === '' || !satisfies(runtime, requirement)) bad[name] = range
  }
  if (Object.keys(bad).length === 0) return { status: 'ok' }
  const key = manifest.name !== undefined && manifest.version !== undefined ? `${manifest.name}@${manifest.version}` : undefined
  const exempted = key !== undefined && Array.isArray(exemptions?.[key]) && exemptions[key].includes(runtime)
  return { status: 'bad', peers: bad, key, exempted }
}

/* ------------------------------------------------------------------ the audit */

function check(id, status, title, detail, evidence) {
  return { id, status, title, detail, ...(evidence === undefined ? {} : { evidence }) }
}

function summarize(checks) {
  const summary = { block: 0, warn: 0, pass: 0, info: 0 }
  for (const item of checks) summary[item.status] = (summary[item.status] ?? 0) + 1
  return summary
}

/**
 * Audit one target and return the full report the panel renders.
 * @param ctx - host plugin context (needs `pluginManager` and `profileContext`).
 * @param options - profile-configured audit options.
 * @param request - `{ rawTarget, fresh? }`.
 */
export async function runAudit(ctx, options, request) {
  const opts = { ...AUDIT_DEFAULTS, ...options }
  const checks = []
  const suggestions = []
  const target = parseTarget(request.rawTarget)
  const report = {
    rawTarget: String(request.rawTarget ?? ''),
    target: { ...target },
    runtime: { version: readRuntimeVersion(ctx) ?? null, profile: ctx.profileContext?.dir ?? null },
    checks,
    suggestions,
    startedAt: new Date().toISOString(),
  }
  if (target.kind === 'unknown') {
    checks.push(check('target', 'block', '目标无法解析', target.reason))
    report.summary = summarize(checks)
    return report
  }
  if (target.kind === 'registry' && target.pin !== undefined) report.target.pin = target.pin

  // 1 · runtime identity -------------------------------------------------
  checks.push(report.runtime.version === null
    ? check('runtime', 'warn', '运行时版本未知', '读不到安装清单，peer 兼容核对会被跳过')
    : check('runtime', 'info', '本机运行时', `DSH ${report.runtime.version}，profile ${report.runtime.profile ?? '未知'}`))

  // 2 · official inspection ---------------------------------------------
  try {
    const official = await ctx.pluginManager.inspect(target.spec)
    report.official = official
    if (official.status === 'refused') {
      checks.push(check('official-inspect', official.problem === 'network' ? 'warn' : 'block',
        `官方检查拒绝：${official.problem}`, official.reason))
    } else {
      checks.push(check('official-inspect', 'pass', '官方检查通过',
        `${official.kind} 形式，名称 ${official.name ?? target.name ?? '（拉取后才知道）'}${official.version === undefined ? '' : `，版本 ${official.version}`}，registry ${official.registry ?? "pnpm 自己的配置"}`))
    }
  } catch (error) {
    report.official = { status: 'error', reason: String(error?.message ?? error) }
    checks.push(check('official-inspect', 'warn', '官方检查执行失败', String(error?.message ?? error)))
  }

  // 3 · manifest ----------------------------------------------------------
  const fetched = await fetchManifest(ctx, target, opts)
  if (fetched.error !== undefined) {
    checks.push(check('manifest', 'block', '读不到 manifest', fetched.error))
    report.summary = summarize(checks)
    return report
  }
  const manifest = fetched.manifest
  report.manifest = {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    hasBundle: manifest.dsh?.bundle !== undefined && manifest.dsh?.bundle !== null,
    bundlePatch: typeof manifest.dsh?.bundle?.patch === 'string' ? manifest.dsh.bundle.patch : undefined,
    clientPath: clientPathOf(manifest),
    peerDependencies: manifest.peerDependencies,
    engines: manifest.engines,
    scripts: manifest.scripts === undefined ? undefined : Object.fromEntries(Object.entries(manifest.scripts).filter(([key]) => BUILD_SCRIPTS.includes(key))),
    repository: typeof manifest.repository === 'object' && manifest.repository !== null ? manifest.repository.url ?? manifest.repository : manifest.repository,
    source: fetched.source,
    location: fetched.location,
  }
  checks.push(report.manifest.hasBundle
    ? check('bundle-manifest', 'pass', '是可安装的 bundle', `dsh.bundle 指向 ${report.manifest.bundlePatch ?? '(内联)'}`)
    : check('bundle-manifest', 'block', '没有 dsh.bundle', '装了也只会变成普通依赖，不会成为插件（plugin-manager 会警告 declares no dsh.bundle）'))

  // 4 · peer compatibility -------------------------------------------------
  let exemptions
  try {
    exemptions = ctx.pluginManager.listVersionExemptions().exemptions
  } catch {
    exemptions = undefined
  }
  const peers = peerCheck(manifest, report.runtime.version ?? undefined, exemptions)
  report.peerCheck = peers
  if (peers.status === 'ok') {
    checks.push(check('peer-compat', 'pass', 'peer 兼容当前 DSH', `@deepseek-ai/dsh* peer 全部满足 ${report.runtime.version}`))
  } else if (peers.status === 'skip') {
    checks.push(check('peer-compat', 'info', 'peer 核对跳过', peers.reason))
  } else if (peers.exempted === true) {
    checks.push(check('peer-compat', 'warn', 'peer 不兼容，但已有豁免', `${peers.key} 已对 DSH ${report.runtime.version} 放行`))
  } else {
    checks.push(check('peer-compat', 'block', 'peer 不兼容当前 DSH',
      `${JSON.stringify(peers.peers)} 不满足 ${report.runtime.version}；装上去可能崩溃或丢数据。要放行需你自己执行 dsh plugin allow-version ${peers.key} --dsh-version ${report.runtime.version} --accept-risk（面板不代执行）`))
    suggestions.push(`上游 peer 范围没声明当前 DSH：可向作者提 PR 扩范围，或显式豁免（风险自负）。`)
  }

  // 5 · catalog membership -------------------------------------------------
  const catalog = await loadCatalog(opts)
  report.catalog = { ok: catalog.ok, generatedAt: catalog.generatedAt, error: catalog.error, loading: catalog.loading === true, stale: catalog.stale === true, entry: undefined }
  const entry = catalogEntryOf(catalog, target)
  if (entry !== undefined) {
    const label = entry.id ?? entry.fullName ?? entry.name ?? entry.url ?? '(未命名条目)'
    const stars = entry.stars === undefined || entry.stars === null ? '?' : entry.stars
    const curated = entry.curated === undefined ? '未标注精选' : entry.curated ? '已精选' : '未精选'
    report.catalog.entry = { label, npm: entry.npm, url: entry.url, stars: entry.stars, curated: entry.curated, descriptionZh: entry.descriptionZh ?? entry.description }
    checks.push(check('catalog', entry.curated === true ? 'pass' : 'info', '在精选清单内', `${label}（${stars}★，${curated}）`))
  } else if (catalog.ok) {
    checks.push(check('catalog', 'warn', '不在精选清单内', 'dsh-market 只允许安装清单内条目；来源可信度需要你自己判断'))
    suggestions.push('不在精选清单：建议先核对仓库与作者，或提交到 awesome-dsh-plugin 清单。')
  } else {
    checks.push(check('catalog', 'info', '清单不可用', catalog.error ?? '未知原因'))
  }

  // 6 · profile state: installed, row ids, duplicate ids --------------------
  const profile = profileManifestOf(ctx)
  const dependencies = profile?.dependencies ?? {}
  const bundles = profile?.dsh?.profile?.bundles ?? []
  const packageName = manifest.name ?? target.name
  const installed = typeof packageName === 'string' && (dependencies[packageName] !== undefined || bundles.includes(packageName))
  report.installed = { name: packageName, isInstalled: installed, spec: dependencies[packageName], selected: bundles.includes(packageName) }
  checks.push(installed
    ? check('install-state', 'info', '已安装', `${packageName}：${dependencies[packageName] ?? '（仅被 bundle 选中）'}`)
    : check('install-state', 'pass', '未安装', `${packageName} 将作为新依赖写入 profile`))

  const profilePatchText = await readProfilePatchText(ctx)
  const profileInserted = insertedIds(profilePatchText)
  let targetRows = []
  try {
    const patchUrl = report.manifest.bundlePatch
    if (typeof patchUrl === 'string' && target.kind === 'path') {
      targetRows = insertedIds(await readFile(join(target.path, patchUrl.replace(/^\.\//, '')), 'utf8'))
    } else if (typeof patchUrl === 'string') {
      const clean = patchUrl.replace(/^\.\//, '')
      const base = target.kind === 'registry'
        ? `https://unpkg.com/${target.name}@${manifest.version}/`
        : `https://raw.githubusercontent.com/${target.repo}/${await githubBranch(target.repo, opts)}/`
      const patchFetch = await fetchText(`${base}${clean}`, opts)
      targetRows = patchFetch.ok ? insertedIds(patchFetch.text) : []
      if (!patchFetch.ok) checks.push(check('row-ids', 'info', '读不到目标 patch', `无法核对 loader id 冲突：${patchFetch.error ?? ''}`))
    }
  } catch (error) {
    checks.push(check('row-ids', 'info', '读取目标 patch 失败', String(error?.message ?? error)))
  }
  report.rowIds = targetRows

  let liveIds = new Set()
  try {
    const live = await ctx.pluginManager.listPlugins()
    liveIds = new Set(live.map(info => info.patchId).filter(id => typeof id === 'string'))
  } catch {
    /* the conflict check below degrades to the profile patch alone */
  }
  const clashes = targetRows.filter(id => liveIds.has(id) || profileInserted.includes(id))
  report.conflicts = clashes
  if (targetRows.length === 0) {
    checks.push(check('loader-id-conflict', 'info', '未发现 loader id', '目标 patch 没读到，或它不 insert 任何行'))
  } else if (clashes.length > 0 && !installed) {
    checks.push(check('loader-id-conflict', 'block', 'loader id 撞车',
      `${clashes.join(', ')} 已经存在；重复 id 会让 dsh web 启动即崩（duplicate loader entry id）`))
    suggestions.push('撞车的 id 需要先移除占用它的插件，或改用 id 覆盖而不是新增。')
  } else if (clashes.length > 0) {
    checks.push(check('loader-id-conflict', 'info', 'id 已存在（同名插件）', `${clashes.join(', ')} 属于已安装的同名插件，属于更新路径`))
  } else {
    checks.push(check('loader-id-conflict', 'pass', '无 id 冲突', `${targetRows.join(', ')} 在本机都未被占用`))
  }

  // 7 · slot audit ---------------------------------------------------------
  const slotCatalog = await readSlotKeys(opts, ctx)
  const client = await fetchClientText(ctx, target, manifest, opts)
  report.slot = { catalogPath: slotCatalog.path, reason: client.reason, truncated: client.truncated, registered: [], unknown: [], known: [] }
  if (client.text === undefined) {
    checks.push(check('slot-audit', 'info', '槽口核对跳过', client.reason ?? '没有 client 产物'))
  } else if (slotCatalog.keys === undefined) {
    checks.push(check('slot-audit', 'info', '槽口核对跳过', slotCatalog.reason))
  } else {
    const registered = registeredSlotKeys(client.text)
    const prefixes = new Set([...slotCatalog.keys].map(key => key.split('.')[0]))
    const known = []
    const unknown = []
    for (const key of registered) {
      if (!prefixes.has(key.split('.')[0])) continue
      if (slotCatalog.keys.has(key)) known.push(key)
      else unknown.push(key)
    }
    report.slot.registered = [...registered]
    report.slot.known = known
    report.slot.unknown = unknown
    if (unknown.length > 0) {
      checks.push(check('slot-audit', 'warn', '有槽口本机不存在（疑似）',
        `${unknown.join(', ')} 不在本机槽口目录（${slotCatalog.path}）。若它真往这些槽口注册，装上后对应界面可能什么都不显示（教训 plugin-slot-version-mismatch）；也可能是作者为更新版本的宿主准备的条件分支。`))
      suggestions.push('槽口缺失通常是宿主改名导致：可向作者反馈，或先只用它的非界面功能。')
    } else if (known.length > 0) {
      checks.push(check('slot-audit', 'pass', '槽口全部存在', `${known.join(', ')} 都在本机槽口目录里`))
    } else {
      checks.push(check('slot-audit', 'info', '未发现槽口注册', 'client 产物里没有可识别的槽口注册（可能纯 host 插件）'))
    }
  }

  // 8 · build scripts -------------------------------------------------------
  const scriptNames = Object.keys(report.manifest.scripts ?? {})
  if (scriptNames.length > 0) {
    const registryNote = target.kind === 'registry'
      ? 'npm 包通常在发包时已完成构建，本机一般不需要跑脚本；若 pnpm 仍要求放行，面板会用它报告的准确包名征求批准后自动重试一次'
      : '从源码装会真的执行这些脚本'
    checks.push(check('build-scripts', 'warn', 'manifest 声明安装期脚本', `${scriptNames.join('、')}：${registryNote}`))
  } else {
    checks.push(check('build-scripts', 'pass', '无安装期构建脚本', 'manifest 没有 prepare/preinstall/install/postinstall'))
  }
  if (scriptNames.length > 0) suggestions.push('优先选 npm 预构建版本（同一插件若有 npm 包），可完全绕开构建脚本。')

  // 9 · surface match --------------------------------------------------------
  const haystack = `${manifest.name ?? ''} ${manifest.description ?? ''} ${target.repo ?? ''}`
  checks.push(TERMINAL_HINT.test(haystack)
    ? check('surface-match', 'warn', '看起来是终端/CLI 类插件', '装进 web profile 可能不生效，甚至让 dsh web 起不来；建议按它的说明装到对应 profile')
    : check('surface-match', 'pass', '面向 web 界面', '描述里没有终端类特征'))

  // 10 · engines / core tamper -----------------------------------------------
  const engines = typeof manifest.engines?.dsh === 'string' ? manifest.engines.dsh : undefined
  if (engines === undefined) {
    checks.push(check('engines', 'info', '未声明 engines.dsh', '作者没有声明宿主要求'))
  } else if (report.runtime.version !== null && satisfies(report.runtime.version, engines)) {
    checks.push(check('engines', 'pass', '声明的宿主要求满足', `engines.dsh ${engines}`))
  } else {
    checks.push(check('engines', 'block', '声明的宿主要求不满足', `engines.dsh ${engines}，本机 ${report.runtime.version ?? '未知'}`))
  }
  checks.push(CORE_TAMPER_HINT.test(haystack)
    ? check('host-core-tamper', 'warn', '声称会改动 DSH 本体', '描述里出现改宿主核心的措辞，装前请确认你接受')
    : check('host-core-tamper', 'pass', '未见改宿主核心的措辞', '按描述与关键词扫描'))

  // 11 · installed-row config (for the config proposal) -----------------------
  if (installed) {
    try {
      const editor = ctx.get('configEditor')
      if (editor !== undefined && editor !== null) {
        const entryRow = editor.entries().find(row => row.options.name === packageName)
        if (entryRow !== undefined) {
          const current = editor.configuration().find(item => item.entry === entryRow)
          report.row = { id: entryRow.options.id, name: entryRow.options.name, config: current?.override ?? {} }
          checks.push(check('config-row', 'info', '可调整该插件的配置', `profile 行 ${entryRow.options.id}（改动经 configEditor 官方通道写入 cordis.patch.yml）`))
        }
      }
    } catch (error) {
      checks.push(check('config-row', 'info', '读取配置行失败', String(error?.message ?? error)))
    }
  }

  report.summary = summarize(checks)
  return report
}
