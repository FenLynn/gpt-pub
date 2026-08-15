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

## 当前已实机确认

- `所有音频 + Streaming Paraformer 中英 INT8` 可以真实出字幕，因此模型、sherpa runtime、全局 loopback、16 kHz 音频链和 HTML 输出主链已经真实跑通。
- 用户反馈 Streaming Paraformer 整体识别效果一般，准确率不足，因此后续将其定位为“低延迟/极速实时档”，不作为高准确率默认档。
- PotPlayer 普通窗口和全屏的外部字幕覆盖已经实机确认可见。此前全屏字幕被遮挡的问题已通过持续 `SetWindowPos(HWND_TOPMOST, ..., SWP_NOACTIVATE)` 修复。该链现阶段冻结，非回归不再改动。
- SenseVoice Small INT8 仍未通过用户实机验证。上一版只能看到“正在启动实时识别”，随后没有字幕，因此必须继续收口 SenseVoice 检测/解码链。

## 当前已实现

### 绿色运行与模型管理

- WinForms / .NET 8 Windows 工程。
- 配置、Data、ASR 按 EXE 相对路径管理。
- ModelManager 支持扫描、下载、关键文件检查、删除、断点续传、三次重试、状态/速度/日志/取消。
- `.tar.bz2` 使用 SharpCompress `ReaderFactory`，损坏缓存自动清理。
- sherpa win-x64 native runtime 固定 1.13.4，首次需要时下载到 `<ASR>\_runtime`，程序包不重复携带。
- NuGet 传递带入的 ONNX Runtime / sherpa native DLL 在 publish 阶段剥离，继续复用 `ASR\_runtime`。

### 实时模型层级

- `Streaming Paraformer 中英 INT8`：低延迟实时，普通话/英语，当前实机可用但准确率一般。
- `Streaming Paraformer 中英粤 INT8`：低延迟实时，普通话/粤语/英语。
- `Streaming Zipformer Large 中文 INT8`：新增中文准确率取向的真流式候选，模型 catalog 中独立下载，约 160 MB，使用 `encoder.int8.onnx + decoder.onnx + joiner.int8.onnx + tokens.txt`。
- `SenseVoice Small INT8`：中英日韩粤，作为较高准确率的 VAD/能量分段模拟流式及后台模型。
- `Fun-ASR-Nano INT8`：高质量后台模型，不进入第一阶段实时默认档。

### SenseVoice 当前修复

- 原始模拟流式方案使用 Silero VAD，16 kHz 音频按 512 samples 固定窗口送入 VAD，并周期性 interim decode。
- 用户实机仍无字幕后，当前实现增加“VAD 优先 + RMS 音量 fallback”。电影/视频系统音频中音乐和音效可能导致 VAD 不稳定，fallback 不再让 VAD 成为唯一语音起始/结束闸门。
- 当前参数：能量起始 RMS 0.008、维持 RMS 0.0035、连续 4 个 512-sample 窗口触发、550 ms 低能量判为停顿、最长单段 6.5 s。
- 语音进行时约每 650 ms 做一次 SenseVoice interim decode；停顿或达到最长分段时执行 final decode。
- 若 VAD 已产生 segment 但解码为空，会用累计 buffer 再解码一次。
- 状态区现在可区分：
  - `SenseVoice VAD 检测到语音，正在识别`
  - `SenseVoice 音量检测到语音，正在识别（VAD fallback）`
  - `SenseVoice 已执行解码但返回空文本（第 N 次），继续监听`
  - VAD/fallback 分段完成状态
- 因此下一轮用户实机若仍无字幕，只需截图实时状态即可判断是检测失败还是识别器返回空文本。

### Streaming Zipformer Large

- 新增模型 ID：`streaming-zipformer-zh-large-int8`。
- catalog 名称：`Streaming Zipformer Large 中文 INT8`。
- 使用 sherpa 在线 Transducer 路径，配置 `encoder.int8.onnx`、`decoder.onnx`、`joiner.int8.onnx`、`tokens.txt`。
- 与 Paraformer 共用现有 sherpa 1.13.4 native runtime，不增加程序包 runtime。
- 作为中文准确率取向实时候选，是否优于当前 Paraformer 以用户同片段实机 A/B 为准，不预先承诺。

### PotPlayer Process Loopback

