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
- 当前后台/FFmpeg 修复 head：`1cb9e0c2b6a721a8288af149b1f0e6bdbbcbd12d`
- Windows CI run：`31926946805`，结论 `success`。
- 该 run 已通过：publish、绿色包检查、EXE 真启动、后台工作区真切换 smoke、Windows Process Loopback 真激活、sherpa native DLL 真加载、最终打包。
- CI 不携带用户大模型，因此模型实际准确率、长视频转写速度和真实 PotPlayer 连播仍属于实机验收项。

## 已实机确认基线

- `所有音频 + Streaming Paraformer 中英 INT8` 可以真实出字幕，主音频/ASR/HTML 输出链已跑通。
- Paraformer 准确率一般，定位为低延迟档。
- `Streaming Zipformer Large 中文 INT8` 用户反馈更好且可用，当前中文实时推荐基线。
- PotPlayer 普通窗口和全屏字幕 overlay 已实机可见，全屏链非回归不再重构。
- 2026-08-16 用户首次验证后台页：MP4 可由 Media Foundation 正常解析并生成波形，但用户反馈“后台不行”；同时点击 FFmpeg 下载出现 `416 Requested Range Not Satisfiable`。该 MP4 已显示 `解码 Media Foundation`，因此 FFmpeg 失败不是该文件无法读取的根因。

## 实时字幕已实现

- 所有音频：WASAPI endpoint loopback -> mono -> 16 kHz -> ASR -> HTML 字幕。
- PotPlayer：Windows process loopback 按 PID 捕获，不回退全局音频。
- `ResilientPotPlayerCaptureService` 自动处理 PotPlayer 换片、PID 变化和捕获会话静默失活。
- 模型加载与 PotPlayer 音频连接并行，缩短点击开始后的等待。
- 真流式模型：Streaming Paraformer、Zipformer Transducer、Zipformer CTC。
- SenseVoice：Silero VAD + RMS fallback 模拟流式。
- Fun-ASR-Nano：Silero VAD 分段，停顿后整句解码，准确率优先、延迟较高。
- 字幕最多当前句 + 上一句，默认 3 秒无新结果后消失。
- 默认无整块黑底，白字细黑描边/轻阴影，基准 28 px。
- 可调自动/固定字号、底部偏移、最大宽度、底纹/透明度、显示时长。
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

`媒体 -> Media Foundation / FFmpeg fallback -> 16 kHz mono -> Silero VAD -> Offline ASR -> 时间戳 transcript -> 关键词 -> TXT / JSON`

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

- 修复队列状态显示长期停留“待处理”的 UI 问题。WinForms `ListBox` 会缓存对象的显示字符串，新版改为动态 OwnerDraw，每次重绘直接读取当前 QueueItem 状态。
- 后台 ASR 在真正构建大型离线模型前明确显示“加载模型”，Fun-ASR-Nano 等大模型不再表现为点击后长时间无反馈。
- 新增 `Logs\batch.log`，记录后台任务 START / DONE / FAIL；若实机仍失败，可直接用完整异常继续定位。
- FFmpeg 支持手动指定已有 `ffmpeg.exe`，设置页会验证同目录必须同时存在 `ffprobe.exe`。
- FFmpeg 自动发现顺序：手动指定 -> LocalSub 自有组件 -> `MEDIOVA_RUNTIME_DIR` -> 附近 Mediova `Components\FFmpeg\bin` -> 系统 PATH。
- Mediova 当前正式运行结构的 FFmpeg 路径即 `Mediova\Components\FFmpeg\bin`，因此两软件可以共用一套文件，不需要复制或重新下载。
- 只有前述路径全部不可用时，后台页的下载才作为兜底。
- 修复 FFmpeg 下载 `416 Requested Range Not Satisfiable`：如果 `.part` 已是完整 ZIP，直接校验并复用；若断点缓存异常则清理后重试，不再把 416 直接作为最终失败。
- FFmpeg ZIP 下载完成后增加实际 ZIP/ffmpeg/ffprobe 校验，避免损坏缓存被当作成功文件。

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

优先后台：

1. 覆盖 `1cb9e0c2...` 对应 EXE 后重新拖入同一 1:30 MP4。
2. 波形生成后，队列状态应变为“波形就绪”，不再一直显示“待处理”。
3. 选择 Fun-ASR-Nano 后点击“转写选中”，状态应先明确进入“加载模型”，随后进入转写进度。
4. 若仍不出文字，读取 `Logs\batch.log` 的最新 FAIL/最后阶段，不再依赖截图猜测。
5. 在“设置”中查看 FFmpeg：若自动发现 Mediova，会显示来源 Mediova；否则手动选择 Mediova `Components\FFmpeg\bin\ffmpeg.exe` 并保存。
6. 当前 MP4 已可用 Media Foundation，因此即便暂时完全不配置 FFmpeg，也应能执行后台 ASR；FFmpeg 只用于 MF 不支持的格式/编码。

其他统一验收继续包括 PotPlayer 连播自动续接、不同实时/后台模型效果、字幕样式、MKV/WebM fallback、TXT/JSON、托盘和启动速度。
