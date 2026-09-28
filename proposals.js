/**
 * Turn an audit report into approval-gated change proposals.
 *
 * Every proposal is configuration- or source-level: choosing the install spec,
 * pinning a version, approving build scripts the official pendingBuilds flow
 * reports, or writing the target's profile `config:` row through `configEditor`.
 * None of them edits third-party plugin code — that boundary is deliberate.
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

  if (target.kind === 'registry' && typeof manifest.version === 'string' && target.pin === undefined) {
    proposals.push({
      id: 'version',
      kind: 'version',
      title: `固定版本（当前 latest ${manifest.version}）`,
      detail: '写成 包名@版本号 安装，避免安装窗口期上游发了新版。',
      risk: '固定到旧版可能错过修复；写错版本号安装会失败并回滚。',
      defaultOn: false,
      editable: [{ key: 'version', label: '版本号', value: manifest.version }],
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
  proposals.push(installed
    ? {
      id: 'profile-config',
      kind: 'profile-config',
      phase: 'before',
      rowId: row?.id,
      moduleName: row?.name,
      title: `安装前调整 ${row?.id ?? manifest.name} 的 profile 配置`,
      detail: '改动经 configEditor 官方通道写入 profile 的 cordis.patch.yml（与手工编辑同一文件，但带锁、校验和失败回滚）。',
      risk: '键必须符合该插件的 Config 结构；写错会被 Loader 拒绝并保持原状。',
      defaultOn: false,
      editable: [{ key: 'config', label: '配置 JSON（与现有配置合并）', value: JSON.stringify(row?.config ?? {}, null, 2), multiline: true }],
    }
    : {
      id: 'profile-config',
      kind: 'profile-config',
      phase: 'after',
      rowId: undefined,
      moduleName: manifest.name ?? target.name,
      title: `安装完成后立即写入 ${manifest.name ?? target.name} 的 profile 配置`,
      detail: '新插件的配置行在装好之前还不存在，所以这一步排在安装之后、重启之前；效果等同于先改配置再装。例如 dshmarket 的 {"allowRestart": false}。',
      risk: '键必须符合该插件的 Config 结构（可从它的 README / 设置页确认）；写错会被 Loader 拒绝，安装结果不受影响。',
      defaultOn: false,
      editable: [{ key: 'config', label: '配置 JSON（与默认配置合并）', value: '{}', multiline: true }],
    })

  return proposals
}
