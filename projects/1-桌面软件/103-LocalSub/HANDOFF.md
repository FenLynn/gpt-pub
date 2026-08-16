# LocalSub HANDOFF

## 项目定位

Windows 本地实时字幕与后台视频转写工具。优先服务 PotPlayer，同时支持捕获所有 Windows 输出音频。核心 ASR 本地运行，不依赖云端 LLM/API。

## 当前用户决策

- Mediova 与 LocalSub 暂不合并。未来若需要统一入口，只考虑轻量总控/启动器，不进行源码硬合并。
- 当前核心语言限定中文、英文。多语言专项优化与翻译延后。
- 当前阶段采用“连续开发到完整候选，再统一实机验收”的方式，不再每个小改动单独交付。

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
- 完整候选功能 head：`0a361e405089e6c6a7eaed9223fc4b62710963d8`
- Windows CI run：`31920130744`，结论 `success`。
- 该 run 已通过：publish、绿色包检查、EXE 真启动、后台工作区真切换 smoke、Windows Process Loopback 真激活、sherpa native DLL 真加载、最终打包。
- CI 不携带用户大模型，因此模型实际准确率、长视频转写速度和真实 PotPlayer 连播仍属于统一实机验收项。

## 已实机确认基线

- `所有音频 + Streaming Paraformer 中英 INT8` 可以真实出字幕，主音频/ASR/HTML 输出链已跑通。
- Paraformer 准确率一般，定位为低延迟档。
- `Streaming Zipformer Large 中文 INT8` 用户反馈更好且可用，当前中文实时推荐基线。
- PotPlayer 普通窗口和全屏字幕 overlay 已实机可见，全屏链非回归不再重构。

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

## 后台转写已实现

完整链路：

`媒体 -> Media Foundation / FFmpeg fallback -> 16 kHz mono -> Silero VAD -> Offline ASR -> 时间戳 transcript -> 关键词 -> TXT / JSON`

能力：

- 视频/音频拖放和文件队列。
- 添加、移除、清空、转写选中、全部转写、取消。
- 优先使用 Windows Media Foundation 读取音轨。
- Media Foundation 不支持时，可单独下载 FFmpeg Essentials 到 `Components\FFmpeg\bin`，仍复用代理/SOCKS5，不进入基础包。
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
- 后台工作区延迟加载，首次进入后台 Tab 才构建重 UI，避免拖慢普通启动。
- 延迟加载会替换并销毁早期 prototype Tab，避免旧拖放/分析事件重复运行。

## 性能、启动与后台运行

- 资源模式：节能 / 自动 / 最大性能，默认自动。
- 真流式 ASR 和后台 ASR 已接统一线程策略。
- 设置页可配置资源模式、最小化到托盘、开机自动启动。
- 开机启动使用当前用户 HKCU Run，不需要管理员权限。
- 托盘默认关闭；启用后最小化/关闭窗口可驻留托盘，支持恢复和真正退出。
- 冷启动写入 `Logs\startup.log`，记录 runtime-init、main-form-constructed、lightweight-enhancers-attached、window-shown，便于实机定位启动慢。

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

## 统一实机验收清单

实时：

1. 所有音频 + Zipformer Large 基线。
2. PotPlayer 连续切 2-3 个视频，确认自动续接。
3. 普通窗口、最大化、全屏、最小化/恢复。
4. Zipformer CTC Large / XLarge、SenseVoice、Fun-ASR-Nano 同片段对比速度与准确率。
5. 字幕自动/固定字号、位置、底纹、显示时长。
6. 节能/自动/最大性能模式下 CPU、延迟与稳定性。

后台：

1. MP4/MOV 等文件自动生成声音轨道。
2. MKV/WebM/特殊编码安装 FFmpeg 后 fallback。
3. SenseVoice、Offline Zipformer CTC、Fun-ASR-Nano 分别转写同一片段。
4. 时间戳、VAD 语音区间、关键词高亮和波形 marker 对齐。
5. 多文件全部转写、单文件失败和取消。
6. TXT 导出、`Data\Transcripts` JSON 自动记录。
7. 检查 RTF，重点看 Offline Zipformer CTC 是否可稳定低于 1。

系统：

1. 双击 EXE 冷启动体感并检查 `Logs\startup.log`。
2. 托盘、真正退出、开机启动。
3. 模型页黑/浅灰与实时/后台下拉框保持事实一致。
4. 基础包保持轻量，模型、FFmpeg、ASR runtime 均外置复用。

## 下一准确断点

当前既定核心范围已经进入统一候选状态。下一步不是继续无边界增加功能，而是用户回来后按上述清单集中实机验收；发现问题时按“实时 / 后台 / 系统”三类逐项修复。