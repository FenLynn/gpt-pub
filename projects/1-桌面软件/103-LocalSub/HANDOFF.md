# LocalSub HANDOFF

## 项目定位

Windows 本地实时字幕与后台视频转写工具，优先服务 PotPlayer，同时支持捕获所有 Windows 输出音频。核心 ASR 本地运行，不依赖云端 API。

## 当前用户决策

- Mediova 与 LocalSub 暂不合并，未来若统一入口只考虑轻量总控/启动器。
- 当前核心语言限定中文、英文，翻译和多语言专项优化延后。
- 当前阶段以完整候选和真实实机问题修复为主，不继续无边界增加功能。
- FFmpeg 优先复用已有 Mediova/系统 FFmpeg，独立下载只作为兜底。
- 日常交付默认给相对上一用户版的增量覆盖 ZIP。

## 硬约束

- Windows 绿色 ZIP。
- `.NET 8` framework-dependent single-file，不引入 `.NET 10`。
- 模型不进入程序包，默认位于 EXE 同级 `ASR`，路径可配置。
- sherpa native runtime 位于 `ASR\_runtime`，程序补丁不重复携带。
- PotPlayer 模式只能做进程专用捕获，不得静默回退为全系统音频。
- FFmpeg、模型等大型组件独立管理。

## 当前开发状态

- 分支：`p103-localsub-exp`
- 版本：`v0.1.0-dev`
- 当前运行功能 head：`117b5b0e2c4f1d82d48fab1e50b982c04f19fa3c`
- Windows CI run：`31995510384`，结论 `success`。
- 该 run 已通过：publish、绿色包检查、EXE 真启动、后台工作区真切换、Windows Process Loopback 真激活、sherpa native runtime 加载、native 离线 ASR 真解码、最终打包。
- CI 已增加 `concurrency + cancel-in-progress`，同一开发分支的新 commit 会取消过期 Windows 构建，减少 CI 浪费。

## 已实机确认基线

- `所有音频 + Streaming Paraformer 中英 INT8` 可真实出字幕，但用户认为准确率一般，定位为低延迟档。
- `Streaming Zipformer Large 中文 INT8` 实机可用，用户反馈明显好一些，当前中文实时推荐基线。
- PotPlayer 普通窗口和全屏 overlay 已实机可见。
- PotPlayer 快进/快退曾出现 `HRESULT 0x8000FFFF`，恢复 supervisor 已改为按 PCM 失活判断和退避重试，用户反馈较旧版“好一点”，仍需持续实机验证。
- 后台 MP4 可由 Media Foundation 正常解析并生成波形。
- 后台离线 ASR 早期依次暴露 `0 段`、managed Result NullReference、CreateStream=0，现已迁移到直接 sherpa C API，并有 Windows native offline ASR 真烟测。
- 2026-08-17 用户实机反馈：SenseVoice 后台“还可以”；Fun-ASR-Nano 实际体验很差、像“不干活”。因此模型定位和 Fun-ASR 后台分段策略已重构。

## 实时字幕

- 音源：`PotPlayer` / `所有音频`。
- PotPlayer 使用 raw COM Process Loopback，Windows 10 build 19041+ 实际尝试，不静默回退。
- `ResilientPotPlayerCaptureService`：标题变化不再立即拆流，PCM 真失活后才重建；恢复退避约 0.35 / 0.7 / 1.2 / 2 / 3 秒；真正重建时清旧 PCM 和当前流式句状态，但不重新加载模型。
- WebView2 overlay 非激活、鼠标穿透、持续 TopMost，支持普通窗口、最大化和全屏。
- 字幕最多当前句 + 上一句，默认 3 秒无更新消失。
- 字幕设置支持：自动/固定字号、自动字号倍率 60%~160%、当前字幕颜色/字重、上一条大小比例/颜色/透明度/字重、描边颜色/粗细、阴影强度、底部偏移、最大宽度、底纹和持续时间。
- Fun-ASR-Nano 已从实时模型 catalog 移除，不再作为实时字幕候选；保留后台实验用途。

## 模型定位

- Zipformer CTC Small 中文 INT8，约 26 MB：超轻实时。
- Zipformer CTC Large 中文 INT8，约 155 MB：推荐实时。
- Zipformer Large 中文 INT8，约 160 MB：推荐实时，已有较好实机反馈。
- Streaming Paraformer 中英 INT8，约 237 MB：中英低延迟档。
- SenseVoice Small INT8，约 230 MB：推荐后台/模拟实时，当前实机可用。
- Offline Zipformer CTC 中文 INT8，约 350 MB：推荐中文后台，高性价比。
- **FireRedASR2 CTC 中英 INT8，约 740 MB：新增推荐后台候选，中英、CTC 快速解码。**
- Zipformer CTC XLarge 中文 INT8，约 728 MB：大模型实时候选。
- Zipformer XLarge 中文 INT8，约 736 MB：最大实时档。
- Fun-ASR-Nano INT8，约 0.9 GB：**实验后台**，LLM 解码较重，不推荐实时。
- Silero VAD，约 2 MB：语音段检测组件。

