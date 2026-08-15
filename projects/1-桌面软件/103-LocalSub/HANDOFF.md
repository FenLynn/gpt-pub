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

## 当前开发分支与版本

- 分支：`p103-localsub-exp`
- 版本：`v0.1.0-dev`

## 当前已实现

### 绿色运行与模型管理

- WinForms / .NET 8 Windows 工程。
- 配置、Data、ASR 按 EXE 相对路径管理。
- 模型 catalog：SenseVoice Small INT8、Streaming Paraformer 中英 INT8、Streaming Paraformer 中英粤 INT8、Fun-ASR-Nano INT8、Silero VAD。
- ModelManager 支持扫描、下载、关键文件检查、删除、断点续传、三次重试、状态/速度/日志/取消。
- `.tar.bz2` 使用 SharpCompress `ReaderFactory`，损坏缓存自动清理。
- Streaming Paraformer 只下载 `encoder.int8.onnx`、`decoder.int8.onnx`、`tokens.txt` 三个必要文件，不下载 FP32 整包。
- sherpa win-x64 native runtime 固定 1.13.4，首次需要时下载到 `<ASR>\_runtime`，程序包不重复携带。

### 实时识别

- 用户已实机确认 `所有音频 + Streaming Paraformer 中英 INT8` 可以真实出字幕，因此模型、sherpa runtime、Windows 全局 loopback、16 kHz 数据链和 HTML 输出主链已经真实跑通。
- Streaming Paraformer 为真流式，输出 partial/final。
- SenseVoice Small INT8 在实时下拉框中作为模拟流式模型。
- SenseVoice 选择后如缺 Silero VAD，会自动通过现有代理/下载通道补齐约 2 MB VAD。
- 用户首次实机测试 SenseVoice 时反馈“看起来在工作但不显示字幕”。复核 sherpa-onnx v1.13.4 官方模拟流式示例后确认，Silero VAD 应按固定 512 samples 窗口喂入，并在语音持续时周期性做 interim decode。旧实现直接把任意长度捕获块交给 VAD，且只等待完成语音段后才解码。
- 当前 SenseVoice 已改为官方同型流程：16 kHz 音频缓冲 -> 512-sample VAD 窗口 -> `IsSpeechDetected` -> 讲话期间约每 450 ms interim decode -> 停顿后按 VAD 完整 segment final decode。
- SenseVoice 已增加 partial result 与状态回调，实时页可看到“检测到语音/正在识别/完成一句”等状态。
- SenseVoice 配置与官方当前示例对齐，`language=auto`，ITN 暂关闭。
- SenseVoice 使用现有 `model.int8.onnx + tokens.txt`，不需要重新下载已安装模型。
- 为使用 sherpa managed API，项目引用 `org.k2fsa.sherpa.onnx 1.13.4`；NuGet 传递带入的 native runtime 在 publish 阶段剥离，运行时仍复用 `ASR\_runtime`。

### PotPlayer Process Loopback

- 旧版曾把 `System.__ComObject` 强转为 NAudio 2 的 `IAudioClient`，用户实机触发 `0x80004002 E_NOINTERFACE`，该路径已废弃。
- PotPlayer 捕获已改为 raw COM：`ActivateAudioInterfaceAsync -> IAudioClient -> IAudioCaptureClient -> event-driven capture`，再转 mono / 16 kHz。
- CI 已真实执行 Process Loopback 激活、Initialize、GetService、Start、Stop。
- 用户系统为 Windows 10 build 19045。旧版错误地按 20348 门槛提前阻断，现改为 19041+ 实际尝试；真实失败才返回 build + HRESULT，不静默回退“所有音频”。

### 字幕显示与跟随

