# P104 CodexHandoff｜HANDOFF

## 项目定位

CodexHandoff 是一个面向 AI 编程工具迁移的本地只读项目交接工具。当前第一阶段只做：

`Codex → 单个 CODEX-HANDOFF.md → Antigravity`。

不要在这条主链稳定前引入 Antigravity → Codex、Codex++ 原生会话修复、API / Provider / MCP / Rules / Skills 迁移。

## 当前版本

- 当前交付编号：`P104-001`
- 内部开发版本：`1.0.0-alpha.4`
- 开发分支：`p104-exp`
- 稳定候选分支：`p104-stable`
- 正式分支：`main`

## 强制交付编号规则

1. `DELIVERY_VERSION` 是用户可见 EXE 的唯一连续交付编号来源。
2. 从 `P104-001` 开始，每产生一份新的用户测试 EXE 必须依次递增为 `P104-002`、`P104-003` 等，不得回退、复用或跳号。
3. 内部 SemVer 可以继续使用 `1.0.0-alpha.N`，但不能替代交付编号。
4. CI 必须读取 `DELIVERY_VERSION`，生成带编号的 EXE 和校验文件，禁止把通用名 `CodexHandoff.exe` 直接作为用户交付文件。
5. 每轮给用户的最终回复必须同时报告：交付编号、内部版本、exact head SHA、CI run、SHA-256，并提供这一轮 CI 产出的带编号最新 EXE。
6. 不得把历史 Artifact、本地旧 EXE 或上一轮文件改名后冒充当前交付。

## 当前架构

- Tauri 2
- Rust 后端负责全部文件系统、Codex JSONL、SQLite 只读辅助、Markdown 导出；
- Vue 3 + TypeScript 前端负责 UI；
- Windows 使用系统 WebView2；
- 目标交付为 Windows x64 单 EXE。

## 核心安全约束

1. 程序启动零扫描；
2. 扫描只能人工触发，扫描前必须展示计划；
3. `.codex` 原始文件、索引与数据库严格只读；
4. 不读取 `auth.json`、OAuth Token、Cookie 等认证文件；
5. 不提供 rename / delete / archive / move 等写回源数据功能；
6. 输出路径禁止位于 `.codex` 或 `.gemini`；
7. 导出前先预检，再二次确认；
8. 导出使用临时文件，成功后原子改名，已有文件默认不覆盖。

## Codex 会话定义

一条顶层 Codex 会话对应一份 `rollout-*.jsonl`，逻辑 ID 来自第一行 `session_meta.payload.id`。

不得把 Turn、Item、exec、tool call、subagent 等内部记录拆成新的顶层会话。

标题优先级：

1. `session_index.jsonl` 最新 `thread_name`；
2. rollout 内最后的 `thread_name_updated`；
3. 第一条真正可见的用户输入；
4. `(未命名会话)`。

必须过滤 `# AGENTS.md instructions`、`<environment_context>`、`<skills_instructions>`、`<system-reminder>` 等内部注入内容。

## 精简交接导出规则

默认导出目标是给 Antigravity 恢复开发上下文，不是生成完整审计日志。

默认正文只保留：

1. 用户真正发送的可见消息；
2. 每个用户轮次结束时 Codex 最后一条可见回复。

默认不保留：

- 工具调用与工具结果；
- Shell 命令及大段日志；
- 同一轮中间的进度回复；
- system / developer / AGENTS / environment 注入；
- reasoning、token、模型元数据和其他内部事件。

敏感信息预检必须使用与最终导出相同的精简口径，避免扫描最终不会写入 Markdown 的过程数据。

## 大批量会话策略

- 扫描阶段只枚举 JSONL 并读取第一行 `session_meta`；
- SQLite 只作为 internal / archived 辅助标记；
- 列表固定分页，每页 50 条；
- 当前页只读取有限头尾窗口；
- 用户点击单条会话时再扩大预览窗口；
- 正文全量读取只发生在用户确认导出后；
- 禁止重新引入启动时全量深解析。

## 已迁移功能

- 手动扫描、取消、进度、日志；
- 项目归类与可选 Git 根目录归并；
- Codex 原生标题；
- 搜索、7/30 天、归档与内部会话筛选；
- 分页；
- 当前会话预览与最后用户输入；
- 项目全选、本页全选、手工多选；
- 敏感信息预警；
- 精简交接 Markdown；
- 可选高级完整细节；
- 导出进度与取消；
- 原子导出；
- 结果页；
- 打开文件 / 文件夹；
- 复制 Antigravity 接续提示。

## 当前验证状态

- `1.0.0-alpha.4` 精简交接导出已通过 Windows CI 的前端构建、Rust 测试、只读守卫与原生 EXE 构建；
- 下一次用户测试交付以 `P104-001` 编号重新构建，编号和 SHA 必须由 CI Artifact 核对后再发送；
- Windows 实机 UI 和真实大规模 Codex 数据仍需用户继续验证。

## 后续顺序

1. 先以 `P104-001` 重新跑完整 Windows CI，并只发送该 run 的带编号 EXE；
2. 实机核验精简 Markdown 是否只保留用户消息与每轮最终回复；
3. 再处理 UI 和性能问题；
4. 每次新的用户测试 EXE 顺序递增 `DELIVERY_VERSION`；
5. 稳定后再讨论第二数据源 Antigravity。