- 旧版 NAudio 2 COM RCW 强转曾触发 `0x80004002 E_NOINTERFACE`，已改 raw COM。
- 当前链：`ActivateAudioInterfaceAsync -> IAudioClient -> IAudioCaptureClient -> event-driven capture -> mono/16 kHz`。
- Windows 10 build 19045 不再按 20348 门槛提前阻断，19041+ 实际尝试，真实失败才返回 HRESULT。
- CI 已真实执行 Process Loopback 激活、Initialize、GetService、Start、Stop。
- 用户 19045 上 PotPlayer 专用有声捕获是否完全稳定仍需继续实机确认。

### 字幕显示与跟随

- overlay 为非激活、鼠标穿透窗口。
- 60 ms 跟随 PotPlayer 最大可见顶层窗口。
- 每次跟随和每次新字幕写入均重新断言 `HWND_TOPMOST`，不抢 PotPlayer 焦点。
- 用户已确认全屏有字幕，本问题当前视为解决。
- 字幕只保留当前句 + 上一句，最多两个条目。
- 最后一次识别更新后 3 秒自动清空，空条目在 HTML 中 `display:none`，不留空黑框。

### 后台方向

- 已有文件拖放队列、关键词数据结构和 TXT exporter 骨架。
- FFmpeg/媒体解码、波形、VAD、离线 ASR、关键词时间轴尚未进入可用闭环。

## 关键故障记录

- 模型页复杂 SplitContainer 曾导致启动秒退，已改安全 TableLayoutPanel，并固化 EXE startup smoke test。
- `.tar.bz2` 曾下载成功但 ArchiveFactory 解压失败，已改 ReaderFactory。
- 旧 Process Loopback NAudio 2 RCW 强转触发 E_NOINTERFACE，已改 raw COM。
- Windows 19045 曾因错误的 20348 门槛被阻断，已改 19041+ 实际尝试。
- sherpa managed wrapper 曾把 `onnxruntime.dll` 传递带回 publish，CI 已拦截并在 publish 阶段剥离。
- SenseVoice 第一轮直接喂任意块给 VAD，无字幕；改 512-sample 官方同型流程后用户仍无字幕，现进一步加入 RMS fallback 与明确诊断状态。
- PotPlayer 全屏 overlay 曾不可见，已增加持续 TopMost Z-order 维护，用户已经实机确认全屏有字幕。

## 最新构建验证

- 最新代码验证 head：`3df59dc943577347c621e93f894bc3a23299b003`。
- Windows CI run：`31894237657`，结论 success。
- `dotnet publish`：success。
- `Prepare portable layout`：success，native ASR runtime 仍被剥离。
- `Smoke test LocalSub startup`：success。
- `Smoke test Windows process loopback`：success。
- `Verify sherpa win-x64 runtime package`：success。
- `Package portable ZIP`：success，发布包仍无模型、无 ONNX Runtime、无 sherpa native runtime。
- 最新 catalog head：`36f3ce45b007861411b506cfae2619bc53a29181`，仅新增/调整 `model-catalog.json`，无代码变化。

## 用户下一步实机验证

1. 覆盖最新增量包，只替换 `LocalSub.exe` 与 `Assets/model-catalog.json`，不删除现有 ASR、SenseVoice、Paraformer、Silero VAD 或 `ASR\_runtime`。
2. `所有音频 + SenseVoice Small INT8`：观察状态是 VAD 检测、RMS fallback，还是“解码返回空文本”。如果仍无字幕，直接截图状态行即可继续定位。
3. 在模型页下载 `Streaming Zipformer Large 中文 INT8`，使用与 Paraformer 相同的中文视频片段做 A/B，比较准确率、延迟和 CPU 占用。
4. 全屏字幕已经验证通过，不再作为本轮重点。
5. PotPlayer 专用音源若仍有异常，单独记录状态/HRESULT，不要与模型准确率问题混在一起。

## 当前真实未完成项

- SenseVoice 最新 VAD + RMS fallback 路径的用户实机验证。
- Streaming Zipformer Large 的用户实机准确率/性能验证。
- Windows 19045 上 PotPlayer Process Loopback 有声实机稳定性确认。
- 实时字幕字号、偏移、显示时长等可配置项尚未收口，目前显示时长固定 3 秒。
- 后台 FFmpeg/媒体解码、波形、VAD、离线 ASR 流水线尚未接入。

## 下一准确断点

先收口实时识别质量。若 SenseVoice 状态显示“检测到语音”但反复“解码返回空文本”，直接检查 OfflineRecognizer 配置、模型/runtime ABI 和音频 buffer，而不再调整 VAD；若 SenseVoice 能出字，则比较其延迟/准确率与 Zipformer Large。Zipformer Large 与 Paraformer 用同一片段实机 A/B 后，再决定默认实时模型。全屏 overlay 已验证，除非回归不再修改。