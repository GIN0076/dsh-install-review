/**
 * Turn an audit report into approval-gated change proposals.
 *
 * Every proposal is configuration- or source-level: choosing the install spec,
 * pinning a version, approving build scripts the official pendingBuilds flow
 * reports, or writing the target's profile `config:` row through `configEditor`.
 * None of them edits third-party plugin code — that boundary is deliberate.
 *
 * v2 (2026-10-01, user decision 「要给一个『我接受风险，照样装』的按钮」): a
 * blocked report is no longer a dead end. `exemption` grants the host's own
 * exact-version exemption for the pair the audit found (`setVersionExemption`,
 * honoured by `app-boot` before any plugin loads), `revoke-exemption` takes it
 * back, and a proposal may declare `resolves: [checkId]` so the panel can tell
 * a resolved block from a still-blocking one. Proposals that carry risk the user
 * must read first declare `acknowledge: { label }` — the panel refuses to tick
 * them until that box is ticked by a human (an agent-issued revision cannot
 * bypass it either). `blockingChecks` is unchanged in meaning.
 *
 * v3 (2026-10-01, user decision 「这些都做吧」): three more proposals, all still
 * configuration- or install-channel level — `registry` (pin the install source
 * for this run), `rows` (turn on the rows the target declares but the loader is
 * not running), `upgrade` (update an installed plugin while leaving its existing
 * profile config alone). The config proposal now starts from
 * `report.configTemplate` — the target's own `config:` defaults out of its
 * bundle patch, merged with what the profile already has — instead of `{}`.
 */

/**
 * The blocking checks that keep the install button disabled.
 * @param report - audit report from `runAudit`.
 * @returns the blocking check rows.
 */
export function blockingChecks(report) {
  return (report?.checks ?? []).filter(item => item.status === 'block')
}

/**
 * Build the proposal list for one report.
 * @param report - audit report from `runAudit`.
 * @returns proposal descriptors the panel renders as checkboxes.
 */
