# Changelog

## 1.3.0 — 2026-10-01

用户点名的五件事，全部只走官方通道、都默认关闭、都能回退：

### 1. 换下载源重试（`registry`）

- 审计现在给出**候选源列表**（pnpm 解析值 → 配置值 → 宿主备用源 → 官方源 → 国内镜像）。
- 方案里多一条「指定这次安装用哪个源」（下拉选择）；装到一半因为源的问题失败时，面板额外弹一个**「换源重试」一键按钮**。
- 执行时走 `installBundle(spec, { registry })`，只影响这一次安装。

### 2. 配置模板自动填好（`profile-config` 升级）

- 从**它自己的 bundle patch 里的 `config:` 默认值** + profile 里现有的行配置，合成一份带真实键的模板，替代原来的空 `{}`。
- 零依赖的 YAML 扫描器只认「能确定的一层标量」：嵌套映射、`!!js`、锚点/流式集合一律**略过并列出键名**，宁可模板小一点，也不给错的值。
- 面板 detail 里写明模板来自哪里、略过了哪些键。

### 3. 打开没启用的功能（`rows`）

- 审计读 `listBundles()` / `listPlugins()`，指出该包**声明了但 loader 没在跑**的行（以及 bundle 本身是否被关着）。
- 方案里给「打开它声明但没启用的功能」；执行时走 `setPluginEnabled`（bundle 关着则先 `setBundleEnabled`），只碰**该包自己声明的 id**，并把结果逐行报告。

### 4. 有新版就更新且保留你的设置（`upgrade`）

- 审计比较 profile 里的版本与上游最新版；有新版就给「更新到 X（保留你现在的配置）」。
- 它只改依赖版本，**不动你的 profile 配置行**；执行结果里回显「从哪个版本升上来的」。

### 5. 装完验一遍真生效（`verify` 升级）

- 装完不只核「装上了吗、id 重复吗」，还核**激活**：该包的行是否 `active`（`failed` 直接点出来）、bundle 是否被选中、manifest 声明的浏览器半是否进了客户端模块图。
- 有问题给可读结论，例如「行 X 还没激活——通常要重启 dsh 才生效」「声明了浏览器半但模块图里没有 → 界面不会出现」。

### 界面

- 改动方案标题旁新增 **「全选」「全不选」**：一键勾上/取消所有可执行项。
  两类**故意不替你勾**，并在面板上说明原因：① 需要你本人勾「接受风险」的放行项（版本豁免、撤销豁免）；
  ② 「换个安装源」——它是下载失败时的补救，选中等于把下载源改掉，所以留给「换源重试」按钮或你手动勾。
- `client-selftest` 新增 8 条断言钉住这个行为（全选勾上计划项、跳过风险项与换源项、说明文字出现、全不选清空并撤掉说明）。

### 自测

- 新增**第九套** `enhance-selftest.mjs`（全本地夹具，零网络）28 条断言：扫描器只留能确定的键、候选源顺序、模板与 profile 现值合并、有新版才给升级、升级不改配置、换源真的传进 `installBundle`、行/ bundle 按 entryId 逐条启用、verify 给出停用行结论。
- 全套九套自测通过；`audit-selftest` 对真实目标已能看到新出来的 `registry` / `rows` 方案。

### 说明

- 宿主半换代 `host-v9.js` → `host-v10.js`（`audit-v6` / `proposals-v3` / `runner-v7`）。
- 仍然：不改第三方插件代码、不改宿主源码；所有动作先备份、默认关闭、需你勾选。

## 1.2.0 — 2026-10-01

**阻断项不再死路。** 用户拍板两点：① 遇到「插件说不支持你的版本」要给一个「我接受风险，照样装」的按钮；
② engines 不符仍然锁住，但必须明说「宿主其实不拦，要装也可以」。

### 新增：红灯旁边的放行办法

- **放行版本检查（`exemption`）**：`peer-compat` 亮红灯时，方案里多一条按钮，用宿主官方通道
  `setVersionExemption(<包>@<版本>, <DSH 版本>, true, acceptRisk)` 为**这一对确切版本**授予豁免，然后继续安装。
  豁免只对该版本组合生效，换版本或升级 DSH 后自动失效；面板里也能撤销（`revoke-exemption`，独立执行、不安装任何东西）。
- **风险确认只能由人做**：`exemption` / `revoke-exemption` 必须先勾「我已阅读并接受风险」才能勾选方案；
  面板另外发出 `acknowledged` 里的 `risk:<id>` 令牌，**导入的方案 JSON 无法代替这一步**（runner 侧硬校验，缺令牌直接拒绝执行）。
- **engines：仍锁住，但说清楚**：报告明写**宿主只核对 `peerDependencies`，不会因为 `engines.dsh` 不符而拦住安装**——
  那是作者的声明，不是技术上装不上；旁边给「我知道…我确认仍然安装」的勾选框，勾了才放行。
  同时提供「改用满足 engines 的版本」方案（手填版本号）。
- **红灯区可读**：未处理项、已放行项分开列出；不能靠确认跳过的（peer 不兼容）会明说"只能用官方通道放行"。

### 执行器（`runner-v6.js`）

- 计划新增 `acknowledged` / `resolved` / `unresolved`：只要还有未处理阻断，**一个文件都不动**。
- 豁免在安装**之前**授予；授予失败立即中止（不安装、不改配置）。
- 备份集增加 `compatibility.json`——豁免写的就是这个文件。

### 自测

- 新增**第八套** `remedy-selftest.mjs`（全本地夹具、不联网）：豁免目标是否确切、未确认时"什么都没发生"、
  导入的方案不能自我批准、授予发生在安装之前、授予失败即中止、撤销是独立执行。
- 审计/执行两套自测换代到 `audit-v5.js` / `runner-v6.js`；`host-selftest` 的围栏用例不变。

### 说明

- 全部走官方通道（`setVersionExemption` / `installBundle` / `configEditor`）：**不改第三方插件代码、不改宿主源码**，
  高风险动作默认关闭、必须由你本人勾选并二次确认。
- 宿主半换代 `host-v8.js` → `host-v9.js`（ESM 按 URL 缓存，改 Host 代码必须换文件名）；`index.js` 只作转发。

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
