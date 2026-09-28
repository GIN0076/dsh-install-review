/**
 * Chinese-facing view over the curated catalog: the browse tab's query plus
 * the security enrichment the audit report shows.
 *
 * The registry stores bilingual data in shapes the first version mishandled:
 *   - `description` is `{ en, zh }`, not a string (v1 dropped it entirely);
 *   - `category` is an English slug (`ui`, `tools`, …) with no label map;
 *   - `capabilities` / `capabilityRedLines` are English slugs and sentences
 *     that the market itself renders as 「会联网 / 会用你的密钥 …」.
 *
 * Everything here is pure — no network, no state — so it is unit-testable
 * without a host.
 */
import { categoriesOf } from './catalog.js'

/** The registry's 23 category slugs, in Chinese. */
export const CATEGORY_LABELS = {
  ui: '界面',
  tools: '工具',
  dev: '开发',
  session: '会话',
  workflow: '工作流',
  usage: '用量',
  model: '模型',
  memory: '记忆',
  skill: '技能',
  notify: '通知',
  theme: '主题',
  security: '安全',
  remote: '远程',
  fun: '趣味',
  vision: '视觉',
  git: 'Git',
  browser: '浏览器',
  market: '插件市场',
  wsl: 'WSL',
  docs: '文档',
  voice: '语音',
  identity: '身份人设',
  agi: 'AGI 探索',
}

/** The registry's 10 capability slugs, in the market's own Chinese wording. */
export const CAPABILITY_LABELS = {
  'fs-read': '读文件',
  'fs-write': '改文件',
  network: '联网',
  env: '读环境变量',
  shell: '执行命令',
  credentials: '用密钥',
  llm: '调 AI 模型',
  'host-runtime': '改动 DSH 本体',
  'dynamic-code': '临时下载代码',
  subagent: '开子任务',
}

/** Chinese for the red-line sentences; anything else passes through verbatim. */
export function redLineText(value) {
  const text = String(value ?? '')
  if (text === '') return text
  if (text === 'reads credentials/secrets AND has network access') return '会读密钥并且联网'
  const install = /^runs code at install time \(([^)]+)\)$/.exec(text)
  if (install !== null) return `安装时运行 ${install[1]} 脚本`
  const plaintext = /^uses plaintext http:\/\/ to (.+)$/.exec(text)
  if (plaintext !== null) return `明文 http:// 访问 ${plaintext[1]}`
  const ip = /^uses literal IP (\S+) for network access$/.exec(text)
  if (ip !== null) return `直连固定 IP ${ip[1]}`
  return text
}

/** Bilingual description, Chinese first. */
export function descriptionOf(entry) {
  const value = entry?.description
  if (typeof value === 'string') return value.trim() || undefined
  if (value !== null && typeof value === 'object') {
    if (typeof value.zh === 'string' && value.zh.trim() !== '') return value.zh
    if (typeof value.en === 'string' && value.en.trim() !== '') return value.en
  }
  return undefined
}

/** `owner/repo` read out of the GitHub URL (the registry carries no `repo` field). */
export function repoPathOf(entry) {
  const url = String(entry?.url ?? '')
  const match = /^https:\/\/github\.com\/([^/]+\/[^/.]+?)(?:\.git)?(?:\/.*)?$/.exec(url)
  return match === null ? undefined : match[1]
}

/**
 * Find the registry entry an audit target names (URL first — it is the only
 * field that survives every entry shape — then npm, then bare name).
 * @param entries - catalog entries.
 * @param target - a parsed target from `parseTarget`.
 * @returns the entry, or undefined.
 */
export function findCatalogEntry(entries, target) {
  if (!Array.isArray(entries) || target === undefined || target === null) return undefined
  const repo = String(target.repo ?? '').toLowerCase()
  const npm = String(target.name ?? '').toLowerCase()
  if (repo !== '') {
    for (const entry of entries) {
      const url = String(entry.url ?? '').toLowerCase()
      if (url.includes(`github.com/${repo}`)) return entry
    }
  }
  if (npm !== '') {
    for (const entry of entries) {
      if (String(entry.npm ?? '').toLowerCase() === npm) return entry
    }
    for (const entry of entries) {
      if (String(entry.name ?? '').toLowerCase() === npm) return entry
    }
  }
  return undefined
}

function haystackOf(entry) {
  const description = entry.description
  const parts = [
    entry.name, entry.npm, entry.owner, entry.url, entry.page,
    typeof description === 'string' ? description : description?.zh, description?.en,
    ...(Array.isArray(entry.capabilities) ? entry.capabilities : []),
    CATEGORY_LABELS[String(entry.category)] ?? entry.category,
  ].filter(value => typeof value === 'string' && value !== '')
  return parts.join(' ').toLowerCase()
}

