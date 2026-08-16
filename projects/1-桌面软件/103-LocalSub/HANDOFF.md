# LocalSub HANDOFF

## 项目定位

Windows 本地实时字幕与后台视频转写工具。优先服务 PotPlayer，同时支持捕获所有 Windows 输出音频。核心 ASR 本地运行，不依赖云端 LLM/API。

## 当前用户决策

- Mediova 与 LocalSub 暂不合并。未来若需要统一入口，只考虑轻量总控/启动器，不进行源码硬合并。
- 当前核心语言限定中文、英文。多语言专项优化与翻译延后。
- 当前阶段以完整候选为主，后续集中实机验收并按真实问题修复。
- FFmpeg 不应在 LocalSub 和 Mediova 重复下载。LocalSub 应优先复用用户已有 FFmpeg，独立下载仅作为兜底。

## 硬约束

- Windows 绿色 ZIP，解压即用。
- `.NET 8`、framework-dependent、single-file，不要求 `.NET 10`。
- 模型不进入程序包，默认位于 EXE 同级 `ASR`，可在设置修改模型根目录。
- 模型独立下载、删除和后续升级。
- 下载支持系统代理、直连、SOCKS5，支持断点续传与重试。
- 音源只保留 `PotPlayer` 与 `所有音频`；PotPlayer 模式不得静默回退成全系统音频。
- 自有可下载组件尽量位于 EXE 目录树。
- 日常交付默认只给相对上一用户版发生变化的增量覆盖 ZIP。

## 当前开发状态

- 分支：`p103-localsub-exp`
- 版本：`v0.1.0-dev`
- 当前功能 head：`a7b951080b963ed296597f7c2fc5baec7e1050fc`
- Windows CI run：`31928257348`，结论 `success`。
- 该 run 已通过：publish、绿色包检查、EXE 真启动、后台工作区真切换 smoke、Windows Process Loopback 真激活、sherpa native DLL 真加载、最终打包。
- CI 不携带用户大模型，因此模型实际准确率、真实长视频转写结果、PotPlayer 连播/快进快退恢复仍属于实机验收项。

## 已实机确认基线

- `所有音频 + Streaming Paraformer 中英 INT8` 可以真实出字幕，主音频/ASR/HTML 输出链已跑通。
- Paraformer 准确率一般，定位为低延迟档。
- `Streaming Zipformer Large 中文 INT8` 用户反馈更好且可用，当前中文实时推荐基线。
- PotPlayer 普通窗口和全屏字幕 overlay 已实机可见，全屏链非回归不再重构。
- 2026-08-16 用户首次验证后台页：MP4 可由 Media Foundation 正常解析并生成波形；FFmpeg 下载曾出现 `416 Requested Range Not Satisfiable`，已修复并支持直接复用 Mediova FFmpeg。
- 2026-08-16 用户再次验证后台：4:59 MP4 成功完成 Media Foundation 音轨读取，但 Fun-ASR-Nano 结果显示 `完成：0 段，RTF 0.01`，正文为空。该现象明确定位为后台 Silero VAD 未产生语音段，不是 FFmpeg 解码失败。
- 2026-08-16 用户实机反馈 PotPlayer 快进/快退后偶发停止字幕，并出现 `HRESULT 0x8000FFFF` 的 Process Loopback 初始化失败。旧 supervisor 会把标题变化直接当作必须重建音频会话，恢复动作过于激进。

## 实时字幕已实现

