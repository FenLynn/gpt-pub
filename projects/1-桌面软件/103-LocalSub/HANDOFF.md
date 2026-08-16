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
- 实时模型下拉框只允许出现已经安装且关键文件校验通过的模型。模型页以黑色表示已安装可用，灰色表示未安装，不允许 UI 状态与真实磁盘状态脱节。

## 当前开发分支与版本

- 分支：`p103-localsub-exp`
- 版本：`v0.1.0-dev`
- 当前功能 head：`f45ac2c6625f050aff6c3e177dd64dfe3703b8fc`

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
- 模型页现在以真实 `IsInstalled()` 校验结果驱动 UI：黑色为已安装且关键文件完整，灰色为未安装；下载完成自动变黑，删除后立即变灰。
- 实时模型下拉框只列 `LiveCapable + IsInstalled()` 模型。下载完成后自动进入下拉框，删除后立即移出；没有任何已安装实时模型时“开始”按钮禁用并给出明确提示。

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

### PotPlayer Process Loopback 与自动续接

- 当前底层链：`ActivateAudioInterfaceAsync -> IAudioClient -> IAudioCaptureClient -> event-driven capture -> mono/16 kHz`。
- Windows 10 build 19045 允许实际尝试，不再被错误版本门槛阻断。
- CI 已真实执行 Process Loopback 激活、Initialize、GetService、Start、Stop。
- 新增 `ResilientPotPlayerCaptureService` supervisor。实时识别不再只在点击“开始”时绑定一次音频会话。
- supervisor 约每 300 ms 检查 PotPlayer 进程与窗口标题；检测到播放文件/标题变化时重建 Process Loopback，会继续复用已经加载的 ASR recognizer，不重新加载大模型。
- 如果 PotPlayer 进程发生变化，会自动重新寻找并绑定新的 PotPlayer PID。
- 如果一个已经产生过 PCM 的捕获会话连续约 7 秒没有新样本，会把它视为可能的静默失活并自动重建一次捕获会话；重建后在真正再次收到 PCM 前不会因普通暂停而反复重连。
- supervisor 的 Process 对象和捕获对象均显式释放，避免长时间看片时产生句柄积累。
- PotPlayer 模式仍不允许静默回退到“所有音频”。

### 实时启动速度优化

- 旧流程为：检查 runtime -> 同步加载模型 -> 再连接 PotPlayer 音频，两个主要耗时步骤串行叠加。
- 当前流程在 runtime 已就绪后，把 sherpa 模型构造放到后台线程，并与 PotPlayer Process Loopback 激活并行执行。
- 音频队列先建立为有界队列，模型加载期间只保留较新的 PCM，避免无限积压。
- 因此点击“开始”到真正可识别的等待时间接近“模型加载”和“音频连接”两者中较慢的一项，而不是两项之和，同时 UI 线程不被大模型构造阻塞。
- 如果用户所说的“启动慢”特指双击 EXE 到主窗口出现，而不是点击“开始”到字幕工作，则需要下一轮单独加入 cold-start 分段计时；当前这一轮优化的是实时识别启动路径。

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
- 第二阶段第一轮媒体解析代码出现 C# TimeSpan 格式字符串转义编译错误，run 81 被 CI 拦截；已修复。
- 模型 UI 一度存在“模型页未安装，但实时下拉框仍可选”的事实不一致；现已改为由 `ModelManager.IsInstalled()` 单一事实源驱动。
- 本轮模型 UI 修改第一次提交出现重复 `SelectionMode` 初始化，被 run 87 编译门禁拦截；已删除重复项，run 88 全绿。

## 最新构建验证

- 功能 head：`f45ac2c6625f050aff6c3e177dd64dfe3703b8fc`。
- Windows CI run：`31916278674`，结论 success。
- `Publish net8 single-file app`：success。
- `Prepare portable layout`：success。
- `Smoke test LocalSub startup`：success。
- `Smoke test Windows process loopback`：success。
- `Verify sherpa win-x64 runtime package`：success。
- `Package portable ZIP`：success。
- 最终发布包仍无模型、无 ONNX Runtime、无 sherpa native runtime。

## 用户下一步实机验证

1. 本轮相对上一用户包只需覆盖新的 `LocalSub.exe`，现有 `Assets`、ASR 模型、`ASR\_runtime` 和 config 不动。
2. 启动后检查实时模型下拉框，应只出现已经下载且模型关键文件完整的实时模型；模型页已安装项应为黑色，未安装项灰色。
3. 在 PotPlayer 连续播放列表中开始一次实时字幕，然后直接“下一集/下一视频”，不要手动停止或重新开始。状态区应出现“检测到 PotPlayer 视频切换/自动续接”等信息，短暂重连后输入电平和字幕应恢复。
4. 感受点击“开始”后的等待时间是否比上一版缩短。如果用户实际指的是双击 EXE 本身启动慢，需要记录这一点，下一轮做 cold-start instrumentation。
5. 后台页继续验证普通 MP4 的媒体信息、解析进度和声音波形。通过后下一轮接 Silero VAD + Offline Zipformer CTC + 关键词 marker + TXT 实际转写。

## 下一准确断点

先以实机确认 PotPlayer 换片自动续接和启动体感。若自动续接仍失败，直接根据状态区判断是标题变化未检测、PID 变化、还是重建后的 Process Loopback 无 PCM；不重新加载模型。实时链稳定后继续收口后台闭环：`视频 -> 音轨/波形 -> VAD 语音段 -> Offline ASR -> 时间戳 transcript -> 关键词 marker -> TXT`。翻译、多语言增强、说话人分离继续暂缓。