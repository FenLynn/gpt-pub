# LocalSub HANDOFF

## 项目定位

Windows 本地实时字幕与后台视频转写工具。优先服务 PotPlayer，同时支持捕获所有 Windows 输出音频。基础 ASR 本地运行，不依赖云端 LLM/API。

## 已确认硬约束

- 绿色 ZIP，解压即用，不需要安装器。
- 日常测试默认交付增量覆盖 ZIP，只包含相对用户上一版实际变化的运行文件，ZIP 内路径直接以 LocalSub 根目录为基准。
- 只有首次安装、依赖/目录结构变化、无法安全增量覆盖或用户明确要求时才交付完整绿色包。
- 基础程序与 AtlasDesk / DavBridge 对齐：`.NET 8`、`SelfContained=false`、`PublishSingleFile=true`。
- 不要求 `.NET 10 Desktop Runtime`，复用系统已有 `.NET 8 Desktop Runtime`。
- 模型绝不随程序包分发。默认模型根目录为 EXE 同级 `ASR`，设置可改。
- 模型独立下载、独立删除、后续独立升级。
- 下载支持系统代理、直连、SOCKS5，SOCKS5 可探测本机常见端口。
- 实时音源只保留 `PotPlayer` 与 `所有音频`，PotPlayer 模式不得静默回退到全系统音频。
- 字幕使用 WebView2 + HTML/CSS。
- 自有可下载组件尽量位于 EXE 目录树，不主动散落到 Program Files / AppData。
- CI 不只验证编译，必须做 EXE 启动、Windows Process Loopback 真激活和 sherpa native DLL 加载门禁。
- 当前核心语言限定为中文、英文；多语言优化与翻译延后。

## 当前开发分支与版本

- 分支：`p103-localsub-exp`
- 版本：`v0.1.0-dev`
- 当前功能 head：`e4cb8026de5050ea865a08dc0298003a4f35c8a2`

## 当前已实机确认

- `所有音频 + Streaming Paraformer 中英 INT8` 可以真实出字幕，因此模型、sherpa runtime、全局 loopback、16 kHz 音频链和 HTML 输出主链已经真实跑通。
- Streaming Paraformer 整体识别效果一般，定位为低延迟/极速实时档。
- `Streaming Zipformer Large 中文 INT8` 用户实机反馈“好一点，还是可以的”，当前作为中文实时推荐候选。
- PotPlayer 普通窗口和全屏外部字幕覆盖已经实机确认可见。全屏 overlay 链冻结，非回归不再修改。
- SenseVoice Small INT8 仍未通过用户实机验证，继续作为模拟流式/后台候选。

## 当前已实现

### 绿色运行与模型管理

- WinForms / .NET 8 Windows 工程。
- 配置、Data、ASR 按 EXE 相对路径管理。
- ModelManager 支持扫描、下载、关键文件检查、删除、断点续传、三次重试、状态/速度/日志/取消。
- `.tar.bz2` 使用 SharpCompress `ReaderFactory`，损坏缓存自动清理。
- sherpa win-x64 native runtime 固定 1.13.4，首次需要时下载到 `<ASR>\_runtime`，程序包不重复携带。
- NuGet 传递带入的 ONNX Runtime / sherpa native DLL 在 publish 阶段剥离，继续复用 `ASR\_runtime`。

### 实时模型与模型评分表

模型页已经加入语言、体积、实时性、准确率、综合性价比列。评分为 LocalSub 面向本地 CPU 字幕场景的 10 分制相对工程评分，不是官方 benchmark，后续按用户实机 A/B 修正。

当前 catalog：

- Zipformer CTC Small 中文 INT8：约 26 MB，实时 10，准确 6，性价比 10。
- Zipformer CTC Large 中文 INT8：约 155 MB，实时 9，准确 8，性价比 9。
- Zipformer Large 中文 INT8：约 160 MB，实时 8，准确 8，性价比 9，用户已实机验证可用。
- Streaming Paraformer 中英 INT8：约 237 MB，实时 9，准确 6，性价比 8，用户已实机验证但准确率一般。
- Streaming Paraformer 中英粤 INT8：约 238 MB，实时 8，准确 6，性价比 7。
- SenseVoice Small INT8：约 230 MB，实时 6，准确 8，性价比 8，模拟流式仍需收口。
- Offline Zipformer CTC 中文 INT8：约 350 MB，实时 4，准确 9，性价比 9，作为后台中文候选。
- Zipformer CTC XLarge 中文 INT8：约 728 MB，实时 6，准确 9，性价比 6。
- Zipformer XLarge 中文 INT8：约 736 MB，实时 5，准确 9，性价比 5。
- Fun-ASR-Nano INT8：约 0.9 GB，实时 3，准确 9，性价比 7，作为高质量后台候选。
- Silero VAD：约 2 MB，通用语音段检测组件，不参与 ASR 评分。

Streaming recognizer 已扩展到 Paraformer、Zipformer Transducer Large/XLarge、Zipformer CTC Small/Large/XLarge。

### SenseVoice 当前修复

