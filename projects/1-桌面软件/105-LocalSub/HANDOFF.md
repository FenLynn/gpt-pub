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

当前 Phase：`Phase 2B`。Web UI 已是默认入口。当前开发候选为 **v0.1.24**。

### v0.1.24 固定 UI 原则与实时等待音源

用户已明确将以下原则作为 LocalSub 后续 UI 的默认约束：

- 简洁、清晰优先，主信息必须先被看到。
- 页面不可为了填满窗口而平均摊开内容，底部自然留白是允许的。
- 空间优先留给真正需要空间的内容，例如实时字幕、输入电平、媒体结果和任务结果。
- 页面只长期显示主标题、关键状态、主动作和关键值。
- 解释性小字尽量进入全局 tooltip / hover help，不长期占用版面。
- 不通过堆卡片、堆说明、加装饰制造“丰富感”。
- 能在一行完成的信息结构不要拆成两行。
- 下拉框只占满足内容的合理宽度，不默认拉满。
- 小屏保持层级与可读性，不通过无限缩小文字硬塞。
- UI 大改必须有明确实机问题或用户目标，避免无目标反复重构。

v0.1.24 按这些原则完成：

- 主页“运行概览”标题左侧取消装饰图标。
- 主页常驻小字大幅减少，说明移动到 tooltip。
- “启动方式”升级为与运行条件、实时配置、字幕显示、后台转写同级的第五行。
- 主页继续从顶部向下排列，底部自然留白。
- 实时页把音源与识别模型合并到同一横排。
- 每个实时控件内部使用“图标 + 标题 + 短下拉 + tooltip”，标题与下拉保持同一行。
- 实时页将更多纵向空间留给 30 秒电平图和字幕内容区。
- 实时页标题区不再长期显示模型说明小字，状态详细说明进入 tooltip。

PotPlayer 启动语义同时调整：

- 选择 PotPlayer 时，即使播放器尚未运行，“开始字幕 / 开始实时字幕”仍可点击。
- Shell 保存当前音源和模型为用户启动意图，并进入“等待 PotPlayer”。
- Shell 使用现有 1500 ms timer 持续检测 PotPlayer，不让 Vue 自行轮询 Windows 进程。
- PotPlayer 出现后自动调用既有 `LiveSessionController.StartAsync` 和 Core Process Loopback 链。
- 不允许静默回退到 All Audio。
- 等待期间音源和模型控件锁定，防止待启动目标漂移。
- 等待期间再次点击主按钮或调用 `live.stop` 会取消等待。
- 托盘开始/停止操作同样识别并可取消 pending 状态。

最后一个经过完整自动门禁的 **v0.1.24 代码 exact head**：

```text
00d29bc3c0917fe8458cea32386ec66f542785f2
```

P105 Windows CI：

```text
run 34833535741
success
```

Artifacts：

```text
candidate
ID 10343452102

WebUi preview
ID 10343142859
```

本轮未修改 realtime meter 算法、ASR PCM 数据链、Core Process Loopback 实现或模型推理逻辑。

### v0.1.22 已完成的产品能力

- Web 后台队列状态原子持久化，重启可恢复队列与已完成转写结果。
- 转写中异常退出的项目恢复为“上次任务中断，可重试”。
- 全部转写跳过已完成项目与缺失源文件。
- 单项重试。
- 默认输出目录与 Explorer 打开目录。
- 开始长转写前真实检查输出目录可写性与最低磁盘空间。
- 单项 SRT / VTT / TXT 导出。
- 整队一次导出 TXT / SRT / VTT。
- 模型下载沿用现有断点续传、缓存损坏清理和重新解压链，Web 模型页增加 repair / continue 入口。
- 模型安装健康判定不再只看路径存在，关键文件必须非空，关键目录必须包含实际非空文件。
- productization smoke 真实覆盖队列 JSON 往返、完成结果恢复、TXT/SRT/VTT 文件生成。
- 文档页已扩展为 7 项实际工作流说明。

### v0.1.23 当前视觉基线

用户否定 v0.1.22 的整体蓝灰铺底与首页纵向间距。v0.1.23 已直接读取 DavBridge 当前 `styles.css / overview.css` 对齐，而不是凭截图近似。

固定视觉原则：

- Shell 外层使用 DavBridge 同类浅色渐变：`#f5fafe → #f1f7fb → #eaf3f8`。
- `workspace / page` 不再强制铺整片 `#f1f7fb`，内容页透明叠在 Shell 上。
- near-white raised 只给按钮、输入、下拉、tooltip 等真正交互抬升面。
- 蓝色用于主要功能，绿色用于 ready / complete，紫色用于字幕、后台或模型辅助层级。
- 主页不再使用 `flex:1 + minmax(...,1fr)` 把四行平均撑满视口。
- 主页从顶部连续向下排列，1100×825 下四行固定 104 px，功能图标 58 px，行标题 18 px，主标题 29 px；底部允许自然留白。
- 900×675 使用独立响应式节奏，四行 82 px，保持可读性且不横向溢出。
- 左侧导航继续保持 DavBridge 式一级导航，不改回顶部 Tab。

### v0.1.23 绿色包边界

最终验包曾发现 smoke 运行态 `Data/Batch/queue-state.json` 混入中间候选。已在同一 v0.1.23 内修复：

- 打包前删除整个 `publish/Data`。
- 压缩前拒绝任何 `queue-state.json`。
- 重新解包候选后再次拒绝 `Data/` 与 `queue-state.json`。
- 继续拒绝 WebView2 profile/cache、Cookies、History、Login Data。
- 最终候选包 manifest 共 10 个正式文件，人工逐项校验尺寸与 SHA256 全部通过。

最后一个经过完整自动门禁的 **代码 exact head**：

```text
9704026a3dcc042256ae5983031f88ba71ff8272
```

P105 Windows CI：

```text
run 34796680266
success
```

Artifacts：

```text
candidate
ID 10329834406

WebUi preview
ID 10330465400
```

当前用户侧文件：

```text
LocalSub-v0.1.23-Windows-x64-full-candidate.zip
LocalSub-v0.1.23-double-EXE-update.zip
LocalSub-v0.1.23.exe
LocalSub.Core-v0.1.23.exe
LocalSub-v0.1.23-SHA256.txt
```

下一步固定为：

1. 用户实机首先验证 v0.1.24：关闭 PotPlayer 时点击开始，确认进入等待状态；随后启动 PotPlayer，确认自动进入识别；再验证等待可取消。
2. 检查 1100×825 与真实 Windows DPI 下主页和实时页的新紧凑布局。
3. 同时验证真实长媒体、跨重启队列恢复、中断重试、SRT/VTT/TXT 导出与整队导出。
4. 验证真实模型下载、断点续传、损坏缓存重试与 repair。
5. 继续长时间验证 realtime、PotPlayer 窗口跟随、meter 和 Overlay。
6. 只有上述实机信心足够后，才进入 Phase 3 逐步退役旧 WinForms 业务页。
7. 不提升 stable，不动 main，不创建正式 Release，除非用户对明确版本再次授权。

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

- Development Version：`0.1.24`
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