- overlay 为非激活、鼠标穿透窗口。
- 60 ms 跟随 PotPlayer 最大可见顶层窗口，覆盖移动、缩放、最大化、全屏；最小化时隐藏。
- 字幕历史只保留当前句 + 上一句，最多两个条目。
- 最后一次识别更新后 3 秒自动清空，空 current/previous 在 HTML 中 `display:none`，不会留下空黑框。
- 用户实机反馈窗口模式有字幕，但 PotPlayer 全屏后外部字幕不可见。旧实现只依赖 WinForms `TopMost=true`，播放器进入全屏后可能重新排到同一 topmost band 上方。
- 当前 overlay 在每次 60 ms 跟随时都使用 `SetWindowPos(HWND_TOPMOST, ..., SWP_NOACTIVATE)` 重新压到 topmost band 顶部；每次新字幕写入后也重新断言 topmost，不抢 PotPlayer 焦点。
- 如果用户 PotPlayer 开启真正的独占全屏渲染，外部 overlay 仍可能被图形独占模式阻断；当前先验证普通 PotPlayer 全屏/无边框全屏场景。

### 后台方向

- 已有文件拖放队列、关键词数据结构和 TXT exporter 骨架。
- FFmpeg/媒体解码、波形、VAD、离线 ASR、关键词时间轴尚未进入可用闭环。

## 关键故障记录

- 模型页复杂 SplitContainer 曾导致启动秒退，已改安全 TableLayoutPanel，并固化 EXE startup smoke test。
- `.tar.bz2` 曾下载成功但 ArchiveFactory 解压失败，已改 ReaderFactory。
- 旧 Process Loopback NAudio 2 RCW 强转触发 `E_NOINTERFACE`，已改 raw COM。
- Windows 19045 曾因错误的 20348 门槛被阻断，已改 19041+ 实际尝试。
- sherpa managed wrapper 曾把 `onnxruntime.dll` 传递带回 publish，CI 已拦截并在 publish 阶段剥离。
- SenseVoice 首轮模拟流式未按 512-sample VAD 官方流程，用户实机无字幕；已按 sherpa v1.13.4 示例重构并加入 interim decode。
- PotPlayer 全屏后 overlay 不可见；已增加持续 `SetWindowPos(HWND_TOPMOST)` Z-order 维护。

## 最新构建验证

- 最新交付代码 head：`70562731c4d4f58a3425fdff5862ed053e0aa41c`。
- Windows CI run：`31893450514`，结论 success。
- `dotnet publish`：success。
- `Prepare portable layout`：success，native ASR runtime 仍被剥离。
- `Smoke test LocalSub startup`：success。
- `Smoke test Windows process loopback`：success。
- `Verify sherpa win-x64 runtime package`：success。
- `Package portable ZIP`：success，发布包仍无模型、无 ONNX Runtime、无 sherpa native runtime。

## 用户下一步实机验证

1. 覆盖最新只含 `LocalSub.exe` 的增量包，不删除现有 `ASR`、SenseVoice、Paraformer、Silero VAD 或 `ASR\_runtime`。
2. `所有音频 + SenseVoice Small INT8`：讲话时状态应出现“检测到语音”，随后应出现中间字幕，停顿后形成 final。
3. `所有音频 + Streaming Paraformer`：继续作为已知正常基线。
4. 播放过程中让 PotPlayer 进入全屏，确认字幕仍保持在播放器底部并在 3 秒无新结果后消失。
5. `PotPlayer + Streaming Paraformer`：继续验证 Windows 19045 的专用 Process Loopback 实际有声捕获。
6. 如 SenseVoice 仍无文本，截图实时页状态；如全屏仍无字幕，确认 PotPlayer 是否启用了独占全屏/独占 Direct3D 模式，并记录窗口模式与全屏模式的差异。

## 当前真实未完成项

- SenseVoice 新 512-sample + interim decode 路径的用户实机验证。
- PotPlayer 全屏 topmost 修复的用户实机验证。
- Windows 19045 上 PotPlayer Process Loopback 有声实机验证。
- 实时字幕字号、偏移、显示时长等可配置项尚未收口，目前显示时长固定 3 秒。
- 后台 FFmpeg/媒体解码、波形、VAD、离线 ASR 流水线尚未接入。

## 下一准确断点

先收口实时链路。SenseVoice 若仍失败，优先读取实时状态并检查 VAD 是否真正进入 detected、interim decode 是否返回空字符串；全屏若仍失败，先区分普通无边框全屏与独占全屏，普通全屏继续修 HWND/Z-order，独占全屏则评估 PotPlayer 内部字幕桥接而不是继续叠外部窗口。实时识别和全屏 overlay 稳定后，再进入后台文件转写。
