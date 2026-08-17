# P104 CodexHandoff｜HANDOFF

## 项目定位

CodexHandoff 是一个面向 AI 编程工具迁移的本地只读项目交接工具。当前第一阶段只做：

`Codex → 单个 CODEX-HANDOFF.md → Antigravity`。

不要在这条主链稳定前引入 Antigravity → Codex、Codex++ 原生会话修复、API / Provider / MCP / Rules / Skills 迁移。

## 当前版本

- 开发版本：`1.0.0-alpha.1`
- 开发分支：`p104-exp`
- 稳定候选分支：`p104-stable`
- 正式分支：`main`

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
- 完整 Markdown；
- 可选工具调用与结果；
- 导出进度与取消；
- 原子导出；
- 结果页；
- 打开文件 / 文件夹；
- 复制 Antigravity 接续提示。

## 当前验证状态

- 前端与 Rust 源码已完成首轮重构；
- P104 Windows x64 CI 已配置，首轮原生编译与测试结果以当前工作分支 CI 为准；
- 自动测试覆盖 Codex 用户消息、内部注入过滤、会话重命名事件；
- Windows 实机 UI 和真实大规模 Codex 数据仍需后续实机验证。

## 后续顺序

1. 先让 Windows CI 绿灯并产出单 EXE；
2. 实机验证启动零扫描、手动扫描和大批量会话性能；
3. 核对项目数量、会话数量和 Codex 左侧标题；
4. 核验 Markdown 是否适合 Antigravity 接续；
5. 稳定后再讨论第二数据源 Antigravity。
