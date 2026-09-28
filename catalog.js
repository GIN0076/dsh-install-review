/**
 * Curated catalog loader for the browse tab: one network source, a disk cache
 * that survives restarts, a shared in-flight promise so the audit path and the
 * browse path never download twice, and server-side query (search / category /
 * sort / page) so the 5MB document never reaches the browser.
 *
 * Source: https://awesome-dsh-plugin.com/plugins.json (schemaVersion 2,
 * `plugins[]`), refreshed daily by upstream CI. No mirror exists (probed
 * unpkg / jsDelivr / *.lite.json → 404), so the disk cache is what makes the
 * second and later opens instant.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(HERE, '.cache')
const CACHE_FILE = join(CACHE_DIR, 'plugins.json')
const META_FILE = join(CACHE_DIR, 'plugins-meta.json')

/** Default network budget: the one download may take a minute; memory TTL is short, disk TTL is long. */
export const CATALOG_DEFAULTS = {
  catalogUrl: 'https://awesome-dsh-plugin.com/plugins.json',
  catalogTimeoutMs: 120000,
  cacheTtlMs: 900000,
  diskTtlMs: 86400000,
  catalogPageSize: 25,
}

/** In-process catalog: `{ entries, generatedAt, source, fetchedAt, bytes, stale? }` */
let memory = null
/** The single in-flight load, shared by every caller. */
let inflight = null
/** Last failure reason, surfaced by the status line. */
let lastError = null

function normalize(text, source) {
  const payload = JSON.parse(text)
  const entries = Array.isArray(payload) ? payload
    : Array.isArray(payload?.plugins) ? payload.plugins
      : Array.isArray(payload?.entries) ? payload.entries : null
  if (entries === null) throw new Error('目录结构无法识别（没有 plugins 数组）')
  return {
    entries,
    generatedAt: typeof payload?.generatedAt === 'string' ? payload.generatedAt : undefined,
    source,
    fetchedAt: Date.now(),
    bytes: text.length,
  }
}

async function readDisk() {
  try {
    const [text, metaText] = await Promise.all([readFile(CACHE_FILE, 'utf8'), readFile(META_FILE, 'utf8')])
    const meta = JSON.parse(metaText)
    return { ...normalize(text, meta.source), fetchedAt: typeof meta.fetchedAt === 'number' ? meta.fetchedAt : 0 }
  } catch {
    return null
  }
}

async function writeDisk(entry) {
  try {
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(CACHE_FILE, JSON.stringify({ schemaVersion: 2, generatedAt: entry.generatedAt, plugins: entry.entries }), 'utf8')
    await writeFile(META_FILE, JSON.stringify({ fetchedAt: entry.fetchedAt, source: entry.source, bytes: entry.bytes }), 'utf8')
  } catch {
    /* a read-only workspace only costs the next cold start */
  }
}

/**
 * Ensure the catalog is loaded, downloading it at most once per process.
 * @param options - profile options (`catalogUrl`, `catalogTimeoutMs`, `cacheTtlMs`, `diskTtlMs`).
 * @param flags - `fresh` forces a network refresh (bypassing memory and disk TTLs).
 * @returns `{ ok: true, entries, generatedAt, source, fetchedAt, bytes, stale?, error? }` or `{ ok: false, error }`.
 */
export function ensureCatalog(options = {}, flags = {}) {
  const fresh = flags.fresh === true
  const ttl = options.cacheTtlMs ?? CATALOG_DEFAULTS.cacheTtlMs
  if (!fresh && memory !== null && Date.now() - memory.fetchedAt < ttl) {
    return Promise.resolve({ ok: true, ...memory })
  }
  if (inflight !== null && !fresh) return inflight
  const load = (async () => {
    try {
      if (!fresh) {
        const disk = await readDisk()
        if (disk !== null && Date.now() - disk.fetchedAt < (options.diskTtlMs ?? CATALOG_DEFAULTS.diskTtlMs)) {
          memory = disk
          lastError = null
          return { ok: true, ...disk }
        }
      }
      const url = options.catalogUrl ?? CATALOG_DEFAULTS.catalogUrl
      const response = await fetch(url, {
        signal: AbortSignal.timeout(options.catalogTimeoutMs ?? CATALOG_DEFAULTS.catalogTimeoutMs),
        headers: { accept: 'application/json', 'user-agent': 'dsh-install-review/0.1.0' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const loaded = normalize(await response.text(), url)
      memory = loaded
      lastError = null
      void writeDisk(loaded)
      return { ok: true, ...loaded }
    } catch (error) {
      lastError = String(error?.message ?? error)
      const disk = await readDisk()
      if (disk !== null) {
        memory = { ...disk, stale: true }
        return { ok: true, ...memory, stale: true, error: lastError }
      }
      return { ok: false, error: lastError }
    } finally {
      inflight = null
    }
  })()
  inflight = load
  return load
}

/**
 * Wait at most `ms` for the catalog; a slow first download keeps running in
 * the background so the next caller finds it ready.
 * @param options - profile options.
 * @param ms - race budget in milliseconds.
 * @returns the catalog result, or `{ ok: false, loading: true, error }` on timeout.
 */
export async function raceCatalog(options = {}, ms = 20000) {
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms)
  })
  try {
    const result = await Promise.race([ensureCatalog(options), timeout])
    if (result !== undefined) return result
    return { ok: false, loading: true, error: `清单仍在下载（首次约 20-80 秒），本次跳过${lastError ? `；上次错误：${lastError}` : ''}` }
  } finally {
    clearTimeout(timer)
  }
}