- 所有音频：WASAPI endpoint loopback -> mono -> 16 kHz -> ASR -> HTML 字幕。
- PotPlayer：Windows process loopback 按 PID 捕获，不回退全局音频。
- `ResilientPotPlayerCaptureService` 自动处理 PotPlayer PID 变化、媒体切换、跳转和捕获会话静默失活。
- 标题变化不再立即拆掉 Process Loopback。由于捕获本身按 PID 工作，换片/跳转时优先保留当前会话，只有 PCM 持续中断才重建。
- PCM 中断恢复采用稳定等待和退避重试：约 0.35 / 0.7 / 1.2 / 2 / 3 秒，单次 `0x8000FFFF` 不再把整个实时字幕判死。
- 首次启动也允许瞬时 Process Loopback 激活失败后自动重试，连续 6 次仍失败才把启动判为失败。
- 真正重建音频会话时，实时管线会清理旧的排队音频；Zipformer/Paraformer 当前流式句状态同时 Reset，但模型本身不重新加载。
- 模型加载与 PotPlayer 音频连接并行，缩短点击开始后的等待。
- 真流式模型：Streaming Paraformer、Zipformer Transducer、Zipformer CTC。
- SenseVoice：Silero VAD + RMS fallback 模拟流式。
- Fun-ASR-Nano：Silero VAD 分段，停顿后整句解码，准确率优先、延迟较高。
- 字幕最多当前句 + 上一句，默认 3 秒无新结果后消失。
- 默认无整块黑底，白字细黑描边/轻阴影，基准 28 px。
- 基础设置：自动/固定字号、底部偏移、最大宽度、底纹/透明度、显示时长。
- 高级字幕样式：自动字号倍率 60%~160%、当前字幕颜色/字重、上一条字号比例/颜色/透明度/字重、描边颜色/粗细、阴影强度。
- 自动字号倍率在播放器自动计算字号后继续做相对放大/缩小，不再出现“开启自动后无法微调大小”。
- 高级样式修改会立即写入配置并同步当前 MainForm settings，使现有预览/实时 overlay 可以直接使用。
- overlay 非激活、鼠标穿透、持续 TopMost，跟随普通窗口、最大化、全屏和最小化。

## 模型与运行库管理

- ModelManager 支持扫描、关键文件校验、下载、缓存、断点续传、重试、删除、状态/速度/日志/取消。
- `.tar.bz2` 使用 SharpCompress `ReaderFactory`，损坏缓存自动清理。
- sherpa win-x64 native runtime 固定 1.13.4，首次需要时放入 `ASR\_runtime`，程序补丁不重复携带。
- publish 阶段剥离 NuGet 传递带入的 ONNX Runtime / sherpa native DLL。
- 模型页包含语言、体积、实时性、准确率、性价比、安装状态。
- 已安装且关键文件完整显示黑色；未安装显示浅灰色。
- 实时/后台下拉框只出现对应能力且已经安装校验通过的模型。

当前 catalog 主要模型：

- Zipformer CTC Small 中文 INT8，约 26 MB。
- Zipformer CTC Large 中文 INT8，约 155 MB。
- Zipformer Large 中文 INT8，约 160 MB。
- Streaming Paraformer 中英 INT8，约 237 MB。
- SenseVoice Small INT8，约 230 MB。
- Offline Zipformer CTC 中文 INT8，约 350 MB。
- Zipformer CTC XLarge 中文 INT8，约 728 MB。
- Zipformer XLarge 中文 INT8，约 736 MB。
- Fun-ASR-Nano INT8，约 0.9 GB。
- Silero VAD，约 2 MB。

## 后台转写

完整链路：

`媒体 -> Media Foundation / FFmpeg fallback -> 16 kHz mono -> Silero VAD -> 自适应音量 fallback -> Offline ASR -> 时间戳 transcript -> 关键词 -> TXT / JSON`

当前能力：

- 视频/音频拖放和文件队列。
- 添加、移除、清空、转写选中、全部转写、取消。
- 优先使用 Windows Media Foundation 读取音轨。
- Media Foundation 不支持时再使用 FFmpeg。
- 流式读取媒体，不把整部视频一次性载入内存。
- 后台模型支持 SenseVoice、Offline Zipformer CTC、Fun-ASR-Nano。
- Silero VAD 产生语音段并生成开始/结束时间戳。
- RMS + peak 声音波形。
- 波形叠加已识别语音区间，关键词命中显示标记。
- 转写正文显示时间戳，关键词高亮。
- TXT 手工导出。
- 每个完成文件自动保存结构化 JSON 到 `Data\Transcripts`。
- 显示转写进度、分段数、解码器和 RTF。
- 多文件顺序连续转写，单个失败不阻断后续，取消时保留已完成结果。
- 后台工作区延迟加载，首次进入后台 Tab 才构建重 UI。

### 2026-08-16 后台修复

