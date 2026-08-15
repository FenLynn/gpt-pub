# LocalSub HANDOFF

## 项目定位

Windows 本地实时字幕与后台视频转写工具。优先服务 PotPlayer，同时支持捕获所有 Windows 输出音频。基础 ASR 本地运行，不依赖云端 LLM/API。

## 已确认硬约束

- 绿色 ZIP，解压即用，不需要安装器。
- 日常测试默认交付增量覆盖 ZIP，只包含相对用户上一版实际变化的运行文件，ZIP 内路径直接以 LocalSub 根目录为基准。
- 只有首次安装、依赖/目录结构变化、无法安全增量覆盖或用户明确要求时才交付完整绿色包。
- 基础程序与 AtlasDesk / DavBridge 对齐：`.NET 8`、`SelfContained=false`、`PublishSingleFile=true`。
- 不要求 `.NET 10 Desktop Runtime`，复用系统已有 `.NET 8 Desktop Runtime`。
- 模型绝不随程序包分发。
- 默认模型根目录为 EXE 同级 `ASR`，设置中可改路径，模型扫描/下载/删除均以当前设置路径为准。
- 模型按 catalog 独立下载、独立删除，后续独立升级。
- 模型下载正式支持系统代理、直连、SOCKS5。SOCKS5 支持手工地址并可探测本机常见端口 7890、7891、10808、1080。
- 下载失败自动重试并保留 `.part` 用于断点续传。
- 实时音源仅保留 `PotPlayer` 与 `所有音频` 两种模式。
- PotPlayer 模式不得静默回退成全系统音频。
- 字幕使用 WebView2 + HTML/CSS 渲染。
- 后台方向固定为：媒体解码、波形、VAD、离线 ASR、关键词高亮/标记、TXT 导出。
- 项目自身可下载组件尽量位于 EXE 所在目录树，不主动散落到 Program Files / AppData。
- CI 不得只验证编译。除真实启动 EXE 外，PotPlayer Process Loopback 还必须独立做真实 COM 激活 smoke test。

## 当前开发分支与版本

- 分支：`p103-localsub-exp`
- 版本：`v0.1.0-dev`

## 当前已实现

### 绿色运行与模型管理

- WinForms / .NET 8 Windows 工程。
- 配置、Logs、Data、ASR 均按 EXE 相对路径管理。
- 模型 catalog：SenseVoice Small INT8、Streaming Paraformer 中英 INT8、Streaming Paraformer 中英粤 INT8、Fun-ASR-Nano INT8、Silero VAD。
- ModelManager：扫描、下载、关键文件检查、删除、断点续传、三次自动重试。
- `.tar.bz2` 使用 SharpCompress `ReaderFactory` 解压，损坏缓存自动清理。
- 模型页使用安全的 `TableLayoutPanel` 状态区，显示阶段、百分比、已下载量、速度、日志和取消按钮。
- 删除模型时同时清理该模型缓存、`.part` 和 staging，不删除共享 ASR runtime。
- Streaming Paraformer 不再下载包含 FP32 的完整大包，只下载 `encoder.int8.onnx`、`decoder.int8.onnx`、`tokens.txt` 三个必要文件。

### 下载与代理

- 系统代理、直连、SOCKS5 三种下载通道。
- SOCKS5 自动探测。
- GitHub Release 大文件链路测试。
- sherpa win-x64 native runtime 首次实时识别时下载到 `<ASR>\_runtime`，固定版本 `1.13.4`，后续程序补丁不重复携带。
- runtime 来源为 `org.k2fsa.sherpa.onnx.runtime.win-x64 1.13.4` NuGet 包，只提取 win-x64 native 文件。

### 真实实时字幕链路

- 已移除“演示字幕即功能”的旧逻辑。
- `所有音频`：WASAPI endpoint loopback -> 多声道转 mono -> 流式重采样到 16 kHz float -> Streaming Paraformer -> partial/final 文本 -> HTML 字幕。
- `PotPlayer`：Windows `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK` + PotPlayer PID -> PCM -> 16 kHz mono -> Streaming Paraformer -> HTML 字幕。
- PotPlayer 模式不回退到全系统音频。
- 实时识别器采用 sherpa-onnx 1.13.4 C API 在线 Paraformer 路径，P/Invoke 代码内置于 EXE，native DLL 外置于 `ASR\_runtime`。
- 实时下拉框只列真正的 Streaming Paraformer。SenseVoice 保留给后台和后续模拟流式模式。

### PotPlayer Process Loopback 实现

