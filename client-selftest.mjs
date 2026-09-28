/**
 * Load the real client module with a stub React + mock fetch, register it into
 * a fake slot system, evaluate the panel in idle / report / blocking states,
 * drive its audit and execute buttons end to end, then walk the catalog tab
 * (browse → one-click send-to-audit). A second module instance bound to the
 * real React is server-rendered for a browser-quality pass.
 */
const REACT_URL = 'file:///E:/DSH-OneClick/src/node_modules/.pnpm/react@18.3.1/node_modules/react/index.js'
const REACT_DOM_SERVER_URL = 'file:///E:/DSH-OneClick/src/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/server.node.js'
const { renderToStaticMarkup } = await import(REACT_DOM_SERVER_URL)

/* --- minimal React with scriptable state ---------------------------------- */
let current = []
let cursor = 0
const stubReact = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.length === 1 ? children[0] : children } }
  },
  useState(initial) {
    const index = cursor
    cursor += 1
    if (!(index in current)) current[index] = typeof initial === 'function' ? initial() : initial
    const setter = (next) => {
      current[index] = typeof next === 'function' ? next(current[index]) : next
    }
    return [current[index], setter]
  },
  useEffect() { /* no side effects in this harness */ },
  useRef(initial) { return { current: initial } },
}

let captured = null
globalThis.window = { __ModuleLoader__: { load(spec) { captured = spec } } }
globalThis.document = { baseURI: 'http://127.0.0.1:3080/' }
/** Clipboard stub (Node 22 defines a read-only navigator, so redefine it). */
let clipboardText = null
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async (text) => { clipboardText = String(text) } } },
  configurable: true,
})

const AUDIT_PAYLOAD = {
  report: {
    rawTarget: 'dsh-find-plugin',
    target: { kind: 'registry', name: 'dsh-find-plugin', spec: 'dsh-find-plugin' },
    runtime: { version: '0.1.7-rc.2', profile: 'C:\\Users\\localtester\\.dsh\\profiles\\web' },
    manifest: { name: 'dsh-find-plugin', version: '0.4.0', description: 'x', hasBundle: true, bundlePatch: './cordis.patch.yml', scripts: {} },
    summary: { block: 0, warn: 1, pass: 3, info: 2 },
    checks: [
      { id: 'runtime', status: 'info', title: '本机运行时', detail: 'DSH 0.1.7-rc.2, profile C:\\Users\\localtester\\.dsh\\profiles\\web' },
      { id: 'peer-compat', status: 'pass', title: 'peer 兼容当前 DSH', detail: '全部满足' },
      { id: 'slot-audit', status: 'warn', title: '有槽口本机不存在（疑似）', detail: 'foo.bar' },
      { id: 'engines', status: 'info', title: '未声明 engines.dsh', detail: '作者没有声明宿主要求' },
    ],
    suggestions: ['优先选 npm 预构建版本'],
    installed: { isInstalled: false },
    catalog: { ok: true, entry: { npm: 'dsh-find-plugin' } },
  },
  proposals: [
    { id: 'version', kind: 'version', title: '固定版本', detail: '写成 包名@版本号', risk: '写错会失败', defaultOn: false, editable: [{ key: 'version', label: '版本号', value: '0.4.0' }] },
    { id: 'profile-config', kind: 'profile-config', phase: 'after', title: '装后写配置', detail: 'configEditor', risk: '键要合法', defaultOn: false, editable: [{ key: 'config', label: '配置 JSON', value: '{}', multiline: true }] },
  ],
}

const CATALOG_PAYLOAD = {
  state: 'ready',
  total: 4377,
  filtered: 2,
  offset: 0,
  limit: 25,
  generatedAt: '2026-09-28T06:00:00.000Z',
  source: 'https://awesome-dsh-plugin.com/plugins.json',
  stale: false,
  downloadsWindow: { start: '2026-08-29', end: '2026-09-27' },
  categories: [{ id: 'market', label: '插件市场', count: 80 }],
  entries: [
    {
      key: 'https://github.com/dsh-market/dsh-market',
      name: 'dsh-market',
      npm: 'dshmarket',
      repoPath: 'dsh-market/dsh-market',
      url: 'https://github.com/dsh-market/dsh-market',
      stars: 4713,
      downloads: 405580,
      added: '2026-05-01',
      category: ['market'],
      categoryLabel: '插件市场',
      desc: '可视化插件市场：逛一逛，点一下，装好。',
      caps: [{ id: 'network', label: '联网' }, { id: 'fs-write', label: '改文件' }],
      redLines: ['会读密钥并且联网'],
      install: 'dsh plugin --profile web add dshmarket',
    },
    {
      key: 'https://github.com/awesome-dsh-plugin/dsh-find-plugin',
      name: 'dsh-find-plugin',
      npm: 'dsh-find-plugin',
      repoPath: 'awesome-dsh-plugin/dsh-find-plugin',
      url: 'https://github.com/awesome-dsh-plugin/dsh-find-plugin',
      stars: 151,
      downloads: 2000,
      added: '2026-06-01',
      category: ['tools'],
      categoryLabel: '工具',
      desc: '让 agent 帮你从清单里找插件',
      caps: [{ id: 'fs-read', label: '读文件' }],
      redLines: [],
      install: 'dsh plugin --profile web add dsh-find-plugin',
    },
  ],
}