- VAD 优先 + RMS 音量 fallback。
- 当前参数：能量起始 RMS 0.008、维持 RMS 0.0035、连续 4 个 512-sample 窗口触发、550 ms 低能量判停顿、最长单段 6.5 s。
- 语音进行时约每 650 ms interim decode；停顿或最长分段时 final decode。
- 状态区可区分 VAD 检测、RMS fallback、解码空文本。

### PotPlayer Process Loopback

- 当前链：`ActivateAudioInterfaceAsync -> IAudioClient -> IAudioCaptureClient -> event-driven capture -> mono/16 kHz`。
- Windows 10 build 19045 允许实际尝试，不再被错误版本门槛阻断。
- CI 已真实执行 Process Loopback 激活、Initialize、GetService、Start、Stop。

### 字幕样式与跟随

- overlay 为非激活、鼠标穿透窗口，60 ms 跟随 PotPlayer 最大可见顶层窗口。
- 每次跟随和每次新字幕写入均重新断言 `HWND_TOPMOST`，不抢 PotPlayer 焦点。
- 用户已确认全屏有字幕。
- 字幕只保留当前句 + 上一句。
- 默认视觉已由测试版的 34 px + 整块黑底改为：28 px 基准、font-weight 500、无整块底纹、白字细黑描边/轻阴影。
- 设置新增：自动字号、固定字号 20-52 px、底部偏移、最大宽度百分比、底纹无/轻/深、底纹透明度、1-10 秒显示时长。
- 自动字号随播放器高度变化，当前 clamp 22-38 px。
- 设置页新增“预览字幕”，优先贴到当前 PotPlayer，否则在主屏底部预览。

### 后台媒体解析与声音轨道

- “后台转写”已不再只是拖放占位。
- 拖入/选择媒体文件后调用 `MediaAnalysisService`，当前第一版使用 Windows Media Foundation / NAudio `MediaFoundationReader` 直接解析媒体音轨，不实际播放视频。
- 解析时显示进度、已处理时间/总时长。
- 音频按声道平均得到 mono 波形分析样本，以 RMS + peak 混合包络生成约不超过 2500 个波形点。
- 新增 `WaveformView`，在后台页显示完整声音波形及首尾时间。
- 解析完成后显示媒体时长、采样率、声道数、波形点数。
- 当前优先支持 Windows Media Foundation 可解码的 MP4/MOV/M4A/WMA 等。MKV、特殊编码等若系统无法解码，会明确提示；下一步加入 EXE 目录树内独立复用的 FFmpeg fallback。
- 当前尚未把离线 ASR、VAD 段、关键词事件真正画到该时间轴上，这是下一准确断点。

## 关键故障记录

- 模型页复杂 SplitContainer 曾导致启动秒退，已改安全 TableLayoutPanel，并固化 EXE startup smoke test。
- `.tar.bz2` 曾下载成功但 ArchiveFactory 解压失败，已改 ReaderFactory。
- 旧 Process Loopback NAudio 2 RCW 强转触发 E_NOINTERFACE，已改 raw COM。
- Windows 19045 曾因错误的 20348 门槛被阻断，已改实际尝试。
- sherpa managed wrapper 曾把 `onnxruntime.dll` 传递带回 publish，CI 已拦截并在 publish 阶段剥离。
- PotPlayer 全屏 overlay 曾不可见，已增加持续 TopMost Z-order 维护，用户已实机确认解决。
- 第二阶段第一轮媒体解析代码出现 C# TimeSpan 格式字符串转义编译错误，run 81 被 CI 拦截；已改为独立 `FormatClock()`，run 82 全绿。

## 最新构建验证

- 功能 head：`e4cb8026de5050ea865a08dc0298003a4f35c8a2`。
- Windows CI run：`31915621606`，结论 success。
- `Publish net8 single-file app`：success。
- `Prepare portable layout`：success。
- `Smoke test LocalSub startup`：success。
- `Smoke test Windows process loopback`：success。
- `Verify sherpa win-x64 runtime package`：success。
- `Package portable ZIP`：success。
- 最终发布包仍无模型、无 ONNX Runtime、无 sherpa native runtime。

## 用户下一步实机验证

1. 覆盖增量包，只替换 `LocalSub.exe`、`Assets/subtitle.html`、`Assets/model-catalog.json`。
2. 设置页测试自动/固定字号、底部偏移、最大宽度、底纹、透明度、显示时长及“预览字幕”。
3. 继续以已验证的 Zipformer Large 作为基线，重点 A/B `Zipformer CTC Large`；CTC Small 用于超轻/极速档，XLarge 用于高准确率/高资源档。
4. 后台页拖入一个普通 MP4，确认能显示媒体信息、解析进度和声音波形。
5. 如果 MP4 正常，下一轮直接在同一波形时间轴接 Silero VAD + Offline Zipformer CTC，再加入关键词 marker 与 TXT 实际转写。
6. 如果某容器 Media Foundation 不支持，记录文件格式/编码，下一轮接 FFmpeg fallback，不污染系统目录。

## 下一准确断点

优先收口后台闭环：`视频 -> 音轨/波形 -> VAD 语音段 -> Offline ASR -> 时间戳 transcript -> 关键词 marker -> TXT`。实时主链和全屏 overlay 已有可用基线，除非回归不再重构。翻译、多语言增强、说话人分离暂缓。