- 早期实现复用了 NAudio 2.3 的 COM RCW，并在 `ActivateAudioInterfaceAsync` 回调中把 `System.__ComObject` 强转为 `NAudio.CoreAudioApi.Interfaces.IAudioClient`。
- 用户实机于 2026-08-15 触发 `0x80004002 E_NOINTERFACE`，证明该 RCW 强转路径不可靠。模型已经正确下载，该故障发生在 PotPlayer 音频捕获启动阶段，与 Streaming Paraformer 模型文件无关。
- 当前实现已把 PotPlayer 专用捕获完全从 NAudio 2 COM RCW 强转中移出。NAudio 继续用于“所有音频”，PotPlayer 模式使用原始 COM 指针和 IAudioClient / IAudioCaptureClient vtable。
- 激活回调取得原始 `IUnknown` 后显式 QueryInterface，随后直接完成 `IAudioClient::Initialize`、`GetService(IAudioCaptureClient)`、`SetEventHandle`、`Start/Stop`。
- 捕获使用事件驱动方式，显式 44.1 kHz、16-bit、stereo PCM，再转 mono 并流式重采样到 16 kHz。
- 系统版本通过 `RtlGetVersion` 读取真实 Windows build。目前依据 Microsoft Application Loopback 文档以 build 20348 作为保守门槛；低于门槛时明确报出 build，不静默切换“所有音频”。后续若需要兼容 Windows 10 19041-20347，需单独实机验证后再放宽，因为 Microsoft 文档与新版本 NAudio 的最低版本标注并不完全一致。

### 字幕跟随

- HTML overlay 初始化等待 WebView2 和 HTML 导航完成。
- overlay 为 TopMost、非激活、鼠标穿透。
- 60 ms 检查 PotPlayer 窗口位置。
- 枚举 PotPlayer 进程可见顶层窗口并选择面积最大的窗口，以覆盖普通窗口、最大化、全屏和多窗口场景。
- 播放器移动/缩放时字幕随动；最小化时隐藏。

### 其他

- 后台页已有文件拖放队列、关键词数据结构和 TXT exporter 骨架。
- 启动及未处理异常记录到 EXE 同级 `LocalSub-crash.log`。

## 2026-08-15 关键故障记录

- 曾有模型页复杂 `SplitContainer` 在 WinForms 构造阶段导致双击秒退。已回退并用 `TableLayoutPanel` 重建。
- 自该故障起，CI 增加 startup smoke test，真实启动 `LocalSub.exe` 并等待 4 秒，进程提前退出即构建失败。
- 曾出现 `.tar.bz2` 下载成功但 `ArchiveFactory` 解压失败，已改为 SharpCompress 0.50.x 对应的 `ReaderFactory` 路径。
- 用户实机确认旧版只显示静态演示字幕、无真实转写且不随 PotPlayer 移动，随后替换为真实实时 ASR 和窗口跟随链路。
- 用户下载 `Streaming Paraformer 中英 INT8` 后，在 PotPlayer 模式启动时出现 `Unable to cast COM object ... IAudioClient ... 0x80004002 E_NOINTERFACE`。故障定位为旧 Process Loopback 的 NAudio 2 RCW 强转，不需要重新下载模型。
- 已以 raw COM 重写 PotPlayer Process Loopback，并新增独立 CI runtime smoke test，防止以后再次出现“能编译、能打开，但 Process Loopback 根本不能激活”的假通过。

## 最新构建验证

- Process Loopback 修复代码 head：`c955f058c96bb3557ac00b348f7320afdc50cfb0`。
- Windows CI run：`31891547581`，结论 success。
- `dotnet publish` 成功。
- `Smoke test LocalSub startup` 成功。
- `Smoke test Windows process loopback` 成功。Windows runner 实际对当前 LocalSub 进程执行 Process Loopback 激活，完成 IAudioClient 初始化、取得 IAudioCaptureClient、Start、Stop 后正常退出。
- `Verify sherpa win-x64 runtime package` 成功，runner 实际下载并加载 `sherpa-onnx-c-api.dll`。
- 打包前再次检查 ASR 目录，不允许模型、ONNX Runtime 或 sherpa native DLL 混入发布包。
- CI 已能验证 Process Loopback COM 链，但真实 PotPlayer 有声捕获、用户声卡环境和播放器随动仍需用户实机最终验证。

## 用户下一步实机验证

1. 关闭 LocalSub，覆盖最新只含 `LocalSub.exe` 的增量补丁。现有 Streaming Paraformer 与 `ASR\_runtime` 均保留，不重下。
2. 先选 `所有音频` 点击开始，验证 ASR 本体、音频重采样与 HTML 字幕链路。
3. 再选 `PotPlayer`，确认旧的 `System.__ComObject -> NAudio IAudioClient` 报错已经消失。
4. 如果 PotPlayer 模式仍失败，记录新的完整状态文本。新版本会显示更接近底层的 HRESULT，若系统版本门槛触发也会显示真实 Windows build。
5. PotPlayer 能启动后，再验证输入电平、partial 文本、窗口拖动、缩放、最大化、全屏和最小化。

## 当前真实未完成项

- SenseVoice 模拟流式尚未接入。
- 后台 FFmpeg/媒体解码、波形、VAD、离线 ASR 流水线尚未接入。
- 实时字幕样式、偏移、字号等用户设置尚未收口。
- Process Loopback raw COM 已通过 Windows runner 真激活门禁，但用户真实 PotPlayer 有声播放仍需最终实机验证。

## 下一准确断点

优先完成用户实机实时闭环验证。若 `所有音频` 正常而 `PotPlayer` 失败，直接依据新版本给出的 Windows build/HRESULT 调整 process loopback，不再怀疑或重下模型；若两种音源都有输入电平但无文本，检查 Streaming Paraformer / sherpa / PCM 16 kHz 链路；若文本正常但字幕位置异常，再检查 PotPlayer HWND、多屏和 DPI。实时闭环稳定后再推进后台文件转写。