const EXEC_LINES = [
  { step: 'start', requestId: 'r1' },
  { step: 'plan', spec: 'dsh-find-plugin', blocked: [], summary: { block: 0 } },
  { step: 'backup', ok: true, files: ['package.json'], dir: 'D' },
  { step: 'install-start', spec: 'dsh-find-plugin', requestId: 'r1' },
  { step: 'install-state', phase: 'installing', attempt: { registry: 'https://registry.npmjs.org/', index: 1, total: 1 } },
  { step: 'log', stream: 'stdout', text: 'added 1 package' },
  { step: 'log', stream: 'stderr', text: 'warning: x' },
  { step: 'install-result', application: 'applied', warnings: ['w1'], output: 'ok' },
  { step: 'config', phase: 'after', id: 'find-dsh-plugin', ok: true },
  { step: 'verify', installed: true, spec: '0.4.0', duplicates: [] },
  { step: 'done', succeeded: true, spec: 'dsh-find-plugin', application: 'applied' },
]

const EXEC_BLOCK_LINES = [
  { step: 'start', requestId: 'r2' },
  { step: 'plan', spec: 'dsh-find-plugin', blocked: [], summary: { block: 0 } },
  { step: 'install-start', spec: 'dsh-find-plugin', requestId: 'r2' },
  { step: 'install-result', application: 'failed', error: { code: 'operation-error', message: 'pnpm blocked build scripts' } },
  { step: 'build-approval', pendingBuilds: ['cloudflared'], retry: false, message: '构建脚本未获批准，安装中止（依赖与配置已回滚）：cloudflared' },
  { step: 'verify', installed: false, duplicates: [] },
  { step: 'done', succeeded: false, application: 'failed', spec: 'dsh-find-plugin' },
]

const requests = []
const bodies = []
/** 1st execute → success, 2nd → dependency scripts blocked, later → success again. */
let executeCalls = 0
function streamOf(lines) {
  const payload = new TextEncoder().encode(lines.map(line => JSON.stringify(line)).join('\n') + '\n')
  let sent = false
  return {
    getReader() {
      return {
        async read() {
          if (sent) return { done: true, value: undefined }
          sent = true
          return { done: false, value: payload }
        },
      }
    },
  }
}
globalThis.fetch = async (url, init) => {
  requests.push(String(url))
  if (init?.body) {
    try {
      bodies.push({ url: String(url), body: JSON.parse(init.body) })
    } catch {
      /* a non-JSON body is not one of ours */
    }
  }
  if (String(url).endsWith('/catalog')) return { ok: true, status: 200, text: async () => JSON.stringify(CATALOG_PAYLOAD) }
  if (String(url).endsWith('/audit')) return { ok: true, status: 200, text: async () => JSON.stringify(AUDIT_PAYLOAD) }
  if (String(url).endsWith('/execute')) {
    const lines = executeCalls++ === 1 ? EXEC_BLOCK_LINES : EXEC_LINES
    return { ok: true, status: 200, body: streamOf(lines) }
  }
  if (String(url).endsWith('/cancel')) return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'not-running' }) }
  return { ok: false, status: 404, text: async () => 'not found' }
}

