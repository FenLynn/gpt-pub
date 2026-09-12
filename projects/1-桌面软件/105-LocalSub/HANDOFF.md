# P105｜LocalSub HANDOFF

> 本文件是跨对话恢复入口，不替代源码、CI、Git、A/B/C 规则与阶段记录。

## 1. 固定身份

- 项目：LocalSub
- GPT-Pub 编号：`P105`
- 正式路径：`projects/1-桌面软件/105-LocalSub/`
- 日常开发：`p105-exp`
- 稳定候选：`p105-stable`
- 正式主线：`main`
- 固定流转：`main → p105-exp → p105-stable → main`
- P105 长期项目分支只允许 `p105-exp` 与 `p105-stable`
- 活动 CI：`.github/workflows/p105-localsub-ci.yml`

P103 永久属于 DavBridge。旧 `p103-localsub-*`、`103-LocalSub` 与相关历史 PR 只用于追溯，不再作为维护入口。

## 2. 新对话强制读取顺序

每次接续 LocalSub：

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. `projects/1-桌面软件/105-LocalSub/开发约束.md`
5. `projects/1-桌面软件/105-LocalSub/README.md`
6. `projects/1-桌面软件/105-LocalSub/阶段记录.md`
7. `projects/1-桌面软件/105-LocalSub/工作记录.md`
8. `projects/1-桌面软件/105-LocalSub/docs/APP_CONTRACT.md`
9. `projects/1-桌面软件/105-LocalSub/docs/ARCHITECTURE.md`
10. 与当前任务直接相关的源码
11. `main / p105-stable / p105-exp` 的真实关系
12. P105 当前 open PR、exact-head CI、tag 与 Release

不得只凭聊天记忆继续工作。

## 3. 写入规则

- 日常代码和状态修改只在 `p105-exp`。
- `p105-stable` 只接收 `p105-exp` 的正式提升 PR。
- `main` 只接收 `p105-stable` 的正式准入 PR。
- 不建立普通版本专用 P105 分支。
- 禁止修改 P103 DavBridge、P104 或其他项目。
- 所有提升都只认当前准确 head 的成功 CI。
- 正式 Release 只有用户对明确版本作出当前人工授权后才允许执行。
- 每个可交付开发轮次默认递增一次 patch 版本，并在 exact-head CI 成功后向用户提供对应 EXE/候选包；内部修复 commit 不单独重复加版本。

## 4. 改造前冻结基线

2026-09-11 开始新一轮架构改造前：

```text
main
p105-stable
p105-exp
```

均为：

```text
042329ede97b09cd375ebcf7c55d7245fc56b933
```

从该点起：

- `main` 保持正式主线。
- `p105-stable` 保持改造前可运行基线。
- 新架构只在 `p105-exp` 推进。
- 旧版本需要回退或对照时，从 stable 或准确 SHA 重新构建。
- exp 实验失败时使用 revert 或后续修复提交，不强推、不重置长期分支。
- 新候选没有通过自动门禁和必要实机验证前，不提升到 stable。

## 5. 当前架构

```text
LocalSub.exe
├─ Vue/WebView2 主 Shell，v0.1.3 起默认入口
├─ 旧 WinForms 备用界面，仅 `--legacy-ui` 或 `LOCALSUB_LEGACY_UI=1` 显式启动
├─ WebView2 字幕 Overlay
├─ PotPlayer 进程发现、PID、窗口 bounds 与最小化状态
├─ Shell LiveAsrPipeline proxy
├─ Core supervisor
└─ Named Pipe IPC
        ↓
LocalSub.Core.exe
├─ realtime All Audio / Process Loopback
├─ PotPlayer 音频恢复
├─ Streaming Paraformer / Zipformer
├─ SenseVoice / Fun-ASR-Nano realtime
├─ VAD / realtime decode queue
├─ 媒体解析与波形
├─ 后台离线 ASR
└─ 模型下载、解压、校验、修复与重型删除
```

