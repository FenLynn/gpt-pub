# LocalSub HANDOFF

## 项目定位

Windows 本地实时字幕与后台视频转写工具。优先服务 PotPlayer，同时支持捕获所有 Windows 输出音频。基础 ASR 本地运行，不依赖云端 LLM/API。

## 当前用户决策

- Mediova 与 LocalSub 暂不合并。后期如果需要统一入口，只考虑轻量总控/启动器，通过链接或进程启动各独立软件，不进行跨技术栈硬合并。
- 当前进入连续开发收口阶段。用户暂时不逐版本实机验证，开发可以持续推进到既定范围的完整候选，再统一验收。
- 当前核心语言限定中文、英文。多语言优化与翻译以后再考虑，本阶段不做。

## 已确认硬约束

- 绿色 ZIP，解压即用，不需要安装器。
- 日常测试默认交付增量覆盖 ZIP，只包含相对用户上一版实际变化的运行文件，ZIP 内路径直接以 LocalSub 根目录为基准。
- 只有首次安装、依赖/目录结构变化、无法安全增量覆盖或用户明确要求时才交付完整绿色包。
- 基础程序采用 `.NET 8`、`SelfContained=false`、`PublishSingleFile=true`，不要求 `.NET 10`。
- 模型绝不随程序包分发。默认模型根目录为 EXE 同级 `ASR`，设置可改。
- 模型独立下载、独立删除、后续独立升级。
- 下载支持系统代理、直连、SOCKS5。
- 实时音源只保留 `PotPlayer` 与 `所有音频`，PotPlayer 模式不得静默回退到全系统音频。
- 字幕使用 WebView2 + HTML/CSS。
- 自有可下载组件尽量位于 EXE 目录树，不主动散落到 Program Files / AppData。
- CI 必须验证编译、EXE 真启动、Windows Process Loopback 真激活、sherpa native DLL 加载。后台工作区增加独立 UI smoke gate。
- 实时模型下拉框只出现已安装且关键文件校验通过的模型。模型页黑色表示已安装可用，浅灰表示未安装。

## 当前开发分支与版本

- 分支：`p103-localsub-exp`
- 版本：`v0.1.0-dev`
- 当前工作仍留在开发分支，不合并 main，不创建额外临时分支。

## 已实机确认基线

- `所有音频 + Streaming Paraformer 中英 INT8` 可以真实出字幕，因此模型、sherpa runtime、全局 loopback、16 kHz 音频链和 HTML 输出主链已真实跑通。
- Streaming Paraformer 准确率一般，定位为低延迟档。
- `Streaming Zipformer Large 中文 INT8` 用户反馈“好一点，还是可以的”，当前中文实时推荐基线。
- PotPlayer 普通窗口与全屏字幕覆盖已实机可见，全屏 overlay 非回归不再重构。
- SenseVoice 模拟流式仍未完成用户最终验证。
- Fun-ASR-Nano 已加入实时模拟流式候选，但用户尚未验证最终效果。

## 当前已实现

### 绿色运行、下载与模型管理

- WinForms / .NET 8 Windows 单文件程序。
- 配置、Logs、Data、ASR、Components 均按 EXE 相对目录管理。
- ModelManager 支持扫描、关键文件校验、下载、断点续传、三次重试、缓存、删除、状态/速度/日志/取消。
- `.tar.bz2` 使用 SharpCompress `ReaderFactory`，损坏缓存自动清理。
- sherpa win-x64 native runtime 固定 1.13.4，首次需要时下载到 `<ASR>\_runtime`，程序补丁不重复携带。
- publish 阶段剥离 NuGet 传递带入的 ONNX Runtime / sherpa native DLL。
- Streaming Paraformer 仅下载 INT8 必要文件，不下载 FP32 大包。
- 模型页有语言、体积、实时性、准确率、性价比、安装状态。
- 已安装且校验通过显示黑色，未安装显示浅灰色；实时下拉仅显示已安装实时模型。

### 当前模型目录

- Zipformer CTC Small 中文 INT8：约 26 MB。
- Zipformer CTC Large 中文 INT8：约 155 MB。
- Zipformer Large 中文 INT8：约 160 MB。
- Streaming Paraformer 中英 INT8：约 237 MB。
- Streaming Paraformer 中英粤 INT8：约 238 MB。
- SenseVoice Small INT8：约 230 MB。
- Offline Zipformer CTC 中文 INT8：约 350 MB。
- Zipformer CTC XLarge 中文 INT8：约 728 MB。
- Zipformer XLarge 中文 INT8：约 736 MB。
- Fun-ASR-Nano INT8：约 0.9 GB。
- Silero VAD：约 2 MB。

### 实时字幕

- `所有音频`：WASAPI endpoint loopback -> mono -> 16 kHz -> ASR -> HTML 字幕。
- `PotPlayer`：Windows process loopback 按 PID 捕获，不回退全局音频。
- `ResilientPotPlayerCaptureService` supervisor 自动处理 PotPlayer 换片、PID 变化和捕获会话静默失活。
- 模型加载与 PotPlayer 捕获并行启动，降低点击开始后的等待。
- Streaming recognizer 支持 Paraformer、Zipformer Transducer、Zipformer CTC。
- SenseVoice 使用 Silero VAD + RMS fallback 做模拟流式。
- Fun-ASR-Nano 使用 Silero VAD 分段，停顿后做高质量整句解码，属于模拟流式。
- 字幕最多当前句 + 上一句，默认 3 秒无新结果自动隐藏。
- 默认 28 px 基准、无整块底纹、白字黑描边/轻阴影。
- 可调自动/固定字号、底部偏移、最大宽度、底纹与透明度、显示时长。
- overlay 为非激活、鼠标穿透、持续 TopMost，跟随 PotPlayer 普通窗口/最大化/全屏。