- 队列状态改为动态 OwnerDraw，波形就绪后不再长期显示“待处理”。
- 后台 ASR 在构建大型离线模型前明确显示“加载模型 / 模型就绪”。
- 新增 `Logs\batch.log`，记录后台任务 START / DONE / FAIL 以及 VAD fallback 诊断。
- FFmpeg 支持手动指定已有 `ffmpeg.exe`，设置页验证同目录必须同时存在 `ffprobe.exe`。
- FFmpeg 自动发现顺序：手动指定 -> LocalSub 自有组件 -> `MEDIOVA_RUNTIME_DIR` -> 附近 Mediova `Components\FFmpeg\bin` -> 系统 PATH。
- 只有前述路径全部不可用时，后台页下载才作为兜底。
- 修复 FFmpeg 下载 416：完整 `.part` 可直接校验复用，异常断点会清理重试。
- FFmpeg ZIP 下载完成后做实际 ZIP/ffmpeg/ffprobe 校验。
- 针对实机 `0 段`：Silero VAD 阈值由 0.45 下调到 0.32，并缩短最短语音限制。
- 如果 Silero VAD 整段扫描后仍为 0 段，自动根据整段音频 RMS 分布计算自适应阈值，第二遍进行音量分段，并将片段送入离线模型。
- 如果音量分段产生候选但模型仍全为空，继续使用宽松 8 秒音频块做最后兜底，避免“4:59 视频 0.01 RTF 瞬间完成 0 段”。
- fallback 阶段会显示 `VAD fallback / fallback 识别 / 宽松 fallback`，并在 `batch.log` 中记录 `VAD_ZERO / ENERGY_EMPTY / BROAD_EMPTY`，后续可以精确区分“没切到语音”和“模型返回空文本”。

## 性能、启动与后台运行

- 资源模式：节能 / 自动 / 最大性能，默认自动。
- 真流式 ASR 和后台 ASR 已接统一线程策略。
- 设置页可配置资源模式、FFmpeg 路径、最小化到托盘、开机自动启动。
- 开机启动使用当前用户 HKCU Run，不需要管理员权限。
- 托盘默认关闭；启用后最小化/关闭窗口可驻留托盘，支持恢复和真正退出。
- 冷启动写入 `Logs\startup.log`，记录 runtime-init、main-form-constructed、lightweight-enhancers-attached、window-shown。

## CI 门禁

1. `dotnet publish`。
2. 最终包不得含模型、ONNX Runtime、sherpa native runtime。
3. `LocalSub.exe` 真启动并存活。
4. 真切换到后台转写 Tab，验证延迟工作区构建不崩溃。
5. Windows Process Loopback 真执行 Activate/Initialize/GetService/Start/Stop。
6. sherpa 1.13.4 win-x64 native DLL 实际下载并加载。
7. FFmpeg 必须保持外置可选组件，不得混入基础包。
8. CI push 路径已收窄到 `src/LocalSub/**` 与工作流本身，纯 HANDOFF/README 更新不再白跑 Windows 构建。

## 本阶段明确不做

- 翻译。
- 多语言专项优化。
- 说话人分离。
- 会议总结。
- 云端 LLM。
- 重型字幕编辑器。
- Mediova 源码合并。

## 下一实机验收断点

优先实时：

1. 覆盖 `a7b951080...` 对应 EXE，仍使用 Zipformer Large + PotPlayer。
2. 连续做多次小幅快进/快退和大幅跳转，确认字幕能自然恢复，不再一次 `0x8000FFFF` 后长期失效。
3. 快进/换片时允许短暂显示“等待音频恢复 / 自动重试”，但无需重新点击“开始”，也不应重新加载 Zipformer 模型。
4. 如果出现真正的音频重建，恢复后新字幕不应继续拼接跳转前的旧半句话。
5. 再做连续换 2-3 个视频，确认同一 PID 下不因为标题变化无条件重建音频。

后台继续：

1. 对同一 4:59 MP4 + Fun-ASR-Nano 再次点击“转写选中”。
2. 正常情况下不应再出现 RTF 0.01 直接完成 0 段；至少会进入 VAD fallback/音量分段并真正调用 Fun-ASR-Nano 解码。
3. 如果仍无文本，直接读取 `Logs\batch.log`，重点看 `VAD_ZERO / ENERGY_EMPTY / BROAD_EMPTY` 以及 DONE/FAIL。
4. 同时验证设置页字幕高级样式：自动字号倍率、当前颜色、上一条大小/颜色/透明度/字重、描边、阴影。
5. 当前 MP4 已可用 Media Foundation，因此测试后台 ASR 不依赖 FFmpeg；FFmpeg 只测试复用 Mediova 和 MKV/WebM fallback。

其他统一验收继续包括不同实时/后台模型效果、MKV/WebM fallback、TXT/JSON、托盘和启动速度。
