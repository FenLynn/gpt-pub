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

- 用户已于 2026-08-15 实机确认 `所有音频 + Streaming Paraformer 中英 INT8` 可以真实出字幕。因此模型、sherpa runtime、Windows 全局 loopback、16 kHz 数据链和 HTML 输出主链已获得实机证据。
- Streaming Paraformer 为真流式，输出 partial/final。
- SenseVoice Small INT8 已加入实时模型下拉框，采用官方同类思路的模拟流式：Silero VAD 检测语音段，停顿后用 SenseVoice 离线解码该段。
- 选择 SenseVoice 时若 Silero VAD 未安装，自动通过现有下载/代理通道补齐约 2 MB VAD 模型。
- SenseVoice 使用现有 `model.int8.onnx + tokens.txt`，不需要重新下载已安装模型。
- 为使用官方 sherpa managed API，项目加入 `org.k2fsa.sherpa.onnx 1.13.4` 托管接口；其 NuGet 传递带入的 `onnxruntime.dll` / native c-api 在 publish 阶段明确剥离，运行时仍只复用 `ASR\_runtime`，不破坏轻量绿色规则。

### PotPlayer Process Loopback

- 旧版曾把 `System.__ComObject` 强转为 NAudio 2 的 `IAudioClient`，用户实机触发 `0x80004002 E_NOINTERFACE`。该路径已废弃。
- PotPlayer 捕获已改为 raw COM：`ActivateAudioInterfaceAsync -> IAudioClient -> IAudioCaptureClient -> event-driven capture`，再转 mono / 16 kHz。
- CI 已真实执行 Process Loopback 激活、Initialize、GetService、Start、Stop，不再只做编译验证。
- 用户系统为 Windows 10 build **19045**。上一版错误地按 Microsoft Learn 的保守 20348 门槛提前阻断，本版改为 **19041+ 实际尝试**，与当前 NAudio 3 的 process-loopback 最低版本实现口径一致。
- 如果 19041+ 系统真实激活仍失败，错误会带 Windows build 和 HRESULT；仍不会静默回退“所有音频”。
- 用户 19045 上的真实 PotPlayer 有声捕获尚需本版最终实机验证。

### 字幕显示与跟随

- overlay 为 TopMost、非激活、鼠标穿透。
- 60 ms 跟随 PotPlayer 最大可见顶层窗口，覆盖移动、缩放、最大化、全屏；最小化时隐藏。
- 字幕历史只保留当前句 + 上一句，最多两个字幕条目。
- 最后一次识别更新后 **3 秒自动清空**；HTML 对空 current/previous 使用 `display:none`，因此 3 秒后连半透明空框也完全消失，新结果出现时自动恢复。

### 后台方向

- 已有文件拖放队列、关键词数据结构和 TXT exporter 骨架。
- FFmpeg/媒体解码、波形、VAD、离线 ASR、关键词时间轴尚未进入可用闭环。

## 关键故障记录

- 模型页复杂 SplitContainer 曾导致启动秒退，已改为安全 TableLayoutPanel，并固化 EXE startup smoke test。
- `.tar.bz2` 曾下载成功但 ArchiveFactory 解压失败，已改 ReaderFactory。
- 旧 Process Loopback 的 NAudio 2 RCW 强转触发 `E_NOINTERFACE`，已改 raw COM。
- Windows 19045 曾因错误的 20348 前置门槛被直接阻断，本版已改为 19041+ 实际尝试。
- 加入 sherpa managed wrapper 后，NuGet 曾把 `onnxruntime.dll` 传递带回 publish，CI 成功拦截；现已在 publish 阶段剥离并保留硬检查。

## 最新构建验证

- 最新交付代码 head：`3d640cbacf9d560e53fb9da5f1322b3840ddf32c`。
- Windows CI run：`31892655045`，结论 success。
- `dotnet publish`：success。
- `Prepare portable layout`：success，确认传递 native ASR runtime 已剥离。
- `Smoke test LocalSub startup`：success。
- `Smoke test Windows process loopback`：success，runner 实际完成 COM 激活、音频客户端初始化、捕获客户端取得、Start/Stop。
- `Verify sherpa win-x64 runtime package`：success，实际加载 `sherpa-onnx-c-api.dll`。
- `Package portable ZIP`：success，发布包仍无模型、无 ONNX Runtime、无 sherpa native runtime。

## 用户下一步实机验证

1. 覆盖最新增量包，不删除现有 `ASR`、Streaming Paraformer、SenseVoice 或 `ASR\_runtime`。
2. `所有音频 + Streaming Paraformer`：确认字幕最多两条、停止讲话约 3 秒后完全消失。
3. `PotPlayer + Streaming Paraformer`：在 Windows 19045 上确认已不再被版本门槛阻断，并观察输入电平/字幕；若失败记录新的 build + HRESULT。
4. `所有音频 + SenseVoice Small INT8`：确认下拉框可选。若 Silero VAD 未安装会自动补齐，讲话停顿后应按段出句。
5. 前述稳定后再测试 PotPlayer + SenseVoice。

## 当前真实未完成项

- Windows 19045 上 PotPlayer Process Loopback 有声实机验证。
- SenseVoice 模拟流式的用户实机识别验证。
- 实时字幕字号、偏移、显示时长等可配置项尚未收口，目前显示时长固定 3 秒。
- 后台 FFmpeg/媒体解码、波形、VAD、离线 ASR 流水线尚未接入。

## 下一准确断点

先收口实时链路。若 `所有音频` 继续正常而 `PotPlayer` 失败，只依据新 HRESULT / build 修 Process Loopback，不再怀疑模型；若 SenseVoice 失败，优先检查 VAD 模型、managed wrapper 到 `ASR\_runtime` 的 DLL 搜索和分段解码。实时双音源与两类识别器稳定后，再进入后台文件转写。