function projectEntry(entry) {
  const capabilities = (Array.isArray(entry.capabilities) ? entry.capabilities : [])
    .map(id => ({ id: String(id), label: CAPABILITY_LABELS[String(id)] ?? String(id) }))
  const redLines = (Array.isArray(entry.capabilityRedLines) ? entry.capabilityRedLines : [])
    .map(redLineText).filter(Boolean)
  const category = Array.isArray(entry.category) ? entry.category.map(String) : entry.category === undefined || entry.category === null ? [] : [String(entry.category)]
  return {
    key: entry.url ?? entry.name,
    name: entry.name,
    npm: entry.npm,
    repoPath: repoPathOf(entry),
    url: entry.url,
    stars: entry.stars,
    downloads: typeof entry.downloads === 'number' ? entry.downloads : undefined,
    added: entry.added,
    category,
    categoryLabel: category.map(id => CATEGORY_LABELS[id] ?? id).join('、') || undefined,
    desc: descriptionOf(entry),
    caps: capabilities,
    redLines,
    install: typeof entry.install === 'string' ? entry.install : undefined,
  }
}

/**
 * Server-side search over the catalog, Chinese-facing projection.
 * @param result - a loaded catalog result (`{ ok, entries }`).
 * @param params - `{ q, category, sort, offset, limit }`.
 * @returns `{ ok, total, filtered, categories, downloadsWindow, offset, limit, entries }`.
 */
export function queryCatalogView(result, params = {}) {
  if (result?.ok !== true || !Array.isArray(result.entries)) return { ok: false, error: result?.error ?? '清单不可用' }
  const limit = Math.min(Math.max(Number(params.limit) || 25, 1), 100)
  const offset = Math.max(Number(params.offset) || 0, 0)
  const tokens = String(params.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const category = typeof params.category === 'string' && params.category !== '' ? params.category : undefined
  const rows = result.entries.filter((entry) => {
    if (category !== undefined) {
      const value = entry.category
      const values = Array.isArray(value) ? value.map(String) : value === undefined || value === null ? [] : [String(value)]
      if (!values.includes(category)) return false
    }
    if (tokens.length === 0) return true
    const haystack = haystackOf(entry)
    return tokens.every(token => haystack.includes(token))
  })
  const sort = String(params.sort ?? 'stars')
  rows.sort((a, b) => {
    if (sort === 'name') return String(a.name ?? '').localeCompare(String(b.name ?? ''))
    if (sort === 'added') return String(b.added ?? '').localeCompare(String(a.added ?? ''))
    if (sort === 'downloads') return (typeof b.downloads === 'number' ? b.downloads : -1) - (typeof a.downloads === 'number' ? a.downloads : -1)
    return (typeof b.stars === 'number' ? b.stars : -1) - (typeof a.stars === 'number' ? a.stars : -1)
      || String(a.name ?? '').localeCompare(String(b.name ?? ''))
  })
  const windowEntry = result.entries.find(entry => typeof entry.downloadsStart === 'string' && typeof entry.downloadsEnd === 'string')
  return {
    ok: true,
    total: result.entries.length,
    filtered: rows.length,
    categories: categoriesOf(result.entries)
      .slice(0, 60)
      .map(item => ({ ...item, label: CATEGORY_LABELS[item.id] ?? item.id })),
    downloadsWindow: windowEntry === undefined ? undefined : { start: windowEntry.downloadsStart, end: windowEntry.downloadsEnd },
    offset,
    limit,
    entries: rows.slice(offset, offset + limit).map(projectEntry),
  }
}

/**
 * Append the registry's capability / red-line facts to an audit report, so the
 * safety review shows what the scanner saw as well as what this host checked.
 * @param report - a report from `runAudit`.
 * @param catalog - a catalog result (`{ ok, entries }`).
 * @param target - the parsed target, for entry matching.
 * @returns the same report, augmented when the entry was found.
 */
export function augmentAudit(report, catalog, target) {
  if (report === undefined || report === null) return report
  const entry = catalog?.ok === true ? findCatalogEntry(catalog.entries, target) : undefined
  if (entry === undefined) return report
  const capabilities = (Array.isArray(entry.capabilities) ? entry.capabilities : []).map(String)
  const redLines = (Array.isArray(entry.capabilityRedLines) ? entry.capabilityRedLines : []).map(redLineText).filter(Boolean)
  const capabilityText = capabilities.map(id => CAPABILITY_LABELS[id] ?? id).join('、')
  report.capabilities = { ids: capabilities, labels: capabilityText === '' ? [] : capabilityText.split('、'), redLines }
  report.checks.push(redLines.length > 0
    ? {
      id: 'capabilities',
      status: 'warn',
      title: '清单标注了安全红线',
      detail: `能力：${capabilityText || '—'}；红线：${redLines.join('；')}`,
      evidence: Array.isArray(entry.capabilityRedLines) ? entry.capabilityRedLines.join(' | ') : undefined,
    }
    : {
      id: 'capabilities',
      status: 'info',
      title: '清单标注的能力',
      detail: capabilityText === '' ? '上游未标注能力' : `能力：${capabilityText}；未标注红线`,
    })
  const summary = { block: 0, warn: 0, pass: 0, info: 0 }
  for (const item of report.checks) summary[item.status] = (summary[item.status] ?? 0) + 1
  report.summary = summary
  return report
}