已迁入 Core 的后台与 realtime 重实现不得重新引入 GUI 进程内静默 fallback。

Core IPC 当前包括：

```text
ping
analyze
transcribe
model.download
model.delete
cancel
shutdown

live.start
live.stop

live.status
live.level
live.partial
live.final
live.discontinuity
live.failed
```

Shell/Core 继续使用 connection generation、Core 断开显式失效、下一请求自动重启、cancel 超时回收和正常 shutdown。

Shell 编译已经排除 realtime 重实现与 `ProcessLoopbackCaptureService`。Process Loopback smoke 也通过 Core 执行。

## 6. 当前架构决策

2026-09-11 起，不再执行严格：

```text
1A
→ 1B 全部完成
→ Web UI
```

改为：

```text
Phase 1A
→ Phase 1B.0 Application Contract
→ Phase 1B.1 实时链迁 Core
→ Phase 2A Web Shell
→ Phase 1B.2 模型重任务迁 Core
→ Phase 2B 逐页 Web UI
→ Phase 3 旧 WinForms 业务页退役
```

Phase 1B 后续与 Web UI 可以在稳定契约下交错推进，但不得一次性重写全部底层链路与业务 UI。

详细边界以 `docs/APP_CONTRACT.md` 为准。

## 7. 最终目标

```text
Vue 3 + TypeScript
        │
        │ typed JSON bridge
        ▼
LocalSub.exe
轻量 C# Windows Shell
├─ WebView2 host
├─ tray / lifecycle
├─ native dialogs
├─ PotPlayer process discovery / window tracking
├─ subtitle Overlay
├─ settings
└─ Core supervisor
        │
        │ Windows Named Pipe
        ▼
LocalSub.Core.exe
├─ realtime audio capture
├─ PotPlayer Process Loopback
├─ realtime ASR
├─ offline ASR
├─ media analysis
├─ waveform extraction
├─ VAD
└─ model heavy work
```

三层原则：

```text
Vue 只表达状态和用户意图
Shell 只拥有 Windows 原生能力和应用生命周期
Core 只拥有重计算与长任务
```

## 8. 当前唯一开发断点

当前 Phase：`Phase 2B` Web UI 已切为默认入口，后台转写与设置页仍待迁移。

最后一个经过完整自动门禁的代码 head：

```text
753a959e938a672e367c9f3a8638226dca841367
```

P105 Windows CI：

```text
run 34690755412
success
```

Artifacts：

```text
candidate
ID 10296548335
sha256:bc04d00dc07539fa225ef230bf6b8103ee7b18b476ea1b76f8a140b19000c570

WebUi preview
ID 10296318757
sha256:61b618798951cf491903955dd0afd5e317e33e5c5ac4fbd187d8a813c81882ca
```

本阶段已经完成：

- 模型目录查看、安装状态、能力、评分、推荐标记与实时/后台默认模型选择进入 Web 模型页。
- Web bridge 当前已包含 `model.list / model.select / model.download / model.cancel / model.delete`，Vue 只发送用户意图。
- 重型 `ModelManager.cs` 已从 `LocalSub.exe` 编译中排除，Shell 只保留 `ModelManager.Proxy.cs`；`SharpCompress` 也已从 Shell 项目依赖移除。
- 模型下载、断点续传、解压、校验、修复、目录替换与递归删除统一进入 `LocalSub.Core.exe`，Shell 不保留静默 fallback。
- 旧 WinForms 的 realtime、后台转写和模型任务统一使用 `CoreWorkerBroker.Shared`，避免多个 Core 绕过重任务互斥。
- Web 模型页显示 Core 模型任务、进度、错误与取消状态；删除使用二次确认。
- 下载任务允许取消；删除一旦进入破坏性目录脱离与递归清理阶段即完成收尾，不允许用户中途取消，避免遗留 `.delete-*` 目录。
- WebShell snapshot 推送的 coalescing 顺序已修正，状态变化可以在当前 snapshot 构建期间重新排队，不再存在已知的最终状态丢失窗口。
- CI 已覆盖模型重实现编译隔离、Core `model.download / model.delete` IPC 失败恢复、真实 WebView2 模型命令 bridge、原 realtime/Core crash recovery/Process Loopback/native ASR 与 portable package 回归。
- 模型页 1280×800 自动预览已人工检查，视觉语言与实时页一致，无明显溢出或布局塌陷。

