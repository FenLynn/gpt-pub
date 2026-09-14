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

- v0.1.23 直接按 DavBridge 当前 WebUI 源码重做配色与主页纵向节奏：外层浅色渐变，内容页透明，近白 raised 只用于真正交互面；主页四条状态行不再拉伸填满视口，改为从顶部连续向下排列，58 px 功能图标、18 px 行标题与更大的状态文字建立清晰层次，底部自然留白。1100×825 与 900×675 已人工检查。
- v0.1.23 同时加强绿色包边界：CI 打包前删除运行态 `Data/`，并在压缩前与重新解包后拒绝任何 `queue-state.json`。最终候选人工拆包确认不含运行态 Data、WebView2 profile、Cookies、History 或 Login Data，manifest 10 个正式文件逐项验证通过。
- v0.1.22 完成后台产品化：队列与已完成结果跨重启恢复，中断项可重试；支持默认输出目录、输出可写性/磁盘空间预检、SRT/VTT/TXT 单项与整队导出；模型支持继续修复，健康检查要求关键文件非空。productization smoke 已真实验证队列 JSON 与三种字幕格式输出。
- v0.1.21 按 DavBridge v0.4.26 的 surface 色阶方案修复普通文字附近“白色背景 / 白纸贴片”感。页面 canvas 统一为淡蓝灰，普通信息区使用 quiet / soft / panel 三档淡蓝灰 surface，About 透明融入 canvas；tooltip、输入框、按钮等真正抬升的交互面继续保留近白色。
- v0.1.20 已完成 Web 后台转写队列闭环：单项与整队转写、队列移除与二次确认清空、队列总进度与取消、每项分段数和 RTF、TXT 原生导出、关键词持久化以及结构化记录自动保存均已接入。
- v0.1.19 完成 Web 后台转写第一闭环，打通 Vue → WebView2 bridge → Shell → Core 的文件选择、媒体分析、波形、单文件转写与取消。
- v0.1.18 完成后台、模型、设置、文档四页的全局视觉一致性收口，统一标题、页内 Tab、内容宽度、行高与滚动区。
- v0.1.17 完成首页信息密度与层级精修：主区标题改为“运行概览”，四条状态行收紧但不拥挤，启动方式锚定底部，工程化说明改为更直接的用户文案；1100×825 与 900×675 均已人工复核。
- v0.1.16 已将“文档”从左下辅助区移入上方主导航，与 DavBridge 的导航分组一致；左下只保留“设置”和“关于”。
- v0.1.15 已把版本号直接放到左上品牌区，并新增独立“关于”页。About 页按 DavBridge 同类结构显示版本、运行环境、双进程架构、Core 状态、识别方式与界面技术栈。
- v0.1.14 主页控制中心与 v0.1.13 realtime 页面结构继续保留，meter/Core 链保持 v0.1.12 已验证实现。
- 当前开发候选版本为 v0.1.23；正式 Release 仍为 v0.1.1，既有正式标签与 Release 保持不可变。
- 每个面向用户交付测试包的开发轮次默认递增一次 patch 版本，并提供 exact-head CI 对应 EXE/候选包。
- 本轮新架构改造前，`main = p105-stable = p105-exp = 042329ede97b09cd375ebcf7c55d7245fc56b933`。
- `p105-stable` 继续保存改造前 P105 可运行基线。仓库 `main` 可因其他项目正常前进；开始 v0.1.14 前已把最新 main 正常合入 `p105-exp`，未重置或覆盖 P105 独有历史。
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
- v0.1.6 新增主页作为默认页，集中显示 Core、实时模型、音源/PotPlayer、后台模型自检，并提供一个主按钮启动或停止实时字幕。
- 实时字幕页改为自然单栏设置行，新增可开关的实时输入电平历史波形。Vue 仅累计 Core 已节流的归一化 `live.level`，不接触原始音频。
- 模型页改为“配置 / 模型库”两个页内 Tab。默认只显示实时模型、后台模型和 VAD 配置，模型库使用表格呈现语言、体积、实时、准确、性价比、状态与操作。外层工作区禁止滚动，模型库和设置页仅在内部需要时滚动，滚动条默认隐藏并在悬浮时出现。
- 设置页已接入真实 `settings.update` 白名单命令，可编辑字幕、启动与运行设置，并支持字幕即时预览。Windows 启动项由 Shell 写入当前用户 HKCU，不需要管理员权限。
- 生命周期新增 `--startup-silent`、静默托盘启动、托盘开始/停止实时字幕、启动后自动实时字幕。PotPlayer 模式在播放器未出现时保持“等待 PotPlayer”，不得静默回退为所有音频。
- v0.1.7 根据第二轮实机反馈继续收口：主页改为纵向状态清单并把实时主操作移动到右上角；实时页顶部集中瞬时电平 bar、输入监视开关和运行状态，输入历史扩大为约 30 秒，字幕区独立滚动且当前字幕加粗；设置滚动区预留安全边距；文档字号提升；背景统一。
- 托盘图标改为 Shell 正常启动后始终存在，左下状态区改为 DavBridge 风格业务状态，区分运行、等待、异常、就绪与待配置。
- v0.1.8 将 `live.level` 从约 10 Hz 提升到约 30 Hz，并新增 Shell 到 Web 的独立轻量 `live.level` 事件。电平样本不再触发完整 `app.snapshot`，顶部 bar 直接使用高频事件，历史图每 3 个样本记录一次，保持约 30 秒窗口。
- 实时历史波形改为单条 XY 曲线，不再使用上下镜像。实时页顶部按最新版 DavBridge 的“状态与动作分离”思路拆分，状态为独立图标与文字，主按钮使用固定动作槽。普通工作区背景统一为实色浅蓝灰，减少文字周围的发白层次感。
- v0.1.9 曾尝试以 ASR 输入 RMS 驱动 meter，但用户实机确认 PotPlayer 播歌时仍几乎不动。复查旧 WinForms 基线后确认，旧界面已验证灵敏的输入进度条实际使用 capture service packet peak。
- v0.1.10 恢复旧 WinForms capture `LevelChanged` 后，用户仍确认 PotPlayer 播放且字幕可识别时 meter 基本无动态，因此继续全链复查。
- v0.1.11 将 meter 与 ASR 数据源彻底合并：`LiveAsrPipeline.OnSamples` 对真正写入 ASR queue 的同一块 16 kHz mono PCM 直接计算 instantaneous peak `max(abs(sample))`。不使用 RMS、dB 映射或 release smoothing，也不再依赖 capture-only `LevelChanged` 支路。
- Core、IPC client 与 WebShell 新增每秒一次的 meter 诊断摘要。若实机仍异常，可直接比较 Core `LIVE_METER`、`Logs/core-client.log` 的 `LIVE_METER_RX` 与 `Logs/meter-web.log`，精确定位哪一层丢失动态。
- Shell/Web 继续使用独立约 30 Hz 轻量 `live.level`，不恢复整页 snapshot 高频刷新。实时页三段结构和 LocalSub 正式应用图标继续保留。
- v0.1.12 使用用户实机日志把故障精确锁定到 WebShell 到 Vue：Core、IPC client 和 WebShell 均已收到明显动态 meter。WebShell realtime callback 现严格先 marshal 回 UI 线程，再访问 WebView2；Vue 运行态 meter 不再被 snapshot 覆盖；新增浏览器 ACK 日志 `Logs/meter-browser.log`。
- CI 的真实 WebView2 smoke 现在注入 `live.level=0.73`，只有 Vue `applyLiveLevel` 回传 `0.7300` ACK 才通过，形成 Shell→WebView2→bridge→Vue 的端到端 meter 门禁。
- v0.1.13 realtime 页面已在不改 meter/Core 链的前提下完成 DavBridge 风格精修，固定动作槽、黄色停止按钮、30 秒低高度历史和字幕主视觉已经形成。
- v0.1.14 首页重构为真正的控制中心：顶部固定显示模块身份、当前业务状态与唯一主操作；下方只解释运行条件、实时配置、字幕显示与后台能力；开始按钮为绿色、停止按钮为黄色、不可操作态为灰色，按钮槽始终固定。
- v0.1.14 同时修正绿色包边界。真实 WebView2 smoke 生成的 `WebView2/` profile/cache 会在打包前明确清除，CI 额外拒绝 Cookies、History、Login Data 等运行状态进入候选包。
- v0.1.15 左上品牌区不再显示“本地字幕”副标题，改为显眼的版本徽标；左侧辅助导航新增“关于”。
- v0.1.15 About 页采用 DavBridge 同类居中产品卡，显示版本、Windows x64 / .NET 8、LocalSub.exe + LocalSub.Core.exe、Core generation、本地离线 ASR 与 Vue 3 + WebView2。
- v0.1.16 主导航顺序固定为“主页 / 实时字幕 / 后台转写 / 模型 / 文档”，辅助导航固定为“设置 / 关于”。
- v0.1.17 进一步统一首页与 realtime 页的内容宽度、边距和信息密度，保留 DavBridge 式浅色单栏结构。
- 当前最新完整验证代码 exact head 为 `9704026a3dcc042256ae5983031f88ba71ff8272`，P105 Windows CI run `34796680266` success；candidate Artifact `10329834406`，WebUi preview Artifact `10330465400`。
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