/* --- helpers --------------------------------------------------------------- */
/** Positional index of each useState in ReviewPage (hook order is part of the contract). */
const I = { tab: 0, target: 1, phase: 2, report: 3, proposals: 4, approved: 5, values: 6, logs: 7, error: 8, finalLine: 9, cat: 10, copied: 11, pendingBuilds: 12, suggestion: 13, amendText: 14, amendBadge: 15, agentTasks: 16, amendError: 17 }
const CATALOG_IDLE = {
  state: 'idle', entries: [], categories: [], total: 0, filtered: 0, offset: 0, limit: 25,
  q: '', category: '', sort: 'stars', generatedAt: undefined, source: undefined, stale: false, error: null,
}
function state(overrides = {}) {
  const base = ['audit', '', 'idle', null, [], {}, {}, [], null, null, { ...CATALOG_IDLE }]
  for (const [key, value] of Object.entries(overrides)) base[I[key]] = value
  return base
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
async function waitFor(predicate, label, timeoutMs = 3000) {
  const start = Date.now()
  for (;;) {
    if (predicate()) return true
    if (Date.now() - start > timeoutMs) {
      failures += 1
      console.log(`FAIL timeout: ${label}`)
      return false
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
function elements(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out)
    return out
  }
  if (node !== null && typeof node === 'object' && 'type' in node) {
    out.push(node)
    elements(node.props?.children, out)
  }
  return out
}
function childText(element) {
  const value = element.props?.children
  if (Array.isArray(value)) return String(value[0] ?? '')
  return String(value ?? '')
}
function buttonByLabel(tree, label) {
  return elements(tree).find(element => element.type === 'button' && childText(element).includes(label))
}
function fakeContext(registrations, dictionaries) {
  return {
    locale: {
      bind: ns => key => `${ns}:${key}`,
      register: (ns, dicts) => {
        dictionaries.push({ ns, keys: Object.keys(dicts) })
        return () => {}
      },
    },
    slots: {
      inject: (key, callback) => callback(),
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
}

/* --- load + register ------------------------------------------------------- */
await import('./client.js')
expect('factory captured', captured !== null, true)
expect('factory id', captured.id, '@local/dsh-install-review')

const registrations = []
const dictionaries = []
const module = captured.factory((name) => {
  if (name === 'react') return stubReact
  throw new Error(`unexpected require: ${name}`)
})
expect('client inject list', module.inject, ['slots', 'locale'])
module.apply(fakeContext(registrations, dictionaries))
expect('locale dictionaries', dictionaries, [{ ns: 'settings.install-review', keys: ['zh', 'en'] }])
expect('section registered', registrations.length, 1)
const section = registrations[0]
expect('section options', { id: section.options.id, name: section.options.name, order: section.options.order, locale: section.options.locale },
  { id: 'install-review', name: 'settings.section', order: 40, locale: 'settings.install-review' })
expect('section label resolves', section.options.label(), 'settings.install-review:nav')

function render(next) {
  current = next
  cursor = 0
  return section.component({ close: () => {}, t: key => `T:${key}` })
}

/* 1 · idle */
const idle = render(state())
expect('idle heading', elements(idle).some(element => element.type === 'h2' && childText(element) === 'T:nav'), true)
expect('idle audit button', buttonByLabel(idle, 'T:audit') !== undefined, true)
expect('tab bar has both tabs', [buttonByLabel(idle, 'T:tabAudit') !== undefined, buttonByLabel(idle, 'T:tabCatalog') !== undefined], [true, true])

/* 2 · report + proposals + logs + result */
const ready = render(state({
  target: 'dsh-find-plugin',
  phase: 'ready',
  report: AUDIT_PAYLOAD.report,
  proposals: AUDIT_PAYLOAD.proposals,
  approved: { version: true, 'profile-config': false },
  values: { version: { version: '0.4.0' }, 'profile-config': { config: '{}' } },
  logs: [{ tone: 'ok', text: '✓ 完成', raw: EXEC_LINES.at(-1) }],
  finalLine: { step: 'done', succeeded: true, spec: 'dsh-find-plugin', application: 'applied' },
}))
expect('ready checkbox count', elements(ready).filter(element => element.type === 'input' && element.props.type === 'checkbox').length, 2)
expect('ready textarea count (config + suggestion + amend)', elements(ready).filter(element => element.type === 'textarea').length, 3)
expect('ready log line', elements(ready).some(element => element.type === 'div' && childText(element) === '✓ 完成'), true)
expect('ready result banner', elements(ready).some(element => childText(element).includes('完成：dsh-find-plugin')), true)

/* 3 · blocking disables execute */
const blocked = render(state({
  target: 'dsh-find-plugin',
  phase: 'ready',
  report: { ...AUDIT_PAYLOAD.report, checks: [{ id: 'x', status: 'block', title: '阻断', detail: 'd' }], summary: { block: 1, warn: 0, pass: 0, info: 0 } },
  proposals: AUDIT_PAYLOAD.proposals,
}))
expect('blocked execute disabled', buttonByLabel(blocked, 'T:execute')?.props.disabled, true)
expect('blocked banner shown', elements(blocked).some(element => childText(element).includes('T:blockingTitle')), true)

/* 4 · audit round trip */
current = state({ target: 'dsh-find-plugin' })
cursor = 0
const auditTree = section.component({ close: () => {}, t: key => `T:${key}` })
const auditButton = buttonByLabel(auditTree, 'T:audit')
expect('audit button found', auditButton !== undefined, true)
auditButton.props.onClick()
await waitFor(() => current[I.phase] === 'ready', 'audit completes')
expect('audit request sent', requests.some(url => url.endsWith('/audit')), true)
expect('audit filled report', current[I.report]?.manifest?.name, 'dsh-find-plugin')
expect('audit proposals initialized', current[I.proposals].length, 2)
expect('audit approved defaults', current[I.approved], { version: false, 'profile-config': false })
expect('audit values prefilled', current[I.values].version, { version: '0.4.0' })

/* 5 · execute round trip (drives formatLine through every step) */
const executeTree = render(current)
const executeButton = buttonByLabel(executeTree, 'T:execute')
expect('execute button found', executeButton !== undefined, true)
expect('execute enabled', executeButton.props.disabled, false)
executeButton.props.onClick()
await waitFor(() => current[I.finalLine]?.step === 'done', 'execute completes')
expect('execute request sent', requests.some(url => url.endsWith('/execute')), true)
expect('logs captured', current[I.logs].length, EXEC_LINES.length)
expect('phase back to ready', current[I.phase], 'ready')

/* 5b · 「复制报告给我复核」— the chat-relay replacement for a built-in LLM */
const copyTree = render(current)
const copyButton = elements(copyTree).find(element => element.type === 'button' && childText(element).includes('T:copyReport'))
expect('copy button present with a report', copyButton !== undefined, true)
copyButton.props.onClick()
await waitFor(() => clipboardText !== null, 'clipboard write')
expect('copied report header', clipboardText.startsWith('# 安装审查报告：dsh-find-plugin'), true)
expect('copied report lists checks', clipboardText.includes('[pass] peer 兼容当前 DSH'), true)
expect('copied report asks for review', clipboardText.includes('请复核'), true)
expect('copied report masks the profile path', clipboardText.includes('C:\\Users\\<你>') && !clipboardText.includes('localtester'), true)
const renderedText = elements(render(current)).map(childText).join('\n')
expect('rendered report masks the profile path', renderedText.includes('C:\\Users\\<你>') && !renderedText.includes('localtester'), true)

/* 5c · dependency build scripts blocked → approve button → retry carries approvedBuilds (v5) */
const rerunButton = elements(render(current)).find(element => element.type === 'button' && childText(element).includes('T:execute'))
expect('execute re-enabled after a successful run', rerunButton?.props.disabled, false)
rerunButton.props.onClick()
await waitFor(() => current[I.finalLine]?.step === 'done' && current[I.finalLine]?.succeeded === false, 'blocked run finishes')
expect('blocked run recorded pendingBuilds', current[I.pendingBuilds], ['cloudflared'])
expect('blocked run keeps phase ready', current[I.phase], 'ready')
const blockedTree = render(current)
const approveButton = elements(blockedTree).find(element => element.type === 'button' && childText(element).includes('T:approveBuildsRetry'))
expect('approve-and-retry button appears', approveButton !== undefined, true)
expect('pending-build hint names the package', elements(blockedTree).some(element => childText(element).includes('待决：cloudflared')), true)
expect('pending-build hint key present', elements(blockedTree).some(element => childText(element).includes('T:pendingBuildsHint')), true)
approveButton.props.onClick()
await waitFor(() => current[I.finalLine]?.step === 'done' && current[I.finalLine]?.succeeded === true, 'approved retry succeeds')
const lastExecute = [...bodies].reverse().find(entry => entry.url.endsWith('/execute'))
expect('retry request carries approvedBuilds', lastExecute?.body?.approvedBuilds, ['cloudflared'])
expect('pendingBuilds cleared after success', current[I.pendingBuilds], [])

/* 5d · 「你的建议」随报告导出（plan + note 一起给会话） */
clipboardText = null
{
  const noted = state({
    target: 'dsh-find-plugin',
    phase: 'ready',
    report: AUDIT_PAYLOAD.report,
    proposals: AUDIT_PAYLOAD.proposals,
    approved: { version: true },
    values: { version: { version: '0.4.3' } },
    suggestion: '别固定版本，我更信默认 latest',
    agentTasks: ['装完把 LAN bind 保持 127.0.0.1'],
  })
  const tree = render(noted)
  const copyButton = elements(tree).find(element => element.type === 'button' && childText(element).includes('T:copyReport'))
  copyButton.props.onClick()
  await waitFor(() => clipboardText !== null, 'copied with plan')
  expect('export carries the plan section', clipboardText.includes('## T:planSection'), true)
  expect('export shows ticked proposal', clipboardText.includes('- [x] version：固定版本'), true)
  expect('export shows proposal values', clipboardText.includes('version=0.4.3'), true)
  expect('export carries my note', clipboardText.includes('## T:mySuggestionSection') && clipboardText.includes('别固定版本'), true)
  expect('export carries agent tasks', clipboardText.includes('装完把 LAN bind 保持 127.0.0.1'), true)
  expect('export asks for the amendment json', clipboardText.includes('install-review/amendments v1'), true)
}

/* 5e · 导入修订：改勾选、改参数、带建议与 agent 任务（同步，无需等待） */
{
  const AMEND = {
    $type: 'install-review/amendments',
    version: 1,
    target: 'dsh-find-plugin',
    approve: { version: true, 'profile-config': false },
    values: { version: { version: '0.4.2' } },
    suggestion: '按修订：固定到 0.4.2',
    agentTasks: ['装完把 LAN bind 保持 127.0.0.1'],
  }
  clipboardText = null
  const tree = render(state({
    target: 'dsh-find-plugin',
    phase: 'ready',
    report: AUDIT_PAYLOAD.report,
    proposals: AUDIT_PAYLOAD.proposals,
    amendText: JSON.stringify(AMEND),
  }))
  const applyButton = elements(tree).find(element => element.type === 'button' && childText(element).includes('T:applyAmend'))
  expect('apply-revision button present', applyButton !== undefined, true)
  applyButton.props.onClick()
  expect('revision flipped approvals', current[I.approved], { version: true, 'profile-config': false })
  expect('revision rewrote the value', current[I.values].version, { version: '0.4.2' })
  expect('revision carried the note', current[I.suggestion], '按修订：固定到 0.4.2')
  expect('revision carried agent tasks', current[I.agentTasks], ['装完把 LAN bind 保持 127.0.0.1'])
  expect('revision badge counts applied', current[I.amendBadge].includes('T:amendApplied'), true)
  expect('revision left no error', current[I.error], null)
  expect('revision box cleared', current[I.amendText], '')
}

/* 5f · 修订目标不匹配 → 拒绝且不改任何状态（错误就地显示，不打到页面顶部） */
{
  const WRONG = { $type: 'install-review/amendments', version: 1, target: 'someone-else', approve: { version: true } }
  const tree = render(state({
    target: 'dsh-find-plugin',
    phase: 'ready',
    report: AUDIT_PAYLOAD.report,
    proposals: AUDIT_PAYLOAD.proposals,
    amendText: JSON.stringify(WRONG),
  }))
  elements(tree).find(element => element.type === 'button' && childText(element).includes('T:applyAmend')).props.onClick()
  expect('mismatch rejected with a reason', current[I.amendError], 'T:amendTargetMismatch')
  expect('page-level error stays clean', current[I.error], null)
  expect('mismatch changed nothing', current[I.approved], {})
  expect('mismatch shows no badge', current[I.amendBadge], null)
  const afterError = render(current)
  expect('error is rendered next to the import box', elements(afterError).some(element => childText(element) === 'T:amendTargetMismatch'), true)
}

/* 5g · 贴错文档（把报告导出当成修订）→ 指路而非静默失败 */
{
  const tree = render(state({
    target: 'dsh-find-plugin',
    phase: 'ready',
    report: AUDIT_PAYLOAD.report,
    proposals: AUDIT_PAYLOAD.proposals,
    amendText: '# 安装审查报告：dsh-find-plugin\n## 当前方案（勾选与参数）\n请复核：能否安装 …（返回 install-review/amendments v1 JSON…）',
  }))
  elements(tree).find(element => element.type === 'button' && childText(element).includes('T:applyAmend')).props.onClick()
  expect('report paste explained', current[I.amendError], 'T:amendWrongDoc')
  expect('report paste changed nothing', current[I.approved], {})
}

/* 5h · 整段聊天回复（带代码块围栏）也能提取出修订 JSON */
{
  const payload = JSON.stringify({
    $type: 'install-review/amendments',
    version: 1,
    target: 'dsh-find-plugin',
    approve: { version: true },
  })
  const fenced = `这是我的修订：\n\`\`\`json\n${payload}\n\`\`\`\n以上请导入。`
  const tree = render(state({
    target: 'dsh-find-plugin',
    phase: 'ready',
    report: AUDIT_PAYLOAD.report,
    proposals: AUDIT_PAYLOAD.proposals,
    amendText: fenced,
  }))
  elements(tree).find(element => element.type === 'button' && childText(element).includes('T:applyAmend')).props.onClick()
  expect('fenced chat reply extracted', current[I.approved], { version: true })
  expect('fenced apply shows a badge', String(current[I.amendBadge]).includes('T:amendApplied'), true)
  expect('fenced apply leaves no error', current[I.amendError], null)
}

/* 6 · catalog tab: browse, then one-click send to audit */
const catalogTabButton = buttonByLabel(render(current), 'T:tabCatalog')
expect('catalog tab button found', catalogTabButton !== undefined, true)
catalogTabButton.props.onClick()
await waitFor(() => current[I.cat]?.state === 'ready', 'catalog loads')
expect('catalog request sent', requests.some(url => url.endsWith('/catalog')), true)
expect('catalog entries stored', current[I.cat].entries.length, 2)
const catalogTree = render(current)
expect('catalog rows rendered', elements(catalogTree).some(element => childText(element).includes('dshmarket')), true)
expect('catalog meta shows total', elements(catalogTree).some(element => childText(element).includes('T:catalogTotal')), true)
expect('catalog total stored', current[I.cat].total, 4377)
expect('catalog shows chinese description', elements(catalogTree).some(element => childText(element).includes('可视化插件市场')), true)
expect('catalog shows red line in chinese', elements(catalogTree).some(element => childText(element).includes('⚠ 会读密钥并且联网')), true)
expect('catalog shows capability chips', elements(catalogTree).some(element => childText(element) === '联网'), true)
expect('catalog shows install command', elements(catalogTree).some(element => childText(element).includes('dsh plugin --profile web add dshmarket')), true)
expect('catalog shows downloads', elements(catalogTree).some(element => childText(element).includes('↓30天 405580')), true)
expect('category option uses chinese label', elements(catalogTree).some(element => element.type === 'option' && childText(element) === '插件市场（80）'), true)
const selects = elements(catalogTree).filter(element => element.type === 'select')
expect('catalog has two selects', selects.length, 2)
expect('sort select has four options', Array.isArray(selects[1]?.props?.children) ? selects[1].props.children.length : -1, 4)
expect('catalog has search box', elements(catalogTree).some(element => element.type === 'input' && String(element.props.placeholder ?? '').includes('T:catalogSearchPh')), true)
expect('catalog has two selects', elements(catalogTree).filter(element => element.type === 'select').length, 2)
const auditThis = elements(catalogTree).find(element => element.type === 'button' && childText(element).includes('T:auditThis'))
expect('row has audit button', auditThis !== undefined, true)
auditThis.props.onClick()
await waitFor(() => current[I.report] !== null && current[I.tab] === 'audit', 'row audit completes')
expect('row audit switched tab', current[I.tab], 'audit')
expect('row audit filled target', current[I.target], 'dshmarket')
expect('row audit produced report', current[I.report]?.manifest?.name, 'dsh-find-plugin')

/* 7 · browser-quality server render bound to the real React */
const realReact = (await import(REACT_URL)).default
const realRegistrations = []
const realModule = captured.factory((name) => {
  if (name === 'react') return realReact
  throw new Error(`unexpected require: ${name}`)
})
realModule.apply(fakeContext(realRegistrations, []))
const markup = renderToStaticMarkup(realReact.createElement(realRegistrations[0].component, { close: () => {}, t: key => `T:${key}` }))
expect('ssr renders the page', markup.includes('T:nav') || markup.includes('安装审查'), true)
expect('ssr has the audit button', markup.includes('T:audit'), true)
expect('ssr has the catalog tab', markup.includes('T:tabCatalog'), true)

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
if (failures > 0) process.exitCode = 1
