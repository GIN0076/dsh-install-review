/**
 * Pure tests for the Chinese-facing catalog view: bilingual descriptions,
 * Chinese category/capability labels, red-line translation, projection,
 * search/sort/paging, and the audit capability enrichment.
 */
import { descriptionOf, repoPathOf, redLineText, findCatalogEntry, queryCatalogView, augmentAudit, CATEGORY_LABELS, CAPABILITY_LABELS } from './catalog-view.js'

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

/* descriptions: zh first, en fallback, string passthrough */
expect('desc zh first', descriptionOf({ description: { zh: '中文说明', en: 'English' } }), '中文说明')
expect('desc en fallback', descriptionOf({ description: { en: 'English' } }), 'English')
expect('desc string', descriptionOf({ description: '直接字符串' }), '直接字符串')
expect('desc absent', descriptionOf({}), undefined)

/* repo path out of the URL (the registry has no `repo` field) */
expect('repoPath plain', repoPathOf({ url: 'https://github.com/dsh-market/dsh-market' }), 'dsh-market/dsh-market')
expect('repoPath with .git', repoPathOf({ url: 'https://github.com/owner/repo.git' }), 'owner/repo')
expect('repoPath non-github', repoPathOf({ url: 'https://example.com/x' }), undefined)

/* Chinese label tables cover the live vocabularies (23 categories, 10 capabilities) */
expect('category ui', CATEGORY_LABELS.ui, '界面')
expect('category agi', CATEGORY_LABELS.agi, 'AGI 探索')
expect('all 23 categories labelled', Object.keys(CATEGORY_LABELS).length, 23)
expect('all 10 capabilities labelled', Object.keys(CAPABILITY_LABELS).length, 10)
expect('capability network', CAPABILITY_LABELS.network, '联网')
expect('capability host-runtime', CAPABILITY_LABELS['host-runtime'], '改动 DSH 本体')

/* red lines: four known shapes translate, the rest pass through */
expect('red credentials+network', redLineText('reads credentials/secrets AND has network access'), '会读密钥并且联网')
expect('red install script', redLineText('runs code at install time (postinstall)'), '安装时运行 postinstall 脚本')
expect('red plaintext http', redLineText('uses plaintext http:// to www.ibm.com'), '明文 http:// 访问 www.ibm.com')
expect('red literal ip', redLineText('uses literal IP 8.8.8.8 for network access'), '直连固定 IP 8.8.8.8')
expect('red passthrough', redLineText('something entirely new'), 'something entirely new')

/* entry matching: URL first, then npm, then bare name */
const entries = [
  { name: 'dsh-market', npm: 'dshmarket', url: 'https://github.com/dsh-market/dsh-market' },
  { name: 'dsh-find-plugin', npm: 'dsh-find-plugin', url: 'https://github.com/awesome-dsh-plugin/dsh-find-plugin' },
]
expect('find by repo', findCatalogEntry(entries, { repo: 'dsh-market/dsh-market' })?.npm, 'dshmarket')
expect('find by npm', findCatalogEntry(entries, { name: 'dsh-find-plugin' })?.npm, 'dsh-find-plugin')
expect('find miss', findCatalogEntry(entries, { name: 'nope' }), undefined)

/* query: zh description search, category filter, downloads sort, projection */
const catalog = {
  ok: true,
  entries: [
    {
      name: 'alpha', npm: 'alpha', url: 'https://github.com/a/alpha', stars: 10, downloads: 500,
      category: 'market', added: '2026-01-01', description: { zh: '可视化插件市场', en: 'market' },
      capabilities: ['network', 'fs-write'], capabilityRedLines: ['reads credentials/secrets AND has network access'],
      install: 'dsh plugin --profile web add alpha', downloadsStart: '2026-08-29', downloadsEnd: '2026-09-27',
    },
    {
      name: 'beta', npm: 'beta', url: 'https://github.com/b/beta', stars: 99, downloads: 20,
      category: 'tools', added: '2026-02-01', description: { zh: '纯工具', en: 'tool' },
      capabilities: ['fs-read'],
    },
  ],
}
const all = queryCatalogView(catalog, {})
expect('view total', all.total, 2)
expect('view category label', all.categories, [{ id: 'market', count: 1, label: '插件市场' }, { id: 'tools', count: 1, label: '工具' }])
expect('view downloads window', all.downloadsWindow, { start: '2026-08-29', end: '2026-09-27' })
expect('default sort is stars', all.entries[0].name, 'beta')
const byDownloads = queryCatalogView(catalog, { sort: 'downloads' })
expect('sort by downloads', byDownloads.entries.map(row => row.name), ['alpha', 'beta'])
const zhSearch = queryCatalogView(catalog, { q: '可视化' })
expect('search matches zh description', zhSearch.entries.map(row => row.name), ['alpha'])
const capped = queryCatalogView(catalog, { category: 'market' })
expect('category filter', capped.entries.map(row => row.name), ['alpha'])
const projection = all.entries.find(row => row.name === 'alpha')
expect('projection desc zh', projection.desc, '可视化插件市场')
expect('projection category label', projection.categoryLabel, '插件市场')
expect('projection capabilities chinese', projection.caps.map(cap => cap.label), ['联网', '改文件'])
expect('projection red lines chinese', projection.redLines, ['会读密钥并且联网'])
expect('projection install command', projection.install, 'dsh plugin --profile web add alpha')
expect('projection repo path', projection.repoPath, 'a/alpha')
const paged = queryCatalogView(catalog, { limit: 1, offset: 1 })
expect('paging slice', paged.entries.map(row => row.name), ['alpha'])
expect('paging totals', [paged.total, paged.filtered], [2, 2])

/* audit enrichment: warn on red lines, info without, recount summary */
const report = {
  checks: [
    { id: 'a', status: 'pass' }, { id: 'b', status: 'warn' }, { id: 'c', status: 'info' },
  ],
  summary: { block: 0, warn: 1, pass: 1, info: 1 },
}
augmentAudit(report, catalog, { name: 'alpha' })
expect('augment added check', report.checks.at(-1).id, 'capabilities')
expect('augment warns on red line', report.checks.at(-1).status, 'warn')
expect('augment detail chinese', report.checks.at(-1).detail, '能力：联网、改文件；红线：会读密钥并且联网')
expect('augment recounted summary', report.summary, { block: 0, warn: 2, pass: 1, info: 1 })

const cleanReport = { checks: [{ id: 'a', status: 'pass' }], summary: { block: 0, warn: 0, pass: 1, info: 0 } }
augmentAudit(cleanReport, catalog, { name: 'beta' })
expect('augment info without red line', cleanReport.checks.at(-1).status, 'info')
expect('augment detail without red line', cleanReport.checks.at(-1).detail, '能力：读文件；未标注红线')

const untouched = { checks: [{ id: 'a', status: 'pass' }], summary: { block: 0, warn: 0, pass: 1, info: 0 } }
augmentAudit(untouched, catalog, { name: 'missing' })
expect('augment skips unknown entry', untouched.checks.length, 1)

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
if (failures > 0) process.exitCode = 1
