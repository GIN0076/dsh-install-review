# Changelog

## 1.1.0 — 2026-10-01

Desktop（打包版）适配。两条桌面版专属问题都来自同一个事实：桌面版**不是浏览器直连 Host**——
窗口 origin 是 `dsh-app://app`，协议处理器转发前会删掉 `origin` / `sec-fetch-site` / `cookie`
（`resources/app.asar/lib/main.js` 的 `forwardWebRequest`），并注入 Host 自己的会话 cookie；
运行时又整个装在 `app.asar` 里、**没有 `src/` 源码树**。

### 修复

- **面板全线 403「同源校验失败」**（用户实测「清单加载失败」）：旧的「Origin 主机 == 请求 Host」
  围栏在桌面版**必然失败**（Origin 已被删）。现改为先问宿主自己的
  `connection.requestRejection`——与官方 `@deepseek-ai/dsh-host-open-in-app` 同一条通道：
  loopback/受信 Host 栅栏 + `sec-fetch-site: cross-site` 拦截 + Origin 一致（有 Origin 时）+
  浏览器 cookie 认证（无 cookie → 401）。本机 Origin 检查降级为**没有 connection 服务时的兜底**。
  401/403 响应带回 `hint` 与 `seen`（Host / Origin / site / cookie 有无），面板直接显示，
  以后围栏再出问题不用猜。
- 槽口目录改为**候选列表**（`audit-v4.js` 的 `slotCatalogCandidates`）：行配置 `slotCatalogPath` →
  打包版 `.../@deepseek-ai/dsh-cordis-client-runner/lib/client.js` → profile 自己的 `node_modules` →
  源码树（沿 installAnchor 向上 ≤7 层找 `slot-catalog.ts`）。
- 目录解析同时接受单引号与双引号（源码 `key: 'settings.section'`；编译版 `key: "settings.section"`），
  且只认带点的槽口键——实测打包版编译目录解析出 **77 个槽口键**，旧解析器只认出 3 个（含 Client 服务名）。
- 主机半换代 `host-v6.js` → **`host-v8.js`**（ESM 按 URL 缓存，改代码必须换文件名）；
  `cordis.patch.yml` 指向 `./host-v8.js`。（`host-v7.js` 是当天写出、当天即被 v8 取代的**未发行中间态**，
  不进本版。）`index.js` 只作转发，行名才是活的那份。

### 自测

- 新增 `selftest-host.mjs`（自测的宿主依赖**动态探测**：源码树 / 本目录 / 打包 `app.asar`）＋找不到就
  `SKIP` 而非 FAIL——旧的 `E:/DSH-OneClick/src/node_modules/.pnpm/...` 硬编码随 source 安装消失，
  曾让两套自测直接 import 崩溃。
- `host-selftest` 新增 7 条：桌面版形状请求（无 Origin / 无 sec-fetch-site / 带 Host cookie）必须放行、
  同一请求去掉 cookie → 401 且带 `hint`/`seen`、`connection` 服务确实被问到、无 connection 时兜底围栏仍拦。

### 未变

- 其余 12 项检查、清单浏览、审批式安装、四文件备份、`client.js` 的结构（仅错误提示更详细）**全部未改**。

### 实测（桌面版 0.2.0-rc.2）

- `install_bundle` 本地 link 安装 `applied` 零警告；五条路由挂载；同源外 Origin → 403；
  匿名（无 cookie）→ **401**；实审 `dsh-plugin-whale-pet` `block 0 / warn 1（不在精选清单）/ pass 8 / info 3`，
  `slot-audit pass`（目录＝`app.asar/.../dsh-cordis-client-runner/lib/client.js`）。
- 七套自测全绿：`semver` 在桌面版 node 下用 `app.asar` 里的 semver 跑出 **1280/1280 全等**。

## 1.0.0 — 2026-09-29

First public release (consolidates the internal v1 → v6.1 development line).

### 审查 —— 13~14 项，全部只读

- 官方 `pluginManager.inspect` 结果（`dsh.bundle` / `dsh.client` / `dsh.tool` / `dsh.page` / `dsh.configForm`）
- peer 兼容：镜像宿主解析语义（含 `includePrerelease`），**1280 例与宿主 semver 全等**
- 清单收录、仓库、星标、30 天下载量（不把仓库星标冒充包星标）
- 安装状态（认得 4 种 loader id 形态）/ loader id 撞车 / 补丁 override 行双向核对
- 槽口核对（本机 `slot-catalog.ts`，路径向上 ≤7 层查找；**跑不起来 = 警告**）
- 安装期脚本 / 终端类表面 / engines 双写法（`engines.dsh` 与 `dsh.engines.dsh`）/ 改宿主核心措辞
- 清单能力与安全红线（23 类分类 + 10 类能力，全部中译；未标注就如实说未标注）

### 清单浏览

- 4377 条全量浏览，服务端搜索 / 分类 / 排序 / 分页
- 磁盘缓存（24h、5.25MB 单次下载）+ 共享 inflight + 20 秒预算降级，冷缓存不阻塞审查

### 审批式安装

- **四类**可执行方案：固定版本 / 构建脚本批准 / profile 配置（装后写）/ 切换来源
- 执行前备份 **4 个** profile 文件（`package.json`、`cordis.patch.yml`、`pnpm-workspace.yaml`、`cordis.yml`）
- 改动走 `configEditor` 官方通道，安装走 `installBundle` 官方通道，装后核验（装上了吗 + 有没有重复 id）
- 构建脚本被 pnpm 拦截：面板内「批准 X 的构建脚本并重试」（`approvedBuilds`，走官方 `approveBuilds`，名字过期如实失败）

### 会话联动

- 「你的建议」输入框；「复制报告给我复核」导出 报告 + 当前方案（勾选与参数）+ 建议 + agent 任务
- 导入修订协议 `install-review/amendments` v1：改勾选、改参数、分派会话任务（目标不匹配直接拒收）
- 错误就地显示、贴错文档识别、整段聊天/代码围栏 JSON 宽容提取

### 质量

- **七套零依赖自测**（`semver-selftest` 1280 例 + 六套离线用例）；端到端两套读取真实清单，遇到真实的 peer 不兼容会按设计阻断
- **0 宿主源码改动**；显示名「插件装前审查 / Pre-install Review」，标识符（包名 / id / 路由 / 协议）保持 `install-review`
