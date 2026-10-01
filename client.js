/**
 * 安装审查面板（浏览器 half）：设置 → 安装审查。
 *
 * Two tabs:
 *   审查 — 输入目标 → 审查（报告 + 方案）→ 逐项勾选/编辑 → 批准并执行 → 流式日志 → 结果。
 *   清单 — browse the curated catalog (server-side search / category / sort /
 *          paging, so the 5MB document stays on the host), then send a row
 *          straight to 审查 with one click.
 *
 * Styling uses only --dsw-alias-* theme tokens; no Harness Client package is
 * imported (practices.md: a throwing host import blanks the slot entry).
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-install-review',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef } = React

    const NS = 'settings.install-review'
    /** Bound during Host-side apply; the component falls back to it if props are absent. */
    let translate = key => key

    const zh = {
      nav: '插件装前审查',
      subtitle: '先检查核对清单里的插件，再由你逐项批准改动，最后才安装。',
      tabAudit: '审查',
      tabCatalog: '清单',
      inputLabel: '插件目标',
      placeholder: 'npm 包名 / owner/repo / github:owner/repo / GitHub 链接',
      audit: '开始审查',
      auditing: '审查中…',
      reaudit: '重新审查',
      checksTitle: '检查结果',
      blockingTitle: '存在阻断项，安装按钮已禁用',
      suggestionsTitle: '改进建议（仅建议，不自动执行）',
      proposalsTitle: '改动方案（勾选才会执行）',
      noProposals: '没有可批准的改动；直接执行即按原样安装。',
      execute: '批准并执行',
      executing: '执行中…',
      cancelInstall: '取消安装',
      logTitle: '执行日志',
      emptyLog: '还没有执行记录',
      errorTitle: '出错',
      hintEnter: '回车即可开始审查',
      summary: '汇总',
      versionLabel: '版本号',
      configLabel: '配置 JSON',
      catalogSearch: '搜索清单',
      catalogSearchPh: '名称 / npm / 作者 / 描述 / 标签（空格分词，全部命中）',
      catalogAll: '全部分类',
      catalogSort: '排序',
      sortStars: '按星标',
      sortDownloads: '按 npm 下载',
      sortAdded: '按加入时间',
      sortName: '按名称',
      downloadsWindow: '下载量统计区间 {0} ~ {1}',
      catalogRefresh: '刷新清单',
      catalogLoading: '清单加载中…',
      catalogLoadingHint: '首次需下载约 5MB（20~80 秒），之后走本地缓存秒开。可先回「审查」页手动输入审查。',
      catalogEmpty: '没有匹配的插件。',
      catalogError: '清单加载失败',
      auditThis: '审查',
      openRepo: '打开仓库',
      pageInfo: '第 {0} / {1} 页',
      catalogTotal: '共 {0} 个插件',
      catalogFiltered: '匹配 {0}',
      catalogGenerated: '目录生成于 {0}',
      catalogStale: '（在线源失败，用的是旧缓存）',
      copyReport: '复制报告给我复核',
      copied: '✓ 已复制，粘贴到会话即可',
      copyFailed: '复制失败',
      approveBuildsRetry: '批准 {0} 的构建脚本并重试',
      pendingBuildsHint: '这些依赖要跑安装脚本（比如下载平台二进制），pnpm 默认拦截；批准 = 允许它们在这台机器上执行安装脚本。',
      yourSuggestion: '你的建议（会并入「报告+方案」一起复制，粘回会话让我出修订）',
      suggestPlaceholder: '例如：别固定版本 / 把 LAN bind 关掉 / 我更信 github 源 / 装完先别开远程…',
      importAmend: '导入修订',
      amendPlaceholder: '粘贴会话返回的修订 JSON（install-review/amendments v1）',
      applyAmend: '应用修订',
      amendApplied: '✓ 已采纳 {0} 处修订，方案已更新，复核后再批准',
      amendIgnored: '（{0} 个未知方案 id 被忽略）',
      agentTasks: '以下修订面板不执行，需要在会话里由 agent 完成：',
      planSection: '当前方案（勾选与参数）',
      mySuggestionSection: '我的建议',
      amendWrongDoc: '你粘的是「报告导出」，不是修订 —— 报告请粘到会话里给我，我返回的修订 JSON（install-review/amendments v1）再贴到这里。',
      amendBadJson: '不是合法 JSON：{0}',
      amendTypeBad: '修订格式不对：需要 $type = "install-review/amendments" 且 version = 1',
      amendTargetMismatch: '修订目标与当前报告不一致：报告 {0}，修订 {1}',
      amendValueBad: '字段值不合法：{0}',
      amendNoReport: '先跑一次审查，再导入修订。',
      catalogHint: '点右侧「审查」即填入左页并开始检查（11~12 项：11 项本机核对 + 清单收录时再加 1 项能力/红线）；本页只浏览，不安装。',
    }
    const en = {
      nav: 'Pre-install Review',
      subtitle: 'Audit a catalog plugin, approve each change, then install.',
      tabAudit: 'Audit',
      tabCatalog: 'Catalog',
      inputLabel: 'Plugin target',
      placeholder: 'npm name / owner/repo / github:owner/repo / GitHub URL',
      audit: 'Audit',
      auditing: 'Auditing…',
      reaudit: 'Re-audit',
      checksTitle: 'Checks',
      blockingTitle: 'Blocking findings — install is disabled',
      suggestionsTitle: 'Suggestions (advisory only)',
      proposalsTitle: 'Change proposals (ticked ones run)',
      noProposals: 'Nothing to approve; executing installs as-is.',
      execute: 'Approve & run',
      executing: 'Running…',
      cancelInstall: 'Cancel install',
      logTitle: 'Execution log',
      emptyLog: 'No run yet',
      errorTitle: 'Error',
      hintEnter: 'Press Enter to audit',
      summary: 'Summary',
      versionLabel: 'Version',
      configLabel: 'Config JSON',
      catalogSearch: 'Search catalog',
      catalogSearchPh: 'name / npm / owner / description / tags (space-separated, all must match)',
      catalogAll: 'All categories',
      catalogSort: 'Sort',
      sortStars: 'Stars',
      sortDownloads: 'Downloads',
      sortAdded: 'Added',
      sortName: 'Name',
      downloadsWindow: 'downloads counted {0} ~ {1}',
      catalogRefresh: 'Refresh',
      catalogLoading: 'Loading catalog…',
      catalogLoadingHint: 'The first load downloads ~5MB (20-80s); later opens use the local cache. You can audit a manual entry on the Audit tab meanwhile.',
      catalogEmpty: 'Nothing matches.',
      catalogError: 'Catalog failed to load',
      auditThis: 'Audit',
      openRepo: 'Open repo',
      pageInfo: 'Page {0} / {1}',
      catalogTotal: '{0} plugins',
      catalogFiltered: '{0} matched',
      catalogGenerated: 'generated {0}',
      catalogStale: '(offline: cached copy)',
      copyReport: 'Copy report for review',
      copied: '✓ Copied — paste it into the chat',
      copyFailed: 'Copy failed',
      approveBuildsRetry: 'Approve {0} build scripts & retry',
      pendingBuildsHint: 'These dependencies need their install scripts (e.g. downloading a platform binary); pnpm blocks them by default. Approving runs them on this machine.',
      yourSuggestion: 'Your note (exported with the report+plan — paste it into the chat for a revision)',
      suggestPlaceholder: 'e.g. do not pin the version / turn LAN bind off / trust the github source more…',
      importAmend: 'Import revision',
      amendPlaceholder: 'Paste the revision JSON from the chat (install-review/amendments v1)',
      applyAmend: 'Apply revision',
      amendApplied: '✓ {0} amendment(s) applied — plan updated, review before approving',
      amendIgnored: '({0} unknown proposal id(s) ignored)',
      agentTasks: 'These revisions the panel will not run; the agent must do them in the chat:',
      planSection: 'Current plan (ticked + values)',
      mySuggestionSection: 'My note',
      catalogHint: '“Audit” fills the Audit tab and runs the checks (11 host checks, plus capabilities/red-lines when the catalog lists it); this tab only browses.',
    }

    const STATUS = {
      block: { badge: '阻断', color: 'var(--dsw-alias-state-error-primary)' },
      warn: { badge: '警告', color: 'var(--dsw-alias-state-warn-primary)' },
      pass: { badge: '通过', color: 'var(--dsw-alias-state-success-primary)' },
      info: { badge: '信息', color: 'var(--dsw-alias-state-idle-primary)' },
    }

    const PAGE_SIZE = 25

    const token = {
      title: { color: 'var(--dsw-alias-label-primary)', fontSize: 16, fontWeight: 650, margin: '0 0 4px' },
      text: { color: 'var(--dsw-alias-label-primary)', fontSize: 13, lineHeight: 1.55 },
      muted: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12.5, lineHeight: 1.55 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12 },
      card: {
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        padding: '10px 12px',
      },
      field: {
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 6,
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        padding: '7px 10px',
      },
      divider: { border: 'none', borderTop: '1px solid var(--dsw-alias-border-l1)', margin: '14px 0' },
    }

    function buttonStyle(primary, disabled) {
      return {
        appearance: 'none',
        border: `1px solid ${primary ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
        background: primary ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-2)',
        color: primary ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-label-primary)',
        borderRadius: 6,
        padding: '6px 14px',
        fontSize: 13,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }
    }

    function tabStyle(active) {
      return {
        appearance: 'none',
        border: `1px solid ${active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'}`,
        background: active ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        borderRadius: 6,
        padding: '5px 16px',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
      }
    }

    function fill(template, value) {
      return String(template).replace('{0}', String(value))
    }

    function apiUrl(path) {
      return new URL(String(path).replace(/^\/+/, ''), document.baseURI).pathname
    }

    /**
     * One line the panel can show for a refusal: the host's `error`, its `hint`,
     * and the header summary it saw (`seen`) — v8 reports those on 401/403 so a
     * fence failure explains itself instead of just saying "失败".
     */
    function errorNote(status, text) {
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        return text.slice(0, 400) || `HTTP ${status}`
      }
      const seen = parsed.seen
      return [
        parsed.error ?? `HTTP ${status}`,
        parsed.hint,
        seen === undefined ? undefined : `看到 Host ${seen.host} / Origin ${seen.origin} / site ${seen.site} / cookie ${seen.cookie}`,
      ].filter(part => typeof part === 'string' && part !== '').join(' · ')
    }

    async function postJson(path, body) {
      const response = await fetch(apiUrl(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const text = await response.text()
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(text.slice(0, 400) || `HTTP ${response.status}`)
      }
      if (!response.ok) throw new Error(errorNote(response.status, text))
      return parsed
    }

    async function* streamLines(path, body) {
      const response = await fetch(apiUrl(path), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      if (!response.ok || !response.body) {
        const text = await response.text()
        throw new Error(errorNote(response.status, text))
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim()
          buffer = buffer.slice(index + 1)
          if (line === '') continue
          try {
            yield JSON.parse(line)
          } catch {
            /* a torn line is skipped rather than breaking the stream */
          }
        }
      }
    }

    /** One report line → display text plus a tone for colouring. */
    function formatLine(line) {
      switch (line.step) {
        case 'start':
          return { tone: 'muted', text: `▶ 开始 ${line.requestId}` }
        case 'plan':
          return { tone: 'muted', text: `· 方案：安装 ${line.spec}；阻断项 ${line.blocked?.length ?? 0}；配置阶段：${line.configPhase ?? '无'}` }
        case 'backup':
          return line.ok
            ? { tone: 'ok', text: `✓ 已备份 ${line.files.join('、')} → ${line.dir}` }
            : { tone: 'error', text: `✗ 备份失败：${line.error}` }
        case 'config':
          return line.ok
            ? { tone: 'ok', text: `✓ 配置写入 ${line.id}（${line.phase === 'after' ? '安装后' : '安装前'}）` }
            : { tone: 'error', text: `✗ 配置写入失败 ${line.id ?? ''}：${line.error ?? ''}` }
        case 'install-start':
          return { tone: 'muted', text: `▸ 安装 ${line.spec}` }
        case 'install-state': {
          const attempt = line.attempt ? `（${line.attempt.registry ?? 'pnpm 默认'}，${line.attempt.index}/${line.attempt.total}）` : ''
          return { tone: 'muted', text: `· ${line.phase}${attempt}` }
        }
        case 'log':
          return { tone: line.stream === 'stderr' ? 'error' : 'muted', text: String(line.text ?? '').replace(/\s+$/, '') }
        case 'install-result': {
          if (line.application === undefined) return { tone: 'muted', text: '· 安装结束' }
          const head = `安装结果：${line.application}`
          const detail = line.error ? `${line.error.message ?? line.error.code ?? ''}` : ''
          const warnings = line.warnings?.length ? `\n${line.warnings.join('\n')}` : ''
          const output = line.output ? `\n${line.output}` : ''
          const tone = ['applied', 'restart-required', 'overridden'].includes(line.application) ? 'ok' : 'error'
          return { tone, text: `${head}${detail ? ` — ${detail}` : ''}${warnings}${output}` }
        }
        case 'build-approval':
          if (line.approved === true) return { tone: 'ok', text: `✓ ${line.message}` }
          return { tone: line.retry ? 'warn' : 'error', text: `⚠ ${line.message}` }
        case 'verify':
          return {
            tone: line.duplicates?.length > 0 ? 'error' : 'ok',
            text: `${line.duplicates?.length > 0 ? '✗' : '✓'} profile ${line.installed ? '已写入' : '未写入'}${line.spec ? `（${line.spec}）` : ''}；重复 loader id：${line.duplicates?.length > 0 ? line.duplicates.join(', ') : '无'}`,
          }
        case 'done':
          return { tone: line.succeeded ? 'ok' : 'error', text: `${line.succeeded ? '✓ 完成' : '✗ 未完成'}（${line.application}）` }
        case 'error':
          return { tone: 'error', text: `✗ ${line.message}` }
        default:
          return { tone: 'muted', text: JSON.stringify(line) }
      }
    }

    function toneColor(tone) {
      if (tone === 'ok') return 'var(--dsw-alias-state-success-primary)'
      if (tone === 'error') return 'var(--dsw-alias-state-error-primary)'
      if (tone === 'warn') return 'var(--dsw-alias-state-warn-primary)'
      return 'var(--dsw-alias-label-secondary)'
    }

    /** Hide the local username before any path reaches the clipboard. */
    function mask(text) {
      return String(text ?? '').replace(/([A-Za-z]:\\Users\\)[^\\]+/g, '$1<你>')
    }

    /**
     * Pull the amendment object out of whatever the user pasted: a bare JSON
     * object, a ```json fenced block, or a whole chat reply that contains it.
     * @param text - pasted text.
     * @returns `{ payload }`, or `{ error }` when no parsable object was found.
     */
    function extractAmendment(text) {
      const trimmed = String(text ?? '').trim()
      if (trimmed.startsWith('{')) {
        try {
          return { payload: JSON.parse(trimmed) }
        } catch (error) {
          return { error: String(error?.message ?? error) }
        }
      }
      const marker = trimmed.indexOf('"install-review/amendments"')
      const start = marker < 0 ? -1 : trimmed.lastIndexOf('{', marker)
      if (start < 0) return { error: '未找到修订 JSON' }
      let depth = 0
      let inString = false
      let escaped = false
      for (let index = start; index < trimmed.length; index += 1) {
        const char = trimmed[index]
        if (inString) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') inString = false
          continue
        }
        if (char === '"') { inString = true; continue }
        if (char === '{') depth += 1
        else if (char === '}') {
          depth -= 1
          if (depth === 0) {
            try {
              return { payload: JSON.parse(trimmed.slice(start, index + 1)) }
            } catch (error) {
              return { error: String(error?.message ?? error) }
            }
          }
        }
      }
      return { error: '修订 JSON 括号不完整' }
    }

    /**
     * The report as one pasteable block: the panel itself never calls a model,
     * so the "second opinion" loop is 「copy → paste into the conversation」 —
     * the same pattern dsh-market uses for its AI-fix prompt, without shipping
     * an LLM client inside the panel.
     */
    function reportToText(report, plan = {}, labels = {}) {
      const lines = []
      lines.push(`# 安装审查报告：${report.target?.spec ?? ''}`)
      lines.push(`生成：${new Date().toISOString()}　运行时 DSH ${report.runtime?.version ?? '未知'}　profile：${mask(report.runtime?.profile ?? '')}`)
      const summary = report.summary ?? {}
      lines.push(`汇总：阻断 ${summary.block ?? 0} / 警告 ${summary.warn ?? 0} / 通过 ${summary.pass ?? 0} / 信息 ${summary.info ?? 0}`)
      if (report.manifest !== undefined) {
        lines.push(`manifest：${report.manifest.name}@${report.manifest.version}　bundle：${report.manifest.hasBundle ? report.manifest.bundlePatch : '无'}　安装期脚本：${Object.keys(report.manifest.scripts ?? {}).join('、') || '无'}`)
      }
      if (report.peerCheck?.status === 'bad') lines.push(`peer 不兼容：${JSON.stringify(report.peerCheck.peers)}（豁免：${report.peerCheck.exempted === true ? '是' : '否'}）`)
      const capabilities = report.capabilities ?? {}
      if ((capabilities.labels ?? []).length > 0) lines.push(`清单标注能力：${capabilities.labels.join('、')}`)
      for (const line of capabilities.redLines ?? []) lines.push(`清单标注红线：${line}`)
      lines.push('')
      lines.push('## 检查项')
      for (const item of report.checks ?? []) lines.push(`- [${item.status}] ${item.title}：${mask(item.detail ?? '')}`)
      if ((report.suggestions ?? []).length > 0) {
        lines.push('')
        lines.push('## 面板给出的建议（仅建议，未执行）')
        for (const line of report.suggestions) lines.push(`- ${mask(line)}`)
      }
      const proposalList = Array.isArray(plan.proposals) ? plan.proposals : []
      if (proposalList.length > 0) {
        lines.push('')
        lines.push(`## ${labels.plan ?? '当前方案（勾选与参数）'}`)
        for (const proposal of proposalList) {
          const ticked = plan.approved?.[proposal.id] === true ? 'x' : ' '
          const fields = (proposal.editable ?? [])
            .map(field => `${field.key}=${String(plan.values?.[proposal.id]?.[field.key] ?? field.value)}`)
            .join('，')
          lines.push(`- [${ticked}] ${proposal.id}：${proposal.title}${fields === '' ? '' : `　参数：${fields}`}`)
        }
      }
      const note = String(plan.suggestion ?? '').trim()
      if (note !== '') {
        lines.push('')
        lines.push(`## ${labels.suggestion ?? '我的建议'}`)
        lines.push(mask(note))
      }
      const tasks = Array.isArray(plan.agentTasks) ? plan.agentTasks : []
      if (tasks.length > 0) {
        lines.push('')
        lines.push('## 需 agent 在会话里完成（面板不执行）')
        for (const task of tasks) lines.push(`- ${mask(task)}`)
      }
      lines.push('')
      lines.push('请复核：能否安装 / 有什么风险 / 是否按我的建议修订方案（返回 install-review/amendments v1 JSON，我会导入面板）。')
      return lines.join('\n')
    }

    const CATALOG_IDLE = {
      state: 'idle',
      entries: [],
      categories: [],
      total: 0,
      filtered: 0,
      offset: 0,
      limit: PAGE_SIZE,
      q: '',
      category: '',
      sort: 'stars',
      generatedAt: undefined,
      source: undefined,
      stale: false,
      error: null,
    }

    function ReviewPage(props) {
      const t = props?.t ?? translate
      const [tab, setTab] = useState('audit')
      const [target, setTarget] = useState('')
      const [phase, setPhase] = useState('idle')
      const [report, setReport] = useState(null)
      const [proposals, setProposals] = useState([])
      const [approved, setApproved] = useState({})
      const [values, setValues] = useState({})
      const [logs, setLogs] = useState([])
      const [error, setError] = useState(null)
      const [finalLine, setFinalLine] = useState(null)
      const [cat, setCat] = useState(CATALOG_IDLE)
      /** Declared last so earlier hook indices (and their self-tests) stay stable. */
      const [copied, setCopied] = useState(false)
      /** Package names pnpm left undecided; non-empty = the approve-and-retry path. */
      const [pendingBuilds, setPendingBuilds] = useState([])
      /** The user's own note about the plan — travels with the copied report. */
      const [suggestion, setSuggestion] = useState('')
      /** Paste box for an agent-issued revision (install-review/amendments v1). */
      const [amendText, setAmendText] = useState('')
      const [amendBadge, setAmendBadge] = useState(null)
      /** Revisions the panel cannot execute itself; they ride to the chat. */
      const [agentTasks, setAgentTasks] = useState([])
      /** Inline error for the import box — kept next to the button, not at the page top. */
      const [amendError, setAmendError] = useState(null)
      const alive = useRef(true)
      const pollRef = useRef(null)
      const debounceRef = useRef(null)
      useEffect(() => () => {
        alive.current = false
        if (pollRef.current !== null) clearTimeout(pollRef.current)
        if (debounceRef.current !== null) clearTimeout(debounceRef.current)
      }, [])

      const busyAuditing = phase === 'auditing'
      const busyExecuting = phase === 'executing'
      const busy = busyAuditing || busyExecuting
      const blocking = (report?.checks ?? []).filter(item => item.status === 'block')
      const canExecute = !busy && report !== null && blocking.length === 0

      async function startAudit(explicit) {
        const rawTarget = String(explicit ?? target).trim()
        if (rawTarget === '' || busy) return
        setTarget(rawTarget)
        setPhase('auditing')
        setError(null)
        setReport(null)
        setProposals([])
        setLogs([])
        setFinalLine(null)
        try {
          const response = await postJson('dsh-install-review/audit', { target: rawTarget })
          if (!alive.current) return
          const list = response.proposals ?? []
          setReport(response.report)
          setProposals(list)
          setApproved(Object.fromEntries(list.map(proposal => [proposal.id, proposal.defaultOn === true])))
          setValues(Object.fromEntries(list.map(proposal => [
            proposal.id,
            Object.fromEntries((proposal.editable ?? []).map(field => [field.key, field.value])),
          ])))
          setPhase('ready')
        } catch (reason) {
          if (!alive.current) return
          setError(String(reason?.message ?? reason))
          setPhase('idle')
        }
      }

      async function runExecution(extra) {
        if (!canExecute) return
        const approvedBuilds = Array.isArray(extra?.approvedBuilds) ? extra.approvedBuilds : []
        setPhase('executing')
        setError(null)
        setLogs([])
        setFinalLine(null)
        setPendingBuilds([])
        try {
          const stream = streamLines('dsh-install-review/execute', {
            rawTarget: target.trim(),
            approved: proposals.filter(proposal => approved[proposal.id] === true).map(proposal => proposal.id),
            values,
            ...(approvedBuilds.length > 0 ? { approvedBuilds } : {}),
          })
          for await (const line of stream) {
            if (!alive.current) return
            setLogs(previous => [...previous, { ...formatLine(line), raw: line }])
            if (line.step === 'build-approval' && line.retry === false && line.approved !== true
              && Array.isArray(line.pendingBuilds) && line.pendingBuilds.length > 0) {
              setPendingBuilds(line.pendingBuilds)
            }
            if (line.step === 'done' || line.step === 'error') setFinalLine(line)
            if (line.step === 'done' && line.succeeded === true) setPendingBuilds([])
          }
          if (alive.current) setPhase('ready')
        } catch (reason) {
          if (!alive.current) return
          setError(String(reason?.message ?? reason))
          setPhase('ready')
        }
      }

      async function cancelInstall() {
        try {
          await postJson('dsh-install-review/cancel', {})
        } catch (reason) {
          if (alive.current) setError(String(reason?.message ?? reason))
        }
      }

      async function copyReport() {
        if (report === null) return
        const text = reportToText(
          report,
          { proposals, approved, values, suggestion, agentTasks },
          { plan: t('planSection'), suggestion: t('mySuggestionSection') },
        )
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text)
          } else {
            const area = document.createElement('textarea')
            area.value = text
            document.body.appendChild(area)
            area.select()
            document.execCommand('copy')
            area.remove()
          }
          if (!alive.current) return
          setCopied(true)
          setTimeout(() => { if (alive.current) setCopied(false) }, 2500)
        } catch (reason) {
          if (alive.current) setError(`${t('copyFailed')}：${String(reason?.message ?? reason)}`)
        }
      }

      /**
       * Apply an agent-issued revision (`install-review/amendments` v1): flip
       * tick boxes, rewrite editable values, carry the user's note, and surface
       * the tasks the panel cannot execute itself. Only the four executable
       * proposal kinds exist, so a revision can re-weight them but never invent
       * a new kind of change — anything else rides to the chat as `agentTasks`.
       *
       * Failures land in `amendError`, rendered directly under this box: the
       * page-level error banner sits far above (2026-09-28 the user pasted the
       * report export here, clicked apply, and saw "no reaction" because the
       * red banner was off-screen).
       */
      function applyAmendments() {
        setAmendBadge(null)
        setAmendError(null)
        if (report === null) {
          setAmendError(t('amendNoReport'))
          return
        }
        const extracted = extractAmendment(amendText)
        if (extracted.payload === undefined) {
          if (/安装审查报告|## 当前方案|请复核：/.test(amendText)) {
            setAmendError(t('amendWrongDoc'))
          } else {
            setAmendError(fill(t('amendBadJson'), String(extracted.error ?? '').replace(/^json:/, '')))
          }
          return
        }
        const payload = extracted.payload
        if (payload?.$type !== 'install-review/amendments' || payload?.version !== 1) {
          setAmendError(t('amendTypeBad'))
          return
        }
        const targetSpec = report.target?.spec ?? ''
        if (typeof payload.target === 'string' && payload.target !== '' && payload.target !== targetSpec) {
          setAmendError(t('amendTargetMismatch').replace('{0}', targetSpec).replace('{1}', String(payload.target)))
          return
        }
        const known = new Set(proposals.map(proposal => proposal.id))
        const ignored = []
        let applied = 0
        const nextApproved = { ...approved }
        const nextValues = { ...values }
        for (const [id, ticked] of Object.entries(payload.approve ?? {})) {
          if (!known.has(id)) { ignored.push(id); continue }
          nextApproved[id] = ticked === true
          applied += 1
        }
        for (const [id, fields] of Object.entries(payload.values ?? {})) {
          if (!known.has(id)) { ignored.push(id); continue }
          if (typeof fields !== 'object' || fields === null) continue
          const next = { ...(nextValues[id] ?? {}) }
          for (const [key, value] of Object.entries(fields)) {
            if (key === 'version') {
              const textValue = String(value)
              if (!/^[0-9A-Za-z.+-]{1,64}$/.test(textValue)) {
                setAmendError(fill(t('amendValueBad'), `version=${textValue}`))
                return
              }
              next[key] = textValue
              applied += 1
            } else if (key === 'config') {
              let parsed
              try {
                parsed = JSON.parse(String(value))
              } catch (reason) {
                setAmendError(fill(t('amendValueBad'), `config 不是合法 JSON（${String(reason?.message ?? reason)}）`))
                return
              }
              if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                setAmendError(fill(t('amendValueBad'), 'config 必须是 JSON 对象'))
                return
              }
              next[key] = JSON.stringify(parsed, null, 2)
              applied += 1
            } else {
              next[key] = value
              applied += 1
            }
          }
          nextValues[id] = next
        }
        setApproved(nextApproved)
        setValues(nextValues)
        if (typeof payload.suggestion === 'string' && payload.suggestion.trim() !== '') {
          setSuggestion(payload.suggestion)
          applied += 1
        }
        if (Array.isArray(payload.agentTasks)) {
          setAgentTasks(payload.agentTasks.filter(task => typeof task === 'string' && task.trim() !== ''))
        }
        setAmendBadge(`${fill(t('amendApplied'), applied)}${ignored.length > 0 ? `　${fill(t('amendIgnored'), ignored.length)}` : ''}`)
        setAmendText('')
      }

      function schedulePoll(params, delay) {
        if (!alive.current) return
        if (pollRef.current !== null) clearTimeout(pollRef.current)
        pollRef.current = setTimeout(() => {
          pollRef.current = null
          void loadCatalog(params)
        }, delay ?? 1500)
      }

      async function loadCatalog(params) {
        const body = { limit: PAGE_SIZE, q: '', category: '', sort: 'stars', offset: 0, ...params }
        setCat(previous => ({ ...previous, ...body, state: 'loading' }))
        try {
          const response = await postJson('dsh-install-review/catalog', body)
          if (!alive.current) return
          if (response.state === 'error') {
            setCat(previous => ({ ...previous, ...body, state: 'error', error: response.error ?? null }))
            return
          }
          if (response.state !== 'ready') {
            setCat(previous => ({ ...previous, ...body, state: 'loading', error: response.error ?? null }))
            schedulePoll(body)
            return
          }
          setCat(previous => ({ ...previous, ...body, ...response, state: 'ready', error: response.error ?? null }))
        } catch (reason) {
          if (!alive.current) return
          setCat(previous => ({ ...previous, ...body, state: 'error', error: String(reason?.message ?? reason) }))
        }
      }

      function searchChanged(value) {
        setCat(previous => ({ ...previous, q: value }))
        if (debounceRef.current !== null) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null
          void loadCatalog({ q: value, category: cat.category, sort: cat.sort, offset: 0 })
        }, 350)
      }

      function openTab(next) {
        setTab(next)
        if (next === 'catalog' && cat.state === 'idle') void loadCatalog({ q: cat.q, category: cat.category, sort: cat.sort, offset: 0 })
      }

      function toggle(proposalId, checked) {
        setApproved(previous => ({ ...previous, [proposalId]: checked }))
      }

      function editValue(proposalId, key, value) {
        setValues(previous => ({ ...previous, [proposalId]: { ...(previous[proposalId] ?? {}), [key]: value } }))
      }

      const summary = report?.summary ?? {}
      const summaryText = [`阻断 ${summary.block ?? 0}`, `警告 ${summary.warn ?? 0}`, `通过 ${summary.pass ?? 0}`, `信息 ${summary.info ?? 0}`].join('　')

      /* ------------------------------------------------------------- audit tab */
      const auditBody = [
        h('div', { key: 'input', style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('input', {
            value: target,
            onChange: event => setTarget(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') void startAudit() },
            placeholder: t('placeholder'),
            'aria-label': t('inputLabel'),
            style: { ...token.field, flex: 1 },
          }),
          h('button', { type: 'button', onClick: () => void startAudit(), disabled: busyAuditing || target.trim() === '', style: buttonStyle(true, busyAuditing || target.trim() === '') },
            busyAuditing ? t('auditing') : (report === null ? t('audit') : t('reaudit')))),

        h('div', { key: 'hint', style: token.muted }, t('hintEnter')),

        error === null ? null : h('div', { key: 'err', style: { ...token.card, borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' } },
          `${t('errorTitle')}：${error}`),

        report === null ? null : h('div', { key: 'report', style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 } },
            h('div', { style: { ...token.text, fontWeight: 600 } }, t('checksTitle')),
            h('div', { style: token.muted }, `${summaryText}　·　${report.target?.spec ?? ''}`)),

          blocking.length === 0 ? null : h('div', { style: { ...token.card, borderColor: 'var(--dsw-alias-state-error-primary)' } },
            h('div', { style: { ...token.text, color: 'var(--dsw-alias-state-error-primary)', fontWeight: 600 } }, t('blockingTitle')),
            ...blocking.map(item => h('div', { key: item.id, style: { ...token.muted, marginTop: 4 } }, `· ${item.title}：${mask(item.detail ?? '')}`))),

          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            ...report.checks.map((item) => {
              const meta = STATUS[item.status] ?? STATUS.info
              return h('div', { key: item.id, style: { ...token.card, display: 'flex', gap: 10, alignItems: 'flex-start' } },
                h('span', { style: { ...meta.color ? { color: meta.color } : {}, fontSize: 11.5, fontWeight: 700, minWidth: 34, paddingTop: 2, flexShrink: 0 } }, meta.badge),
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', { style: { ...token.text, fontWeight: 600 } }, item.title),
                  h('div', { style: token.muted }, mask(item.detail ?? '')),
                  item.evidence ? h('div', { style: { ...token.muted, ...token.mono } }, mask(item.evidence)) : null))
            })),

          (report.suggestions ?? []).length === 0 ? null : h('div', { style: token.card },
            h('div', { style: { ...token.text, fontWeight: 600, marginBottom: 4 } }, t('suggestionsTitle')),
            ...report.suggestions.map((text, index) => h('div', { key: index, style: token.muted }, `· ${text}`)))),

        h('div', { key: 'proposals', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { style: { ...token.text, fontWeight: 600 } }, t('proposalsTitle')),
          proposals.length === 0 ? h('div', { style: token.muted }, t('noProposals')) : null,
          ...proposals.map(proposal => h('label', { key: proposal.id, style: { ...token.card, display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' } },
            h('input', {
              type: 'checkbox',
              checked: approved[proposal.id] === true,
              onChange: event => toggle(proposal.id, event.target.checked),
              style: { marginTop: 3, flexShrink: 0 },
            }),
            h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 } },
              h('div', { style: { ...token.text, fontWeight: 600 } }, proposal.title),
              proposal.detail ? h('div', { style: token.muted }, proposal.detail) : null,
              proposal.risk ? h('div', { style: { ...token.muted, color: 'var(--dsw-alias-state-warn-primary)' } }, `风险：${proposal.risk}`) : null,
              ...(proposal.editable ?? []).map(field => h('div', { key: field.key, style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 } },
                h('div', { style: token.muted }, field.label),
                field.multiline === true
                  ? h('textarea', {
                    value: values[proposal.id]?.[field.key] ?? '',
                    onChange: event => editValue(proposal.id, field.key, event.target.value),
                    rows: 5,
                    spellCheck: false,
                    style: { ...token.field, ...token.mono, width: '100%', resize: 'vertical' },
                  })
                  : h('input', {
                    value: values[proposal.id]?.[field.key] ?? '',
                    onChange: event => editValue(proposal.id, field.key, event.target.value),
                    spellCheck: false,
                    style: { ...token.field, ...token.mono, width: '100%' },
                  })))))),

        report === null ? null : h('div', { key: 'suggestion', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { style: { ...token.text, fontWeight: 600 } }, t('yourSuggestion')),
          h('textarea', {
            value: suggestion,
            onChange: event => setSuggestion(event.target.value),
            placeholder: t('suggestPlaceholder'),
            'aria-label': t('yourSuggestion'),
            rows: 3,
            spellCheck: false,
            style: { ...token.field, ...token.mono, width: '100%', resize: 'vertical' },
          })),

        report === null ? null : h('div', { key: 'amend', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { style: { ...token.text, fontWeight: 600 } }, t('importAmend')),
          h('textarea', {
            value: amendText,
            onChange: event => setAmendText(event.target.value),
            placeholder: t('amendPlaceholder'),
            'aria-label': t('amendPlaceholder'),
            rows: 4,
            spellCheck: false,
            style: { ...token.field, ...token.mono, width: '100%', resize: 'vertical' },
          }),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
            h('button', {
              type: 'button',
              onClick: () => applyAmendments(),
              disabled: amendText.trim() === '',
              style: buttonStyle(false, amendText.trim() === ''),
            }, t('applyAmend')),
            amendBadge === null ? null : h('span', { style: { ...token.muted, color: 'var(--dsw-alias-state-success-primary)' } }, amendBadge)),
          amendError === null ? null : h('div', {
            style: {
              ...token.muted,
              color: 'var(--dsw-alias-state-error-primary)',
              border: '1px solid var(--dsw-alias-state-error-primary)',
              borderRadius: 6,
              padding: '6px 10px',
            },
          }, amendError),
          agentTasks.length === 0 ? null : h('div', { style: { ...token.card, borderColor: 'var(--dsw-alias-state-warn-primary)', marginTop: 4 } },
            h('div', { style: { ...token.text, fontWeight: 600, color: 'var(--dsw-alias-state-warn-primary)' } }, t('agentTasks')),
            ...agentTasks.map((task, index) => h('div', { key: index, style: token.muted }, `· ${task}`)))),

        h('div', { key: 'actions', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('button', { type: 'button', onClick: () => void runExecution(), disabled: !canExecute, style: buttonStyle(true, !canExecute) },
            busyExecuting ? t('executing') : t('execute')),
          busyExecuting
            ? h('button', { type: 'button', onClick: () => void cancelInstall(), style: buttonStyle(false, false) }, t('cancelInstall'))
            : null,
          report === null ? null : h('button', { type: 'button', onClick: () => void copyReport(), disabled: busyExecuting, style: buttonStyle(false, busyExecuting) },
            copied ? t('copied') : t('copyReport')),
          pendingBuilds.length > 0
            ? h('button', {
              type: 'button',
              disabled: busy,
              onClick: () => void runExecution({ approvedBuilds: pendingBuilds }),
              style: buttonStyle(true, busy),
            }, fill(t('approveBuildsRetry'), pendingBuilds.join('、')))
            : null,
          report === null ? null : h('span', { style: token.muted }, blocking.length > 0 ? t('blockingTitle') : (busyExecuting ? '安装进行中，请勿关闭页面' : '执行会先备份 profile，再按批准的方案改动并安装'))),

        h('div', { key: 'log', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { style: { ...token.text, fontWeight: 600 } }, t('logTitle')),
          h('div', {
            style: {
              ...token.card,
              ...token.mono,
              maxHeight: 300,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              minHeight: 54,
            },
          },
          logs.length === 0
            ? h('span', { style: token.muted }, t('emptyLog'))
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              ...logs.map((entry, index) => h('div', { key: index, style: { color: toneColor(entry.tone) } }, entry.text)))),
          pendingBuilds.length === 0 ? null : h('div', { key: 'pending', style: { ...token.muted, color: 'var(--dsw-alias-state-warn-primary)', marginTop: 6 } },
            `${t('pendingBuildsHint')}（待决：${pendingBuilds.join('、')}）`)),

        finalLine === null || finalLine.step !== 'done' ? null : h('div', {
          key: 'result',
          style: {
            ...token.card,
            borderColor: finalLine.succeeded ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)',
          },
        },
        h('div', { style: { ...token.text, fontWeight: 600 } },
          finalLine.succeeded ? `完成：${finalLine.spec}` : `未完成：${finalLine.error ?? finalLine.application}`),
        finalLine.application === 'restart-required'
          ? h('div', { style: token.muted }, '宿主层改动需要重启 dsh web 才生效（重启会中断当前会话，请自行选择时机）。')
          : null)),
      ]

      /* ------------------------------------------------------------ catalog tab */
      const pageCount = Math.max(1, Math.ceil((cat.filtered || 0) / (cat.limit || PAGE_SIZE)))
      const pageNumber = Math.floor((cat.offset || 0) / (cat.limit || PAGE_SIZE)) + 1
      const metaText = [
        fill(t('catalogTotal'), cat.total),
        cat.filtered !== cat.total ? fill(t('catalogFiltered'), cat.filtered) : '',
        cat.generatedAt ? fill(t('catalogGenerated'), String(cat.generatedAt).slice(0, 10)) : '',
        cat.downloadsWindow ? t('downloadsWindow').replace('{0}', String(cat.downloadsWindow.start)).replace('{1}', String(cat.downloadsWindow.end)) : '',
        cat.stale ? t('catalogStale') : '',
      ].filter(Boolean).join('　')

      function gotoPage(nextPage) {
        const offset = Math.max(0, (nextPage - 1) * (cat.limit || PAGE_SIZE))
        void loadCatalog({ q: cat.q, category: cat.category, sort: cat.sort, offset })
      }

      const catalogBody = [
        h('div', { key: 'cat-hint', style: token.muted }, t('catalogHint')),

        h('div', { key: 'cat-meta', style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
          h('span', { style: token.muted }, cat.state === 'idle' ? '—' : metaText),
          h('button', {
            type: 'button',
            disabled: cat.state === 'loading',
            onClick: () => void loadCatalog({ q: cat.q, category: cat.category, sort: cat.sort, offset: 0, refresh: true }),
            style: buttonStyle(false, cat.state === 'loading'),
          }, t('catalogRefresh'))),

        h('div', { key: 'cat-controls', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          h('input', {
            value: cat.q,
            onChange: event => searchChanged(event.target.value),
            placeholder: t('catalogSearchPh'),
            'aria-label': t('catalogSearch'),
            style: { ...token.field, flex: '1 1 240px', minWidth: 0 },
          }),
          h('select', {
            value: cat.category,
            'aria-label': t('catalogAll'),
            onChange: event => void loadCatalog({ q: cat.q, category: event.target.value, sort: cat.sort, offset: 0 }),
            style: { ...token.field, flex: '0 1 190px' },
          },
          h('option', { value: '' }, t('catalogAll')),
          ...cat.categories.map(item => h('option', { key: item.id, value: item.id }, `${item.label ?? item.id}（${item.count}）`))),
          h('select', {
            value: cat.sort,
            'aria-label': t('catalogSort'),
            onChange: event => void loadCatalog({ q: cat.q, category: cat.category, sort: event.target.value, offset: 0 }),
            style: { ...token.field, flex: '0 0 130px' },
          },
          h('option', { value: 'stars' }, t('sortStars')),
          h('option', { value: 'downloads' }, t('sortDownloads')),
          h('option', { value: 'added' }, t('sortAdded')),
          h('option', { value: 'name' }, t('sortName')))),

        cat.state === 'loading'
          ? h('div', { key: 'cat-loading', style: token.card },
            h('div', { style: { ...token.text, fontWeight: 600 } }, t('catalogLoading')),
            h('div', { style: token.muted, marginTop: 4 }, t('catalogLoadingHint')),
            cat.error ? h('div', { style: { ...token.muted, marginTop: 4 } }, String(cat.error)) : null)
          : cat.state === 'error'
            ? h('div', { key: 'cat-error', style: { ...token.card, borderColor: 'var(--dsw-alias-state-error-primary)' } },
              h('div', { style: { ...token.text, color: 'var(--dsw-alias-state-error-primary)', fontWeight: 600 } }, t('catalogError')),
              h('div', { style: token.muted, marginTop: 4 }, String(cat.error ?? '')))
            : cat.entries.length === 0
              ? h('div', { key: 'cat-empty', style: token.card }, h('span', { style: token.muted }, t('catalogEmpty')))
              : h('div', { key: 'cat-rows', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                ...cat.entries.map(entry => h('div', { key: String(entry.key ?? entry.url ?? entry.name), style: { ...token.card, display: 'flex', gap: 10, alignItems: 'flex-start' } },
                  h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 } },
                    h('div', { style: { ...token.text, fontWeight: 600 } },
                      String(entry.name ?? '（未命名）'),
                      typeof entry.stars === 'number' ? h('span', { style: { ...token.muted, fontWeight: 400, marginLeft: 8 } }, `★ ${entry.stars}`) : null,
                      typeof entry.downloads === 'number' ? h('span', { style: { ...token.muted, fontWeight: 400, marginLeft: 6 } }, `↓30天 ${entry.downloads}`) : null,
                      entry.categoryLabel ? h('span', { style: { ...token.muted, fontWeight: 400, marginLeft: 6 } }, `［${entry.categoryLabel}］`) : null),
                    h('div', { style: { ...token.muted, ...token.mono, wordBreak: 'break-all' } },
                      [entry.npm, entry.repoPath].filter(Boolean).join('　·　') || String(entry.url ?? '')),
                    entry.desc ? h('div', { style: token.muted }, entry.desc) : null,
                    (entry.caps ?? []).length === 0 ? null : h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                      ...entry.caps.map(cap => h('span', { key: cap.id, style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 999, padding: '1px 8px' } }, cap.label))),
                    (entry.redLines ?? []).length === 0 ? null : h('div', { style: { ...token.muted, color: 'var(--dsw-alias-state-warn-primary)', marginTop: 2 } },
                      ...entry.redLines.map((line, index) => h('div', { key: index }, `⚠ ${line}`))),
                    entry.install ? h('div', { style: { ...token.muted, ...token.mono, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, entry.install) : null),
                  h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 } },
                    h('button', {
                      type: 'button',
                      disabled: busy,
                      onClick: () => {
                        const spec = entry.npm || (entry.owner && entry.repo ? `${entry.owner}/${entry.repo}` : entry.url ?? entry.id ?? '')
                        if (spec === '') return
                        setTab('audit')
                        void startAudit(spec)
                      },
                      style: buttonStyle(true, busy),
                    }, t('auditThis')),
                    entry.url
                      ? h('a', {
                        href: entry.url,
                        target: '_blank',
                        rel: 'noreferrer noopener',
                        style: { ...token.muted, fontSize: 12, textAlign: 'center', textDecoration: 'none' },
                      }, t('openRepo'))
                      : null)))),

        cat.state === 'ready' && (cat.filtered ?? 0) > 0
          ? h('div', { key: 'cat-pager', style: { display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' } },
            h('button', { type: 'button', disabled: pageNumber <= 1, onClick: () => gotoPage(pageNumber - 1), style: buttonStyle(false, pageNumber <= 1) }, '←'),
            h('span', { style: token.muted }, fill(t('pageInfo'), `${pageNumber} / ${pageCount}`)),
            h('button', { type: 'button', disabled: pageNumber >= pageCount, onClick: () => gotoPage(pageNumber + 1), style: buttonStyle(false, pageNumber >= pageCount) }, '→'))
          : null,
      ]

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 2px 24px', maxWidth: 860 } },
        h('div', null,
          h('h2', { style: token.title }, t('nav')),
          h('div', { style: token.muted }, t('subtitle'))),

        h('div', { style: { display: 'flex', gap: 6 } },
          h('button', { type: 'button', onClick: () => openTab('audit'), style: tabStyle(tab === 'audit') }, t('tabAudit')),
          h('button', { type: 'button', onClick: () => openTab('catalog'), style: tabStyle(tab === 'catalog') }, t('tabCatalog'))),

        ...(tab === 'audit' ? auditBody : catalogBody),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        translate = t
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'install-review: dictionaries')
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'install-review',
          order: 40,
          label: () => t('nav'),
          locale: NS,
        }, ReviewPage))
      },
    }
  },
})
