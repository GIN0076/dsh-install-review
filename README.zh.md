<div align="center">
<img src="assets/logo.jpg" width="170" alt="插件装前审查">

# 插件装前审查 · Pre-install Review

**装之前，先看清它是谁。**

English · 简体中文 · [CHANGELOG](./CHANGELOG.md)

![](https://img.shields.io/badge/DeepSeek%20Harness-0.2.0--rc.2-blue?style=flat-square)
![](https://img.shields.io/badge/检查项-13~14-brightgreen?style=flat-square)
![](https://img.shields.io/badge/运行时依赖-0-orange?style=flat-square)
![](https://img.shields.io/badge/宿主源码改动-0-red?style=flat-square)
![](https://img.shields.io/badge/license-MIT-green?style=flat-square)

</div>

> **你装的每个插件，都攥着你的钥匙。** 它能读你全部会话、调你的模型、写你的 profile。
> 而"作者说无害"这句话——**每一个出过事的插件也都这么说**。

## 三个不舒服的事实

1. **清单收录 ≠ 安全背书。** 上游没标注能力时，这里写的是「上游未标注能力」，而不是替它编一个绿灯。
2. **"装完再说"是这个生态的默认姿势。** 没有备份、没有方案审批、没有装后核验——出事了你只能回滚整个 profile。
3. **全绿也不保证无害。** 但红灯你一定不想装：只要出现一项 **阻断**，正确的动作就是关掉这个页面。

**这个插件只做一件事：在你点「安装」之前，逼它把底牌亮出来——它是谁、能碰什么、要改哪些东西——然后由你逐项批准。**

## 界面

| 📋 审查报告（秒出，含能力与红线） |
| --- |
| ![](assets/report.jpg) |

| 🗂 中文清单（4377 条快照，服务端搜索/分类/排序） |
| --- |
| ![](assets/catalog.jpg) |

| ✅ 方案审批 · 你的建议 · 导入修订 |
| --- |
| ![](assets/plan-amend.jpg) |

## 它检查什么（13~14 项，全部只读）

| 检查 | 说明 |
| --- | --- |
| 本机运行时 | DSH 版本与 profile（**路径自动打码**，截图可直接发给别人） |
| 官方检查 | `pluginManager.inspect`：`dsh.bundle` / `dsh.client` / `dsh.tool` / `dsh.page` / `dsh.configForm` |
| peer 兼容 | 镜像宿主解析语义（含 `includePrerelease`）——**1280 例与宿主 semver 全等** |
| 清单收录 | 名录、仓库、星标、30 天下载量（**不把仓库星标冒充包星标**） |
| 安装状态 | 已装 / 未装（认得 4 种 loader id 形态） |
| loader id 撞车 | 与本机全部 loader 行求交集——重复 id 会让宿主启动崩溃，这是用教训换来的检查 |
| 补丁覆盖行 | 目标 patch 的 override 行：目标存在吗？有没有被别的插件双重改写？（自审不自报） |
| 槽口核对 | 拿本机槽口目录逐个对：源码装读 `slot-catalog.ts`，**桌面/打包版读编译进 `app.asar` 的 `…/dsh-cordis-client-runner/lib/client.js`**——**跑不起来就给警告**，无法确认 ≠ 放行 |
| 安装期脚本 | `prepare` / `postinstall` 等 → 自动进入「批准并重试」流程 |
| 终端类表面 | 描述像 CLI 工具 → 警告「装进 web profile 可能不生效」 |
| engines | **两种写法都读**：`engines.dsh` 与 `dsh.engines.dsh`（只读其一会误报"未声明"） |
| 改宿主核心措辞 | 描述里出现改 DSH 本体的措辞 → 警告 |
| 能力与安全红线 | 清单标注的 10 类能力 + 红线句，**全部中译**；没标注就如实写"未标注" |

## 闭环：审查 → 方案 → 批准 → 改 → 装 → 核验

1. **审查**：输入 `npm 包名` / `owner/repo` / `github:owner/repo` / GitHub 链接 → 回车秒出报告
2. **方案**：只有**可执行改动**，勾选才会执行；标题旁的 **「全选 / 全不选」** 可以一键勾上所有可执行项。
   两类**故意不替你勾**并当场说明：需要你本人勾「接受风险」的放行项，以及「换个安装源」（它是下载失败时的补救，选中等于改掉下载源）
   - **固定版本 / 更新到新版**（有新版时直接给「更新到 X（保留你现在的配置）」，只换依赖版本、不动你的配置行）
   - **放行版本检查**（`peer-compat` 红灯时出现）：用官方通道为**这一对确切版本**（包@版本 + 你的 DSH 版本）
     授予豁免，然后继续安装。**必须先勾「我已阅读并接受风险」**——这一步只能由你本人做，导入的方案 JSON 代替不了；
     豁免只对这一对版本生效、可随时撤销（面板里有「撤销豁免」，独立执行、不安装东西）
   - **换下载源**（下拉选源；源出问题导致安装失败时，面板另给「换源重试」一键按钮）
   - **打开它声明但没启用的功能**（按 id 逐条启用，只碰这个包自己的行）
   - **构建脚本批准**（被 pnpm 拦截时，用 pnpm 报告的**准确包名**自动放行重试一次）
   - **写 profile 配置**（走 `configEditor` 官方通道：锁、校验、回滚；**模板已按它自己的 patch 默认值 + 你现有配置填好**，你核对即可）
   - **切换来源**（git 仓库 → npm 固定包名，避开装到一半仓库变更）
3. **你的建议**：想改方案？写进「你的建议」→「复制报告给我复核」粘给会话里的 AI → 它回一段**修订 JSON** → 粘进「导入修订」一键改勾选与参数（目标不匹配会直接拒收）
4. **执行**：先备份 `package.json` / `cordis.patch.yml` / `pnpm-workspace.yaml` / `cordis.yml`（有豁免记录时还有 `compatibility.json`）→ 按批准的方案改动 → 安装 → **装后核验**
5. **装完验一遍真生效**：不只核"装上了吗、有没有重复 id"，还核该包的行是否**真的激活**（`failed` 直接点出来）、bundle 是否被选中、声明的浏览器半有没有进客户端模块图；对不上就给可读结论，例如"行 X 还没激活——通常要重启 dsh 才生效"
6. **构建脚本卡住**：面板就地弹出「批准 `<包名>` 的构建脚本并重试」——不卡死，也不越权（名字不在待决清单会被官方 `stale-approval` 拒绝）

## 红灯之后：不至于干瞪眼

- **peer 不兼容**（最常见的"装不上"）：官方留了一条路——为确切版本授予豁免。面板把它做成一个按钮，默认关闭，
  勾选 + 风险确认后才走；豁免范围只有那一对版本，换版本或升级 DSH 就自动失效。
- **engines 不符**：**仍然锁住**（那是作者的声明，是真实信号），但报告会明说**宿主只核对 `peerDependencies`，不会因此拦住安装**，
  并给一个「我知道…我确认仍然安装」的勾选框；也能改填一个满足该范围的版本。
- 还有几项仍然是硬阻断（读不到 manifest、没有 `dsh.bundle`、loader id 撞车）：这些**没有安全处方**，报告会直说，建议别装。

## 边界（说清楚才可信）

- **不改第三方插件代码。** 只动来源、版本、构建批准、profile 配置这四类**属于你自己的配置**。
- **不动宿主源码。** 0 补丁，全走公开服务与 profile 文件；换代只换自己的文件名。
- **清单未标注能力 ≠ 安全。** 我们显示事实，不替上游背书。
- **这是装前体检，不是代码审计。** 它回答"能不能装、装了会碰什么"，不回答"里面有没有后门"。

## 安装

```sh
dsh plugin --profile web add github:GIN0076/dsh-install-review
```

- 要求：DeepSeek Harness **0.2.0-rc.2**（实测版本）+ web profile 或**桌面版**
- **零运行时依赖**、无构建步骤、无 postinstall
- 把 `@local/dsh-install-review` 加入 profile 的 `dsh.profile.bundles`，并在 `cordis.patch.yml` 加入它的 insert 行；只执行上面的 `add` 命令只会把仓库放进 `node_modules`，**不会挂载界面**
- 装完重启 `dsh web`，再**硬刷新**（Ctrl+Shift+R）→ 设置 → **插件装前审查**

**桌面版（打包 App，实测 0.2.0-rc.2）**：设置 → 插件 → **添加插件**，填本地目录路径（或插件管理工具 `install_bundle` 指向目录）。

- **桌面版没有「刷新页面」**：那个菜单项（以及开发者工具）只在开发模式（`!app.isPackaged`）里存在，正式安装里没有——
  所以别找 Ctrl+Shift+R。**客户端半（界面）改了通常会自己热更新**；要强制加载新版就**退出并重开 `DeepSeek Harness.exe`**
  （会话是持久化的，重开后在左侧列表里继续打开即可）。**Host 半（逻辑）改了不需要重启**——按下面的换代流程
  `remove_bundle` + `install_bundle` 就会重新加载。
- 桌面版有两处和浏览器直连不同，v1.1.0 起已适配：
  ① 运行时在 `resources/app.asar` 内、**没有 `src/` 源码树** → 槽口核对改读**编译版目录**
  （`…/dsh-cordis-client-runner/lib/client.js`）；
  ② 窗口 origin 是 `dsh-app://app`，其协议处理器转发前会**删掉 `Origin` / `Sec-Fetch-Site` / `Cookie`**
  再注入 Host 自己的会话 cookie → 面板请求不再自比 Origin，而是问宿主自己的
  `connection.requestRejection`（与官方 `@deepseek-ai/dsh-host-open-in-app` 同一条通道；无 cookie → 401，
  跨站 Origin → 403，并在响应里回带 `hint` + 看到的头部摘要）。

> 不想走 git？把仓库拷到本地，用插件管理页的 `install_bundle` 指向目录，再完成同样的两处 profile 配置，效果完全一样。

## 卸载

设置 → 插件 → 移除，或插件管理页 `remove_bundle`。**卸载不会删你的备份**——每次执行前的备份写在 `<profile>/install-review-backup`（行 config 的 `backupDir` 可以改位置）。

## 自检

```sh
node semver-selftest.mjs          # 1280 例，与宿主 semver 全等（找不到宿主 semver 时标 SKIP）
node catalog-view-selftest.mjs    # 分类/能力/红线/投影
node patch-audit-selftest.mjs     # override 行解析与判定
node audit-selftest.mjs           # 解析 / peer / engines 双写法 / 端到端
node remedy-selftest.mjs          # 放行处方：豁免在安装之前、未确认时什么都不做、导入不能自我批准、撤销独立执行
node enhance-selftest.mjs         # 能力处方：配置模板扫描器 / 候选源顺序 / 升级保配置 / 行按 entryId 启用 / 装后激活核验
node runner-selftest.mjs          # 备份 / 配置 / approvedBuilds / stale-approval
node host-selftest.mjs            # 路由与同源围栏
node client-selftest.mjs          # 修订导入闭环（有 react-dom 时额外做 SSR 渲染）
```

**九套自测，零测试框架、零依赖。** 端到端两套会读取真实外网清单：当被测包声明的 peer 不兼容当前 DSH 时，阻断是预期结果，不应把“全绿”当作安装许可。

> 自测自己找宿主依赖（`selftest-host.mjs`：源码树 / 本目录 / 打包运行时依次探测），**不再硬编码任何安装路径**。
> 想在桌面版上跑出真正的 1280 例 semver 比对：`$env:ELECTRON_RUN_AS_NODE=1; & "…\DeepSeek Harness.exe" semver-selftest.mjs`
> ——它会用 `app.asar` 里的 semver。找不到 node-semver / react-dom 时那一段标 `SKIP`（不是 FAIL）；
> 可用 `DSH_SELFTEST_SEMVER` / `DSH_SELFTEST_REACT` / `DSH_SELFTEST_REACT_DOM` 指定具体文件。
> 测试夹具里的用户名是假的（`localtester`），用来验证「报告里的本机路径一定被打码」。

## 免责声明

本工具在安装前检查**可安装性与影响面**，任何自动化检查都不能替代你对插件来源的判断；清单数据为上游快照（4377 条 / 下载量区间见页面标注），以抓取时为准。

## License

[MIT](./LICENSE) © 2026 GIN0076
