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

- `main` 保持全仓正式主线，允许因其他项目的稳定准入正常前进。
- `p105-stable` 保持改造前 P105 可运行基线。
- 新架构只在 `p105-exp` 推进；每个新阶段开始前按仓库规则把最新 `main` 正常合入 `p105-exp`，不得重置 P105 独有历史。
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

当前 Phase：`Phase 2B`。Web UI 已是默认入口。v0.1.18 完成后台、模型、设置、文档四页的全局一致性收口；v0.1.19 完成 Web 后台转写单文件闭环；v0.1.20 完成后台队列工作流；v0.1.21 完成全局 surface 色阶修正，解决用户指出的普通文字附近“白色背景 / 白纸贴片”感。

v0.1.21 直接参考 DavBridge v0.4.26 已验证方案，但只移植视觉原则，不复制业务代码。当前 surface 规则：

- canvas：淡蓝灰 `#f1f7fb`，深一级 `#eaf3f8`；
- quiet：`rgba(236,245,250,.72)`；
- soft：`rgba(241,248,252,.82)`；
- panel：`rgba(246,251,253,.90)`；
- raised：`rgba(252,254,255,.96)`；
- 普通信息 surface 使用 quiet / soft / panel，不再使用纯白或高透明白；
- About 透明融入 canvas；
- tooltip、输入、下拉、按钮等真实交互抬升面保留 raised；
- WebView2 宿主 BackColor / DefaultBackgroundColor 同步为 `#f1f7fb`，避免页面边缘和加载瞬间露出旧色阶。

本轮没有修改布局、字号、导航、batch、meter、Core、realtime、模型逻辑或 bridge 语义。meter 端到端链继续冻结在 v0.1.12 已验证实现。

v0.1.21 最后一个经过完整自动门禁的代码 exact head：

```text
5015859d42bb4696fc7d6f0afe3887e5d313c0da
```

P105 Windows CI：

```text
run 34764703148
success
```

Artifacts：

```text
candidate
ID 10319869640

WebUi preview
ID 10320750144
```

最终人工复核覆盖主页、About、模型库、设置页以及 1100×825 / 900×675 预览。普通文字区与 canvas 的层级已经连续，白色只保留在真正需要抬升的交互面。portable candidate 已通过 manifest 与隐私边界检查，不包含 WebView2 profile/cache、Cookies、History 或 Login Data。

下一步固定为：

1. 不提升 stable，不动 main，不创建正式 Release。
2. 用户实机验证 v0.1.21，重点确认高 DPI、真实 WebView2 字体抗锯齿环境下是否彻底消除“文字下方发白”观感。
3. 同时继续验证 v0.1.20 已完成的长媒体、整队转写、取消、TXT 导出，以及 realtime 长时间运行和模型真实下载/修复。
4. 实机信心足够后再进入 Phase 3，逐步退役旧 WinForms 业务页。
5. stable/main 提升与正式 Release 仍需用户对明确版本再次授权。

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

- Development Version：`0.1.17`
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