模型页显示语言、体积、实时性、准确率、性价比和安装状态。已安装且关键文件存在显示黑色，未安装显示浅灰色；实时/后台下拉框只显示对应能力且已安装的模型。

## 后台转写

链路：

`媒体 -> Media Foundation / FFmpeg fallback -> 16 kHz mono -> Silero VAD -> 自适应 RMS fallback -> Offline ASR -> 时间戳 transcript -> 关键词 -> TXT / JSON`

已实现：

- 视频/音频拖放、多文件队列、转写选中/全部、取消。
- Media Foundation 优先，FFmpeg fallback；FFmpeg 可复用 Mediova/手动路径/系统 PATH。
- Silero VAD + 自适应 RMS fallback + 宽松 8 秒 fallback。
- native C API 离线 recognizer 支持 SenseVoice、Offline Zipformer CTC、FireRedASR2 CTC、Fun-ASR-Nano。
- 转写正文时间戳与关键词高亮。
- TXT 手工导出，结构化 JSON 自动保存到 `Data\Transcripts`。
- RTF、进度、分段数、日志 `Logs\batch.log`。
- 后台工作区延迟加载。

### Fun-ASR-Nano 专项策略

Fun-ASR-Nano 不再按每个很短的 VAD 段立即启动一次 LLM 解码。当前后台会：

- 合并相邻语音段；
- 目标上下文约 7 秒；
- 最长约 11 秒；
- 间隔不超过约 1.1 秒的语音段可合并，并用静音保持时间关系；
- 日志写入 `FUNASR_MERGE`；
- UI 阶段显示 `Fun-ASR 长段识别`。

目标是减少 LLM 重复启动和短片段空结果。Fun-ASR 仍属于实验后台模型，不再作为产品主力。

## 声音轨道

2026-08-17 已完成第二轮视觉优化：

- 继续使用 99.5% 高分位作为视觉参考，主要有效峰值映射到轨道约 95%，不改变真实 PCM/VAD/ASR 输入。
- 由黑色竖针改为平滑的上下对称填充包络，并增加细轮廓。
- 使用浅色轨道背景和弱化中线。
- 增加 25% / 50% / 75% 时间网格，并显示 0%~100% 五个时间标签。
- 已识别语音段显示轻量半透明区域。
- 关键词使用独立竖线和顶部三角 marker。
- 顶部显示 `声音包络 · 自动增益 95%`，有结果后显示语音段数和关键词命中数。

## 离线 ASR 关键修复

- LocalSub 使用 `NativeOfflineRecognizer` 直接 P/Invoke sherpa-onnx 1.13.4 C API。
- native config 按官方 C 示例语义零初始化，只填写当前模型家族需要字段，未使用指针保持 NULL。
- Windows 路径使用 UTF-8 marshaling。
- 结果使用 `SherpaOnnxGetOfflineStreamResultAsJson()`，空指针安全处理。
- compatibility bridge 保持 batch/VAD/fallback 调用结构不变。
- CI native offline ASR smoke 会临时下载官方小型 TDNN yes/no 模型，实际执行 CreateRecognizer -> CreateStream -> AcceptWaveform -> Decode -> JSON result，并验证非空文字；测试模型和 runtime 不进入发布包。

## 性能与系统

- 资源模式：节能 / 自动 / 最大性能，默认自动。
- 可选最小化到托盘和当前用户开机启动。
- 冷启动耗时写入 `Logs\startup.log`。
- 模型加载与 PotPlayer 捕获可并行启动。

## 本阶段明确不做

- 翻译。
- 多语言专项优化。
- 说话人分离。
- 会议总结。
- 云端 LLM。
- 重型字幕编辑器。
- Mediova 源码合并。

## 下一实机验收断点

后台优先：

1. 用 SenseVoice 再确认已有后台基线没有回归。
2. 下载 FireRedASR2 CTC 后用同一中文/中英视频对比 SenseVoice、Offline Zipformer CTC、FireRedASR2 CTC 的准确率、RTF 和 CPU。
3. Fun-ASR-Nano 仅作为实验后台复测，观察 7~11 秒合并后是否比旧版更有输出，不再把它当主力。
4. 检查新声音轨道的可读性，确认弱音频展开、网格、语音区间和关键词 marker 都清晰。
5. MKV/WebM 验证 FFmpeg fallback 和 Mediova FFmpeg 复用。

实时继续：

1. Zipformer Large + PotPlayer 连续小幅/大幅快进快退。
2. 连续换 2~3 个视频，确认无需重新点击开始即可自动恢复字幕。
3. 真正重建后不应拼接跳转前旧半句话。
