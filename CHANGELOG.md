# Changelog

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

- **七套零依赖自测全绿**（`semver-selftest` 1280 例 + 六套 ALL PASS）
- **0 宿主源码改动**；显示名「插件装前审查 / Pre-install Review」，标识符（包名 / id / 路由 / 协议）保持 `install-review`
