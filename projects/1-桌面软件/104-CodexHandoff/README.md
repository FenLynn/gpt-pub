# CodexHandoff

> P104｜Codex 本地会话只读导出与项目交接工具

当前版本：`1.0.0-alpha.1`

CodexHandoff 用于把一个 Codex 项目的历史会话整理成单个 `CODEX-HANDOFF.md`，供 Antigravity CLI 在项目工作区中继续开发。

## 核心原则

- 启动零扫描，所有数据读取必须由用户手动触发；
- 扫描前展示读取计划，导出前展示写入计划并二次确认；
- `.codex` 原始数据严格只读，不修改、删除、移动、重命名、归档或追加；
- 默认不读取 `auth.json`、OAuth Token、Cookie 或其他认证文件；
- 会话以 Codex `rollout-*.jsonl` 首行 `session_meta` 为边界，不把内部事件拆成独立对话；
- 标题优先读取 `session_index.jsonl` 的 `thread_name`，当前页缺失标题时再按需回退到会话记录；
- 大批量记录采用首行索引、项目归组、分页、按需预览与流式导出；
- Markdown 写入采用临时文件与原子改名，已有目标文件默认不覆盖；
- 输出路径禁止位于 `.codex` 或 `.gemini`。

## 当前功能

- 手动扫描与取消；
- 逐阶段进度与日志；
- 活动会话与归档会话索引；
- 可选 Git 根目录归并；
- 项目筛选、标题搜索、最近 7 天、最近 30 天、归档筛选；
- 内部会话显式开关；
- 每页 50 条会话，当前页按需补充最后用户输入；
- 项目全部、本页全部、手工多选；
- 当前对话预览；
- 敏感信息预检；
- 完整项目 Markdown；
- 可选工具调用与结果，单条工具结果默认最多 32 KB；
- 导出进度、取消、原子写入；
- 导出完成后打开文件、打开所在文件夹、复制 Antigravity 接续提示。

## 技术栈

- Tauri 2
- Rust
- Vue 3
- TypeScript

Windows 运行时使用系统 WebView2，不依赖 .NET、Python 或 Node。

## 数据读取层次

```text
手动扫描
  ↓
枚举 sessions / archived_sessions
  ↓
每个 JSONL 只读首行 session_meta
  ↓
session_index.jsonl 补标题
  ↓
state_N.sqlite 只读辅助标记 internal / archived
  ↓
项目索引
  ↓
当前页按需读取有限头尾窗口
  ↓
用户确认导出后才逐行流式读取完整正文
```

## Antigravity 接续

导出后将 Markdown 放在对应项目工作区，例如：

```text
D:\code\MyProject\CODEX-HANDOFF.md
```

进入项目并启动 `agy`，然后使用：

```text
请先完整阅读 @CODEX-HANDOFF.md，恢复此前 Codex 的项目上下文。
请结合当前工作区实际代码状态核验历史结论，历史聊天用于恢复上下文，当前代码与仓库状态作为最终事实依据。
在确认当前断点后继续后续开发。
```