export function buildProposals(report) {
  const proposals = []
  const target = report.target ?? {}
  const manifest = report.manifest ?? {}
  const catalogNpm = report.catalog?.entry?.npm

  if (target.kind === 'git' && typeof catalogNpm === 'string' && catalogNpm !== '') {
    proposals.push({
      id: 'source',
      kind: 'source',
      npmName: catalogNpm,
      title: `改用 npm 预构建包 ${catalogNpm}`,
      detail: '从 GitHub 源装会拉整仓库并可能触发构建脚本；npm 包是作者预构建的产物，安装更快、不跑脚本。',
      risk: '同名 npm 包可能由别人发布。装前请核对 npm 包的 repository 指回同一个仓库。',
      defaultOn: false,
    })
  }

  const enginesBlocked = (report.checks ?? []).some(item => item.id === 'engines' && item.status === 'block')
  const update = report.update
  if (update?.available === true && typeof update.latest === 'string') {
    proposals.push({
      id: 'upgrade',
      kind: 'upgrade',
      title: `更新到 ${update.latest}（保留你现在的配置）`,
      detail: `profile 里现在装的是 ${update.installedSpec}，上游最新是 ${update.latest}。更新只改依赖版本，**不会动你现有的 profile 配置**（配置行原样保留）；装完会核对版本真的换了、行有没有激活。`,
      risk: '新版可能带来行为变化；若它改过配置键结构，旧的配置值可能被 Loader 拒绝（那时改回来即可）。',
      defaultOn: false,
      editable: [{ key: 'version', label: '目标版本', value: update.latest }],
    })
  }
  if (target.kind === 'registry' && typeof manifest.version === 'string' && (target.pin === undefined || enginesBlocked)
    && update?.available !== true) {
    proposals.push({
      id: 'version',
      kind: 'version',
      title: enginesBlocked ? '改用满足 engines 的版本（写版本号）' : `固定版本（当前 latest ${manifest.version}）`,
      detail: enginesBlocked
        ? '当前版本的 engines.dsh 不覆盖本机 DSH。改填一个满足该范围的版本号，或按阻断条上的确认继续装。'
        : '写成 包名@版本号 安装，避免安装窗口期上游发了新版。',
      risk: '固定到旧版可能错过修复；写错版本号安装会失败并回滚。',
      defaultOn: false,
      editable: [{ key: 'version', label: '版本号', value: target.pin ?? manifest.version }],
    })
  }

  // Install source: the install itself walks configured -> fallbacks, so this is
  // for the case where every configured one failed and the user wants to pin a
  // specific mirror for this run.
  const registries = Array.isArray(report.registries) ? report.registries : []
  if (target.kind === 'registry' && registries.length > 0) {
    proposals.push({
      id: 'registry',
      kind: 'registry',
      retryable: true,
      // Selecting every proposal must not silently re-point the download source:
      // this one is a fix for a failure, not a plan item, so bulk select skips it.
      bulkSkip: true,
      title: '指定这次安装用哪个源（下载失败时换源重试）',
      detail: `pnpm 会先试它自己配置的源、失败再试备用源；这里可以指定本次安装先用哪个（当前候选：${registries.join('、')}）。装到一半失败时，面板也会给一个「换源重试」按钮。`,
      risk: '第三方镜像可能滞后或与官方源内容不一致（供应链风险）：来源可信度请自行判断。',
      defaultOn: false,
      editable: [{ key: 'registry', label: '安装源', value: registries[0], options: registries }],
    })
  }

  // Rows/features the target declares but the loader is not running.
  const activation = report.activation
  const disabledRows = activation?.disabledRows ?? []
  const declaredRows = activation?.declared ?? []
  const bundleOff = activation?.bundle !== undefined && activation.bundle.enabled === false
  if (disabledRows.length > 0 || bundleOff || (report.installed?.isInstalled !== true && declaredRows.length > 0)) {
    const what = disabledRows.length > 0
      ? `有 ${disabledRows.length} 行没启用：${disabledRows.map(row => row.rowId).join('、')}`
      : bundleOff
        ? '它作为 bundle 被关着'
        : `${declaredRows.length} 个行会在装好后由 loader 决定启不启用`
    proposals.push({
      id: 'rows',
      kind: 'rows',
      phase: report.installed?.isInstalled === true ? 'before' : 'after',
      title: report.installed?.isInstalled === true ? '打开它声明但没启用的功能' : '装好后立即启用它声明的行',
      detail: `${what}。勾选后，面板用官方通道（setPluginEnabled）把该包的行逐条启用，装完再核验是否真的激活。`,
      risk: '启用后这些行会立即生效——可能改变界面或行为；不启用它们插件只是少一块功能。',
      defaultOn: false,
    })
  }

  // The exemption pair comes from the audit, so the button only ever appears
  // when the host's own remedy has an exact target to act on.
  const exemption = report.exemption
  if (exemption !== undefined && typeof exemption.packageVersion === 'string' && exemption.exempted !== true) {
    proposals.push({
      id: 'exemption',
      kind: 'exemption',
      packageVersion: exemption.packageVersion,
      runtimeVersion: exemption.runtimeVersion,
      peers: exemption.peers,
      resolves: ['peer-compat'],
      title: `放行版本检查：豁免 ${exemption.packageVersion} 对 DSH ${exemption.runtimeVersion}`,
      detail: `插件声明它只兼容 ${JSON.stringify(exemption.peers ?? {})}，与你当前的 DSH ${exemption.runtimeVersion} 对不上。勾选后，面板会用官方通道为**这一对确切版本**（${exemption.packageVersion} @ DSH ${exemption.runtimeVersion}）授予豁免，然后继续安装；豁免只对这个版本组合生效，换版本或升级 DSH 后自动失效，也可以随时撤销。`,
      risk: '官方原话：运行不兼容的插件可能导致崩溃或数据丢失。只在你信任这个来源、并接受这个风险时才勾选。',
      defaultOn: false,
      acknowledge: { label: '我已阅读并接受上面的风险，同意为这一对确切版本授予豁免' },
    })
  }
  if (exemption !== undefined && exemption.exempted === true) {
    proposals.push({
      id: 'revoke-exemption',
      kind: 'revoke-exemption',
      packageVersion: exemption.packageVersion,
      runtimeVersion: exemption.runtimeVersion,
      standalone: true,
      title: `撤销豁免：${exemption.packageVersion} @ DSH ${exemption.runtimeVersion}`,
      detail: '撤掉之前授予的版本豁免。撤销后这个版本会重新被宿主判定为不兼容（若它已经装着，下次启动会被拒绝加载）。这条只做撤销，不安装任何东西。',
      risk: '如果该插件正在使用，撤销后它会停止加载，直到你重新授予豁免或换成兼容版本。',
      defaultOn: false,
      acknowledge: { label: '我确认撤销这个豁免' },
    })
  }

  const scriptNames = Object.keys(manifest.scripts ?? {})
  if (scriptNames.length > 0) {
    proposals.push({
      id: 'allowbuild',
      kind: 'allowbuild',
      title: '若被构建脚本拦截：批准并自动重试一次',
      detail: `该插件声明 ${scriptNames.join('、')}。pnpm 默认拦截构建脚本；勾选后，安装若因此失败，面板会用 pnpm 报告的准确包名申请放行并重试一次。`,
      risk: '等于运行第三方代码（它的构建脚本）。只在你信任这个来源时勾选。',
      defaultOn: false,
    })
  }

  const row = report.row
  const installed = report.installed?.isInstalled === true
  /**
   * Start the config box from what the target itself says, not from `{}`:
   * `report.configTemplate` merges its bundle patch `config:` defaults with the
   * profile's current row config. Keys the scanner could not read with certainty
   * are listed so the user knows the template is partial.
   */
  const template = report.configTemplate ?? { value: {}, patchKeys: [], currentKeys: [], skipped: [] }
  const templateSources = [
    ...(template.patchKeys?.length > 0 ? [`它自己 patch 里的默认值（${template.patchKeys.join('、')}）`] : []),
    ...(template.currentKeys?.length > 0 ? [`你 profile 里现有的配置（${template.currentKeys.join('、')}）`] : []),
  ]
  const templateNote = templateSources.length > 0
    ? `模板来自：${templateSources.join(' + ')}${template.skipped?.length > 0 ? `；读不准的键已略过（${template.skipped.join('、')}）` : ''}，请核对后提交。`
    : '模板是空的：它的 patch 没有 config 默认值、profile 里也没有现成配置，请按它的 README / 设置页填写。'
  const templateJson = JSON.stringify(template.value ?? {}, null, 2)
  proposals.push(installed
    ? {
      id: 'profile-config',
      kind: 'profile-config',
      phase: 'before',
      rowId: row?.id,
      moduleName: row?.name,
      title: `安装前调整 ${row?.id ?? manifest.name} 的 profile 配置`,
      detail: `改动经 configEditor 官方通道写入 profile 的 cordis.patch.yml（与手工编辑同一文件，但带锁、校验和失败回滚）。${templateNote}`,
      risk: '键必须符合该插件的 Config 结构；写错会被 Loader 拒绝并保持原状。',
      defaultOn: false,
      editable: [{ key: 'config', label: '配置 JSON（与现有配置合并）', value: templateJson, multiline: true }],
    }
    : {
      id: 'profile-config',
      kind: 'profile-config',
      phase: 'after',
      rowId: undefined,
      moduleName: manifest.name ?? target.name,
      title: `安装完成后立即写入 ${manifest.name ?? target.name} 的 profile 配置`,
      detail: `新插件的配置行在装好之前还不存在，所以这一步排在安装之后、重启之前；效果等同于先改配置再装。${templateNote}`,
      risk: '键必须符合该插件的 Config 结构（可从它的 README / 设置页确认）；写错会被 Loader 拒绝，安装结果不受影响。',
      defaultOn: false,
      editable: [{ key: 'config', label: '配置 JSON（与默认配置合并）', value: templateJson, multiline: true }],
    })

  return proposals
}
