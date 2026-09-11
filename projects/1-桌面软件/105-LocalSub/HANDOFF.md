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
├─ WinForms 主界面，当前仍为默认入口与验证壳
├─ Phase 2A Vue/WebView2 主 Shell，当前为显式预览入口
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
└─ 后台离线 ASR
```

已迁入 Core 的后台与 realtime 重实现不得重新引入 GUI 进程内静默 fallback。

Core IPC 当前包括：

```text
ping
analyze
transcribe
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

当前 Phase：`2A` 第一版 Web Shell 代码闭环完成。

最后一个经过完整自动门禁的代码 head：

```text
3c31bd4951304ba637eee2fc8ed60d5f66fa6bc5
```

P105 Windows CI：

```text
run 34583489679
success
```

Artifacts：

```text
candidate
ID 10192663341
sha256:43b49a76775f3356fd45588dddf1689d8d46c1ed2363c6d96851f8e0abf5fd15

WebUi preview
ID 10192664092
sha256:4d58234254cecc0c213c6df02c4d82c8f06c10ee0861081d93aaa1f02914d204
```

该代码 head 已通过 Vue typecheck、Vite build、bundle 检查、1280×800 与 1600×1000 Edge 预览、Shell/Core publish、真实 WebView2 host、真实 `app.getSnapshot` bridge 往返，以及原有全部 P105 回归门。

默认启动路径尚未切换，正常运行仍进入旧 WinForms。当前 Web Shell 只作为显式预览和 CI host，避免在用户确认视觉方向前破坏现有入口。

下一步：

1. 不提升 stable，不动 main。
2. 用户先审看当前 Web Shell 视觉方向。
3. 继续完成真实 PotPlayer + 已安装 realtime 模型实机验证。
4. 下一代码阶段优先接通 Web realtime 页的 Shell 白名单命令，复用现有 Core realtime session，不复制旧 `MainForm` 逻辑。
5. 之后再迁模型、后台转写和设置编辑。
6. Web UI 始终只能消费 Application Contract。

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

不得把自动 CI 成功表述为这些实机项已完成。

## 11. 发布事实

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