v0.1.3 已切换默认启动路径：普通双击进入 WebShell。旧 WinForms 只作为迁移期备用界面，通过 `LocalSub.exe --legacy-ui` 或 `LOCALSUB_LEGACY_UI=1` 显式启动。默认 WebShell 已接入既有托盘控制器与 UI 响应监控。

下一步固定为：

1. 不提升 stable，不动 main。
2. 在真实 Windows 上同时验证 realtime 与模型管理：真实 PotPlayer、真实模型、模型下载/修复、断点续传、取消、大模型解压、删除、Core 强杀与恢复。
3. 继续进入 Web 后台转写工作区，复用现有 Core `analyze / transcribe / cancel`，不复制旧 WinForms 业务核心。
4. 后台页完成后迁设置编辑与 Overlay 联动细节。
5. 旧 WinForms 在迁移期间只作为显式备用入口，待 Web 后台与设置达到必要功能覆盖后再进入 Phase 3 删除。

## 9. Web UI 约束

未来 Vue 只能：

- 接收 DTO。
- 显示状态。
- 发送白名单命令。
- 接收白名单事件。

Vue 不得：

- 直接打开 Named Pipe。
- 调用 WASAPI 或 Process Loopback。
- 操作 sherpa / ONNX。
- 访问 PotPlayer HWND。
- 直接读取内部日志或状态文件。
- 复制 C# 业务核心。

不得把 `MainForm` 控件事件逐条翻译成 Vue。

## 10. Phase 1A 仍待实机验证

用户特定媒体、模型与机器条件下的高负载 GUI 响应性仍待真实机器确认。

自动 fault injection 证明 supervisor / IPC 恢复状态机，但不能替代：

- 高负载时拖动和缩放主窗口。
- 页面切换和滚动。
- 主要 CPU / 内存是否落在 Core。
- 手动结束 Core 后 GUI 是否保持可用。
- 关闭 Shell 后 Core 是否正确退出。
- 模型真实下载、代理/直连、断点续传、取消与大模型解压是否符合预期。
- 删除真实模型后目录、缓存与未完成下载是否彻底清理。

不得把自动 CI 成功表述为这些实机项已完成。

## 11. 发布事实

当前开发候选版本：

- Development Version：`0.1.3`
- 当前正式 Release / RELEASE.md：`0.1.1`
- 开发版本允许领先正式 Release；只有明确授权正式发布时才更新 RELEASE.md

现有正式版本：

- Version：`0.1.1`
- Tag：`p105-v0.1.1`
- Release：`LocalSub v0.1.1`
- 发布源码：`225eafadb09f1553980153839f9d7c02bb79439c`

既有标签与 Release 不移动、不复用。

新架构开发不自动产生正式 Release。测试 EXE 走 CI Artifact。正式 Release 只有用户明确人工授权具体项目和具体版本后才能进入发布流程。

## 12. 恢复模板

```text
P105 LocalSub
main: <sha>
p105-stable: <sha / ahead-behind>
p105-exp: <sha / ahead-behind>
pre-migration baseline: 042329ede97b09cd375ebcf7c55d7245fc56b933
current phase: <phase>
open PR: <编号与方向>
latest exact-head CI: <run / result>
release tag: <当前正式标签>
release: <当前正式 Release>
real-machine pending: <待验证事项>
next action: <唯一明确断点>
```
