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
 *
 * v3: `engines.dsh` is read from **both** placements publishers use — the
 * top-level `engines: { dsh }` and the bundle face `dsh: { engines: { dsh } }`.
 * v2 only read the top level, so `@linxin666/dsh-remote-web-ui@0.4.3` (which
 * declares `dsh.engines.dsh: ">=0.1.7-rc.2"`) reported 「未声明宿主要求」.
 *
 * v4 (2026-10-01, packaged Desktop 0.2.0-rc.2): the slot catalog no longer
 * exists as `src/…/slot-catalog.ts` — a packaged install ships no sources, so
 * the walk-up derivation found nothing and every audit warned 「槽口核对未能
 * 完成」. The generated catalog *is* shipped, compiled into
 * `@deepseek-ai/dsh-cordis-client-runner/lib/client.js`, and those entries use
 * double quotes (`key: "settings.section"`) while the source file uses single
 * quotes. v4 walks a candidate list — the row's explicit `slotCatalogPath`,
 * the packaged paths next to the install anchor, the profile's own
 * `node_modules`, then the source checkout above the anchor — and parses both
 * spellings through the exported `slotKeysFromCatalogText`.
 *
 * v5 (2026-10-01, user decision 「要给一个『我接受风险，照样装』的按钮」):
 * a blocked check may now say how it can be resolved instead of dead-ending.
 * `report.exemption` carries the exact package@version / runtime pair the host's
 * own remedy needs (`pluginManager.setVersionExemption`, written to the profile's
 * `compatibility.json` and honoured by `app-boot` before any plugin loads), and
 * the `peer-compat` block points at it (`remedyIds: ['exemption']`,
 * `overridable: false` — a bare acknowledgement may not bypass a peer mismatch).
 * The `engines` block stays a block but becomes `overridable: true` with a plain
 * acknowledgement label, because the host checks **peerDependencies only** and
 * never refuses a plugin over `engines.dsh` — that check is the author's
 * declaration, not a technical impossibility.
 *
 * v6 (2026-10-01, user decision 「这些都做吧」): the report now carries the facts
 * the capability proposals need — `report.registries` (ordered registry
 * candidates for a manual retry), `report.configTemplate` (the target's own
 * `config:` defaults out of its bundle patch, merged with the profile's current
 * row config), `report.activation` (which declared rows the loader actually
 * runs, from `listBundles`/`listPlugins`) and `report.update` (installed spec vs
 * latest). `configDefaultsFromPatch` and `liveActivation` are exported: the
 * execution verifier reuses the latter to say whether an install took effect.
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

/**
 * Dotted slot keys declared by a generated slot catalog, source or compiled.
 *
 * The source checkout declares them as `key: 'settings.section'` in
 * `slot-catalog.ts`; a packaged install ships only the compiled catalog inside
 * the client-runner bundle, where the same entries appear with double quotes
 * (`key: "settings.section"`). Both spellings are accepted, and only dotted
 * keys count — the neighbouring descriptors (`key: "slots"`, a Client service)
 * and the placeholder examples in doc strings are not slot keys.
 * @param text - catalog source text, or anything else (ignored when unusable).
 * @returns every dotted slot key it declares.
 */