### 后台转写完整链路，当前开发候选

已从早期“拖文件 + 波形占位”推进为实际工作区：

`媒体文件 -> Media Foundation / FFmpeg fallback -> 16 kHz mono -> Silero VAD -> Offline ASR -> 时间戳 transcript -> 关键词 -> TXT / JSON`

当前代码已包含：

- `BatchTranscriptionService`：流式读取媒体，不把整部视频载入内存；VAD 分段后进行离线 ASR。
- 后台模型支持 SenseVoice、Offline Zipformer CTC、Fun-ASR-Nano。
- `MediaAudioSource`：优先 Windows Media Foundation，不支持时使用外置 FFmpeg。
- `FfmpegManager`：FFmpeg 作为独立可选组件下载到 `Components\FFmpeg\bin`，复用系统/直连/SOCKS5 下载设置，不进入基础程序包。
- `MediaAnalysisService`：同一解码抽象生成 RMS + peak 声音波形。
- `EnhancedWaveformView`：显示完整声音轨道，叠加识别语音区间和关键词竖向标记。
- `BatchWorkspaceEnhancer`：媒体队列、添加/移除/清空、拖放、已安装后台模型选择、转写选中、全部转写、取消、TXT 导出、FFmpeg 安装/打开、进度、RTF、富文本结果。
- 识别结果带开始/结束时间戳；关键词在正文中高亮并同步到波形标记。
- 每个完成文件自动保存结构化 JSON 到 `Data\Transcripts\<name>.localsub.json`，TXT 可人工导出。
- 多文件按队列顺序连续转写，单个失败不阻断后续文件，取消时保留已完成结果。
- 后台工作区采取延迟加载，首次进入“后台转写”才构建重 UI，避免拖慢普通启动。
- 延迟加载时整个替换早期 prototype Tab，避免旧拖放/分析事件在后台重复执行。

### 性能与后台运行

- `ResourceProfile` 已加入：节能 / 自动 / 最大性能，默认自动。
- 真流式识别和后台 ASR 已接中央线程策略；节能限制线程，最大性能提高线程上限。
- 设置页增加性能与后台区，可配置资源模式、最小化到托盘、开机自动启动。
- 开机启动只使用当前用户 HKCU Run，不需要管理员权限。
- 托盘模式默认关闭，启用后最小化/关闭窗口可驻留托盘，托盘菜单支持恢复与真正退出。
- 双击 EXE 冷启动增加 `Logs\startup.log` 分段计时：runtime-init、main-form-constructed、lightweight-enhancers-attached、window-shown，用于后续实机定位启动慢。

## CI 门禁

基础门禁：

1. `dotnet publish`。
2. 剥离并检查基础包不得包含模型、ONNX Runtime、sherpa native runtime。
3. `LocalSub.exe` 真启动并存活。
4. Windows Process Loopback 真激活、Initialize、GetService、Start、Stop。
5. 下载并实际加载 sherpa 1.13.4 win-x64 `sherpa-onnx-c-api.dll`。
6. 最终 ZIP 再检查模型、runtime、FFmpeg 均未混入。

新增门禁：后台工作区独立 smoke test，在 Windows runner 中真实切入“后台转写”Tab，触发延迟构建；若 UI 初始化抛异常或写 crash log，则构建失败。

## 当前明确不做

- 翻译。
- 多语言专项优化。
- 说话人分离。
- 会议总结。
- 云端 LLM。
- 重型字幕编辑器。
- Mediova 代码合并。

## 后续统一实机验收清单

实时：

1. 所有音频 + Zipformer Large 基线。
2. PotPlayer 连续切换多个视频后是否持续自动监听。
3. 普通窗口、最大化、全屏、最小化/恢复。
4. Zipformer CTC Large / XLarge、Fun-ASR-Nano、SenseVoice 的速度与准确率对比。
5. 字幕位置、自动字号、固定字号、底纹、持续时间。
6. 节能/自动/最大性能模式下 CPU、延迟与稳定性。

后台：

1. MP4/MOV 等 Media Foundation 可解码文件生成声音轨道。
2. MKV/WebM/特殊编码在安装 FFmpeg 后自动 fallback。
3. SenseVoice、Offline Zipformer CTC、Fun-ASR-Nano 分别转写同一片段。
4. 时间戳、语音段、关键词高亮和波形 marker 是否对齐。
5. 多文件“全部转写”、单文件失败、取消。
6. TXT 导出与 `Data\Transcripts` JSON 自动记录。
7. RTF 是否低于 1，尤其是 Offline Zipformer CTC。

系统：

1. 双击 EXE 冷启动体感，并读取 `Logs\startup.log` 精确定位慢点。
2. 托盘、真正退出、开机启动。
3. 模型页黑/浅灰状态与实时/后台下拉框事实一致。
4. 程序包保持轻量，模型、FFmpeg、ASR runtime 全部外置复用。

## 下一准确断点

等待最新开发 head 的 Windows CI 完整通过并修掉所有编译/启动门禁问题。CI 全绿后制作一次统一增量候选包，不再拆小补丁。之后用户回来时按本文件的统一验收清单集中实机验证。