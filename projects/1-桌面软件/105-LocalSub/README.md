# P105｜LocalSub

LocalSub 是 Windows 本地实时字幕与后台媒体转写工具，优先服务 PotPlayer，也支持捕获 Windows 输出音频。核心 ASR 本地运行，不依赖云端 API。

## 项目身份

- GPT-Pub 正式编号：`P105`
- 正式路径：`projects/1-桌面软件/105-LocalSub/`
- 日常开发：`p105-exp`
- 稳定候选：`p105-stable`
- 正式主线：`main`
- 固定流转：`main → p105-exp → p105-stable → main`
- P105 长期只保留 `p105-exp` 与 `p105-stable` 两条项目分支。
- 旧 `p103-localsub-*` 仅属于编号错误的历史，不再作为活动开发入口。

## 当前架构基线

Phase 1A 与 Phase 1B.1 第一闭环已经形成：

```text
LocalSub.exe
├─ Vue 3 + TypeScript / WebView2 主界面，v0.1.3 起默认入口
├─ 旧 WinForms 备用界面，仅显式 `--legacy-ui` 启动
├─ 托盘
├─ WebView2 字幕 Overlay
├─ PotPlayer 进程发现与窗口跟随
├─ realtime Shell proxy
└─ Named Pipe IPC
        ↓
LocalSub.Core.exe
├─ WASAPI / PotPlayer Process Loopback
├─ realtime Streaming ASR
├─ SenseVoice / Fun-ASR-Nano realtime
├─ VAD / realtime decode queue
├─ 媒体解析与波形
├─ 后台离线 ASR
└─ 模型下载、解压、校验与重型删除
```

已经迁入 Core 的后台和 realtime 重实现禁止静默回退到 GUI 进程。Core 异常时当前任务明确失败，`LocalSub.exe` 应继续存活，后续操作按 supervisor 规则恢复。

Shell 编译已经排除 realtime 重实现与 Process Loopback。PotPlayer 的进程发现、窗口位置、最小化状态与字幕 Overlay 仍属于 Shell。

详细架构见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 运行与分发边界

- Windows x64。
- `.NET 8` framework-dependent single-file。
- `LocalSub.exe` 与 `LocalSub.Core.exe` 同目录。
- 模型默认在 EXE 同级 `ASR/`，不进入基础包。
- sherpa native runtime 位于 `ASR/_runtime/`，不进入基础包。
- FFmpeg 为外部可选组件，优先复用 Mediova、手动路径或系统 PATH。
- 不将 ONNX Runtime、sherpa native runtime、模型或 FFmpeg 打入基础绿色包。

构建与增量覆盖说明见 [`docs/BUILD.md`](docs/BUILD.md)。

## 当前状态

- 当前开发候选版本为 v0.1.5；正式 Release 仍为 v0.1.1，既有正式标签与 Release 保持不可变。
- 每个面向用户交付测试包的开发轮次默认递增一次 patch 版本，并提供 exact-head CI 对应 EXE/候选包。
- 本轮新架构改造前，`main = p105-stable = p105-exp = 042329ede97b09cd375ebcf7c55d7245fc56b933`。
- `p105-stable` 与 `main` 从该点保持为改造前可运行基线，新架构只在 `p105-exp` 推进。
- Phase 1A 自动门禁已覆盖 Core IPC、Core 强杀与 generation 2 重连、Shell 启动、后台工作区、Process Loopback、sherpa runtime 与 native offline ASR。
- 用户特定媒体、模型和机器条件下的高负载 GUI 响应性仍属于实机待验证项。
- Phase 1B.0 Application Contract 已完成第一版。
- Phase 1B.1 realtime Core 迁移第一闭环已完成，最后完整验证代码 head 为 `944cc4674b3fecefae5ef88c1c4bc88f30918013`，CI run `34581474053` success。
- Phase 2A Web Shell 第一闭环已完成，Vue 3 + TypeScript + Vite production bundle 已嵌入 `LocalSub.exe`，真实 WebView2 bridge smoke 已通过。
- Phase 2A 最后完整验证代码 head 为 `3c31bd4951304ba637eee2fc8ed60d5f66fa6bc5`，CI run `34583489679` success。
- Phase 2B 实时字幕页第一闭环已完成，Web bridge 已接入 `live.start / live.stop`，并通过独立 `LiveSessionController` 复用现有 Core realtime session，没有把旧 `MainForm` 业务逻辑复制到 Vue。
- Phase 1B.2 模型重任务迁 Core 第一闭环已完成：重型 `ModelManager` 仅编入 Core，Shell 使用 proxy，且不再依赖 SharpCompress。
- Phase 2B 模型页第一闭环已完成：Web bridge 已接入 `model.list / model.select / model.download / model.cancel / model.delete`，并显示模型任务进度、错误和取消状态。
- 旧 WinForms realtime、后台与模型任务已统一到 shared Core broker，模型删除进入破坏性阶段后不可由用户取消。
- v0.1.3 起普通双击 `LocalSub.exe` 默认进入 Web UI。旧 WinForms 不再默认出现，仅通过 `LocalSub.exe --legacy-ui` 或 `LOCALSUB_LEGACY_UI=1` 作为迁移期备用入口。
- WebShell 已挂接既有托盘控制器与 UI 响应监控，默认入口切换不牺牲这两项 Shell 能力。
- v0.1.5 根据用户实机反馈纠正视觉方向：恢复 DavBridge 风格左侧一级导航，右侧工作区保持严格单栏；默认窗口改为 1100×825 的 4:3，最小窗口为 900×675。
- 页面说明文字大幅收缩，辅助原理与边界说明改为浅色全局 Tooltip；Tooltip 使用 Vue Teleport 挂到 body，z-index 提升到全局最高层，避免旧黑底样式和被卡片遮挡。
- 左侧导航、页面标题、表单、模型条目和设置项重新放大；页面及设置使用更大的线性 SVG 图标，配色对齐最新版 DavBridge 的浅色蓝白基线。
- v0.1.5 的实时、后台、模型、设置、文档五页 1100×825 预览和实时页 900×675 预览已人工检查，右侧无页面级二次分栏，缩小窗口也无明显横向溢出。
- 当前最新完整验证代码 head 为 `5b575d45a3f09f9c20e0e0377a88283466548139`，P105 Windows CI run `34701810199` success；candidate Artifact `10300570629`，WebUi preview Artifact `10299584948`。
- 详细边界见 [`docs/APP_CONTRACT.md`](docs/APP_CONTRACT.md)。

当前状态证据见 [`阶段记录.md`](阶段记录.md) 和 [`工作记录.md`](工作记录.md)。

## 开发入口

接续开发前按以下顺序读取：

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. 本目录 [`开发约束.md`](开发约束.md)
5. 本文件
6. [`阶段记录.md`](阶段记录.md)
7. [`工作记录.md`](工作记录.md)
8. [`设计与演进.md`](设计与演进.md) 与相关 `docs/`
9. `p105-exp / p105-stable / main`、PR、当前 head CI、tag 与 Release

跨对话恢复使用 [`HANDOFF.md`](HANDOFF.md)。