export function slotKeysFromCatalogText(text) {
  const keys = new Set()
  for (const match of String(text ?? '').matchAll(/key:\s*['"]([a-z][a-z0-9]*(?:\.[a-z0-9]+)*)['"]/g)) {
    if (match[1].includes('.')) keys.add(match[1])
  }
  return keys
}

/**
 * Candidate slot-catalog files, best first: the row's explicit
 * `slotCatalogPath`, the compiled catalog a packaged install (Desktop / SDK)
 * ships beside the dsh package, the profile's own `node_modules`, then the
 * source checkout reached by walking up from the install anchor.
 * @param options - resolved row options; `slotCatalogPath` may pin one file.
 * @param ctx - host context carrying `profileContext`.
 * @returns absolute candidate paths, in trust order.
 */
export function slotCatalogCandidates(options, ctx) {
  const candidates = []
  if (typeof options?.slotCatalogPath === 'string' && options.slotCatalogPath !== '') candidates.push(options.slotCatalogPath)
  const both = (join('dsh-cordis-client-runner', 'lib', 'client.js'))
  const relative = join('src', 'packages', 'extensions', 'cordis-client-runner', 'src', 'client', 'slot-catalog.ts')
  const anchor = ctx?.profileContext?.installAnchor
  if (typeof anchor === 'string' && anchor !== '') {
    const near = dirname(anchor)
    candidates.push(join(near, both))
    candidates.push(join(near, '..', both))
  }
  const profileDir = ctx?.profileContext?.dir
  if (typeof profileDir === 'string' && profileDir !== '') {
    candidates.push(join(profileDir, 'node_modules', '@deepseek-ai', both))
  }
  if (typeof anchor === 'string' && anchor !== '') {
    let dir = dirname(anchor)
    for (let depth = 0; depth < 7; depth += 1) {
      candidates.push(join(dir, relative))
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return candidates
}

/** Local slot keys from the installed slot catalog (source checkout or packaged runtime). */
async function readSlotKeys(options, ctx) {
  const tried = []
  for (const path of slotCatalogCandidates(options, ctx)) {
    if (!existsSync(path)) {
      tried.push(`${path}（不存在）`)
      continue
    }
    try {
      const keys = slotKeysFromCatalogText(await readFile(path, 'utf8'))
      if (keys.size === 0) {
        tried.push(`${path}（无 key 条目）`)
        continue
      }
      return { keys, path }
    } catch (error) {
      tried.push(`${path}（读取失败：${String(error?.message ?? error)}）`)
    }
  }
  return { keys: undefined, reason: `本机槽口目录不可用（${tried.length} 个候选都不可用：${tried.slice(0, 2).join('；')}）` }
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

/**
 * The declared DSH requirement, in either placement publishers use.
 * @param manifest - the target's package.json.
 * @returns `{ range, source }`, or undefined when neither placement carries a string.
 */
export function resolveDshEngines(manifest) {
  const top = manifest?.engines?.dsh
  if (typeof top === 'string' && top.trim() !== '') return { range: top, source: 'engines.dsh' }
  const nested = manifest?.dsh?.engines?.dsh
  if (typeof nested === 'string' && nested.trim() !== '') return { range: nested, source: 'dsh.engines.dsh' }
  return undefined
}

/* ------------------------------------------------------------------ the audit */

function check(id, status, title, detail, evidence, extra) {
  return { id, status, title, detail, ...(evidence === undefined ? {} : { evidence }), ...(extra ?? {}) }
}

function summarize(checks) {
  const summary = { block: 0, warn: 0, pass: 0, info: 0 }
  for (const item of checks) summary[item.status] = (summary[item.status] ?? 0) + 1
  return summary
}

/**
 * Ordered registries a manual retry can pin: pnpm's resolved one, the configured
 * one, the host's fallbacks, then the public mirror the plugin manager also
 * knows. The install itself already walks configured → fallbacks; this list is
 * what the panel offers when every configured one failed.
 * @param ctx - host plugin context carrying `pluginManager`.
 * @returns absolute `https://` registry URLs, best first.
 */
export async function registryCandidates(ctx) {
  const list = []
  const push = value => {
    if (typeof value === 'string' && /^https?:\/\//.test(value) && !list.includes(value)) list.push(value)
  }
  try {
    const registries = await ctx.pluginManager.registries()
    push(registries?.resolved ?? undefined)
    push(registries?.registry ?? undefined)
    for (const candidate of registries?.fallbackRegistries ?? []) push(candidate)
  } catch {
    /* a manager that cannot answer still gets the defaults below */
  }
  push('https://registry.npmjs.org/')
  push('https://registry.npmmirror.com/')
  return list
}

/**
 * Read the target's own `config:` defaults out of its bundle patch, without a
 * YAML dependency. Only the row whose `id`/`name` is in `rowIds` is read, and
 * only plain one-level scalars are converted — a nested mapping, a flow
 * collection (`[`, `{`), an anchor/alias or a `!!js` expression is left out and
 * reported in `skipped`, so the panel can show a smaller template instead of a
 * wrong one.
 * @param patchText - the target's `dsh.bundle.patch` file text.
 * @param rowIds - row ids the target inserts (from `insertedIds`).
 * @returns `{ config, skipped }`.
 */
export function configDefaultsFromPatch(patchText, rowIds) {
  const wanted = new Set(Array.isArray(rowIds) ? rowIds : [])
  const config = {}
  const skipped = []
  const lines = String(patchText ?? '').split(/\r?\n/)
  let matched = false
  let hasId = false
  let mode = 'top'
  let configIndent = 0
  let skipUntil = 0
  for (const raw of lines) {
    if (raw.trim() === '' || /^\s*#/.test(raw)) continue
    const indent = raw.match(/^\s*/)[0].length
    const trimmed = raw.trim()
    if (mode === 'config' && indent > configIndent) {
      if (skipUntil !== 0 && indent > skipUntil) continue
      skipUntil = 0
      const kv = trimmed.replace(/^-\s+/, '').match(/^([A-Za-z_][\w.-]*):\s*(.*)$/)
      if (kv === null) continue
      const value = kv[2].trim()
      if (value === '' || /!!js|^[*&]|^\[|^\{|\|/.test(value)) {
        skipped.push(kv[1])
        // An empty value opens a nested mapping/collection: its children are not
        // this row's keys, so skip them until the indentation drops back.
        if (value === '') skipUntil = indent
        continue
      }
      const unquoted = value.replace(/^(['"])(.*)\1$/, '$2')
      if (/^(true|false)$/i.test(unquoted)) config[kv[1]] = unquoted.toLowerCase() === 'true'
      else if (/^-?\d+(?:\.\d+)?$/.test(unquoted)) config[kv[1]] = Number(unquoted)
      else if (/^(null|~)$/.test(unquoted)) config[kv[1]] = null
      else config[kv[1]] = unquoted
      continue
    }
    mode = 'top'
    skipUntil = 0
    let body = trimmed
    if (body.startsWith('- ')) {
      matched = false
      hasId = false
      body = body.slice(2).trim()
    }
    const idMatch = body.match(/^(id|name):\s*(.*)$/)
    if (idMatch !== null) {
      const value = idMatch[2].trim().replace(/^(['"])(.*)\1$/, '$2')
      // The row's identity is its `id` when it has one; `name:` is only a
      // fallback, otherwise the module name would overwrite the id match.
      if (idMatch[1] === 'id' || !hasId) {
        matched = wanted.size === 0 || wanted.has(value)
        if (idMatch[1] === 'id') hasId = true
      }
      continue
    }
    if (body === 'config:') {
      mode = matched ? 'config' : 'top'
      configIndent = indent
    }
  }
  return { config, skipped }
}

/**
 * What the profile says about one package right now: its bundle row(s), whether
 * the loader is actually running each one, and the fiber phase.
 *
 * The audit uses this to offer "turn the rows it declared back on"; the
 * execution verifier uses the same facts to answer "did the install take
 * effect?" — a row that is present but `pending`/`failed` is exactly the
 * `fiberPhase: null` trap this project has hit before.
 * @param ctx - host plugin context carrying `pluginManager`.
 * @param packageName - the bundle package name.
 * @param rowIds - ids the package declares (from its patch).
 * @returns `{ bundle, rows, disabledRows, inactiveRows, declared }`.
 */
export async function liveActivation(ctx, packageName, rowIds) {
  const phases = new Map()
  const enabledById = new Map()
  try {
    for (const info of await ctx.pluginManager.listPlugins()) {
      if (typeof info.patchId !== 'string') continue
      phases.set(info.patchId, info.fiberPhase ?? null)
      enabledById.set(info.patchId, info.enabled === true)
    }
  } catch {
    /* an unreadable inventory degrades every phase to "unknown" */
  }
  const rows = []
  let bundle
  try {
    const bundles = await ctx.pluginManager.listBundles()
    const entry = bundles.find(info => info.name === packageName)
    if (entry !== undefined) {
      bundle = { name: entry.name, enabled: entry.enabled === true, installed: entry.installed === true }
      for (const row of entry.rows ?? []) {
        if (typeof row.rowId !== 'string') continue
        rows.push({
          rowId: row.rowId,
          moduleName: row.moduleName,
          entryId: row.entryId,
          enabled: row.entryId === undefined ? undefined : enabledById.get(row.rowId),
          phase: row.entryId === undefined ? undefined : phases.get(row.rowId) ?? null,
        })
      }
    }
  } catch {
    /* no bundle view: `rows` stays empty and callers say "unknown" */
  }
  const declared = Array.isArray(rowIds) ? rowIds : []
  return {
    bundle,
    rows,
    declared,
    disabledRows: rows.filter(row => row.enabled === false),
    inactiveRows: rows.filter(row => row.entryId !== undefined && row.enabled !== false && row.phase !== 'active'),
  }
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
    report.exemption = { packageVersion: peers.key, runtimeVersion: report.runtime.version, peers: peers.peers, exempted: true }
    checks.push(check('peer-compat', 'warn', 'peer 不兼容，但已有豁免', `${peers.key} 已对 DSH ${report.runtime.version} 放行；这个豁免可以在方案里撤销。`))
  } else {
    report.exemption = { packageVersion: peers.key, runtimeVersion: report.runtime.version, peers: peers.peers, exempted: false }
    checks.push(check('peer-compat', 'block', 'peer 不兼容当前 DSH',
      `${JSON.stringify(peers.peers)} 不满足 ${report.runtime.version}；官方原话：运行不兼容的插件可能导致崩溃或数据丢失。`,
      undefined,
      // A peer mismatch may NOT be waved through by a bare acknowledgement: the
      // only way past it is the host's own exact-version exemption.
      { remedyIds: ['exemption'], overridable: false }))
    suggestions.push(peers.key === undefined
      ? '上游 peer 范围没声明当前 DSH，而且 manifest 缺 name/version，无法给出豁免目标：先向作者提 PR 扩范围。'
      : `要装只能用官方版本豁免（面板方案里的「放行版本检查」）：它只对 ${peers.key} @ DSH ${report.runtime.version} 这一对确切版本生效，换版本或升级 DSH 后自动失效，风险自负。`)
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
  let targetPatchText
  try {
    const patchUrl = report.manifest.bundlePatch
    if (typeof patchUrl === 'string' && target.kind === 'path') {
      targetPatchText = await readFile(join(target.path, patchUrl.replace(/^\.\//, '')), 'utf8')
      targetRows = insertedIds(targetPatchText)
    } else if (typeof patchUrl === 'string') {
      const clean = patchUrl.replace(/^\.\//, '')
      const base = target.kind === 'registry'
        ? `https://unpkg.com/${target.name}@${manifest.version}/`
        : `https://raw.githubusercontent.com/${target.repo}/${await githubBranch(target.repo, opts)}/`
      const patchFetch = await fetchText(`${base}${clean}`, opts)
      targetRows = patchFetch.ok ? insertedIds(patchFetch.text) : []
      if (patchFetch.ok) targetPatchText = patchFetch.text
      if (!patchFetch.ok) checks.push(check('row-ids', 'info', '读不到目标 patch', `无法核对 loader id 冲突：${patchFetch.error ?? ''}`))
    }
  } catch (error) {
    checks.push(check('row-ids', 'info', '读取目标 patch 失败', String(error?.message ?? error)))
  }
  report.rowIds = targetRows
  report.activation = await liveActivation(ctx, packageName, targetRows)

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
  const engines = resolveDshEngines(manifest)
  if (engines === undefined) {
    checks.push(check('engines', 'info', '未声明 engines.dsh', '顶层 engines.dsh 与 dsh.engines.dsh 都没有声明'))
  } else if (report.runtime.version !== null && satisfies(report.runtime.version, engines.range)) {
    checks.push(check('engines', 'pass', '声明的宿主要求满足', `engines.dsh ${engines.range}（声明于 ${engines.source}）`))
  } else {
    checks.push(check('engines', 'block', '声明的宿主要求不满足',
      `engines.dsh ${engines.range}（声明于 ${engines.source}），本机 ${report.runtime.version ?? '未知'}。注意：宿主只核对 peerDependencies，**不会**因为 engines.dsh 不符而拦住安装——这一项是作者的声明，不是技术上装不上；你可以勾选确认后仍然安装，或改用一个满足该范围的版本。`,
      undefined,
      // Host-enforced? No: `app-boot`'s compatibility evaluation reads
      // peerDependencies only. So this stays a block (the author's signal) but
      // the user may acknowledge it and proceed.
      { overridable: true, ackLabel: '我知道宿主不拦 engines.dsh，这只是作者的声明；我确认仍然安装' }))
    suggestions.push('engines 不符：挑一个 range 覆盖本机 DSH 的版本，或在阻断条上勾选确认后仍然安装。')
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

  // 12 · capability facts (registry retry, config template, update) ----------
  const fromPatch = configDefaultsFromPatch(targetPatchText, targetRows)
  const currentRow = report.row?.config ?? {}
  report.configTemplate = {
    value: { ...fromPatch.config, ...currentRow },
    patchKeys: Object.keys(fromPatch.config),
    currentKeys: Object.keys(currentRow),
    skipped: fromPatch.skipped,
  }
  report.registries = await registryCandidates(ctx)
  const installedSpec = report.installed?.spec
  const latest = typeof report.manifest.version === 'string' ? report.manifest.version : undefined
  const plainSpec = typeof installedSpec === 'string' && /^[~^]?\d+\.\d+\.\d+/.test(installedSpec)
  report.update = {
    installedSpec: typeof installedSpec === 'string' ? installedSpec : undefined,
    latest,
    available: installed && latest !== undefined && plainSpec && !installedSpec.includes(latest),
  }

  report.summary = summarize(checks)
  return report
}