/** Is anything loadable right now? Used by the route to answer instantly. */
export async function catalogBrief() {
  if (inflight !== null) return { state: 'loading', error: lastError }
  if (memory !== null) return briefOf({ ok: true, ...memory })
  const disk = await readDisk()
  if (disk !== null) {
    memory = disk
    return briefOf({ ok: true, ...disk })
  }
  // Nothing cached and nothing running: an earlier failure stops the polling
  // client here (`refresh` starts a new attempt), otherwise start one.
  return lastError === null ? { state: 'empty' } : { state: 'error', error: lastError }
}

function briefOf(result) {
  return {
    state: 'ready',
    total: result.entries.length,
    generatedAt: result.generatedAt,
    source: result.source,
    fetchedAt: result.fetchedAt,
    bytes: result.bytes,
    stale: result.stale === true,
    error: result.error,
  }
}

/** Category counts over the whole catalog, most frequent first. */
export function categoriesOf(entries) {
  const counts = new Map()
  for (const entry of entries) {
    const value = entry.category
    const values = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value]
    for (const one of values) counts.set(String(one), (counts.get(String(one)) ?? 0) + 1)
  }
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

function haystackOf(entry) {
  return [
    entry.name, entry.npm, entry.owner, entry.repo, entry.fullName, entry.id, entry.url,
    entry.description, entry.descriptionZh, ...(entry.tags ?? []),
  ].filter(value => typeof value === 'string' && value !== '').join(' ').toLowerCase()
}

/** Trim one catalog entry to the fields the row renders. */
export function projectEntry(entry) {
  const description = typeof entry.descriptionZh === 'string' && entry.descriptionZh !== '' ? entry.descriptionZh : entry.description
  return {
    id: entry.id,
    name: entry.name,
    npm: entry.npm,
    url: entry.url,
    stars: entry.stars,
    curated: entry.curated,
    category: entry.category,
    added: entry.added ?? entry.createdAt,
    owner: entry.owner,
    repo: entry.repo,
    desc: typeof description === 'string' ? description.slice(0, 240) : undefined,
  }
}

/**
 * Server-side search over the catalog.
 * @param result - a loaded catalog result (`{ ok, entries }`).
 * @param params - `{ q, category, sort, offset, limit }`.
 * @returns `{ ok, total, filtered, categories, offset, limit, entries }` or `{ ok: false }`.
 */
export function queryCatalog(result, params = {}) {
  if (result?.ok !== true || !Array.isArray(result.entries)) return { ok: false, error: result?.error ?? '清单不可用' }
  const limit = Math.min(Math.max(Number(params.limit) || CATALOG_DEFAULTS.catalogPageSize, 1), 100)
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
    if (sort === 'name') return String(a.name ?? a.id ?? '').localeCompare(String(b.name ?? b.id ?? ''))
    if (sort === 'added') return String(b.added ?? b.createdAt ?? '').localeCompare(String(a.added ?? a.createdAt ?? ''))
    const left = typeof a.stars === 'number' ? a.stars : -1
    const right = typeof b.stars === 'number' ? b.stars : -1
    return right - left || String(a.name ?? '').localeCompare(String(b.name ?? ''))
  })
  return {
    ok: true,
    total: result.entries.length,
    filtered: rows.length,
    categories: categoriesOf(result.entries).slice(0, 60),
    offset,
    limit,
    entries: rows.slice(offset, offset + limit).map(projectEntry),
  }
}
