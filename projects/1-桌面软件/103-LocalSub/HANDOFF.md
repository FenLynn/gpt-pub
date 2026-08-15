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
- CI 不得只验证编译，必须真实启动 EXE 做 startup smoke test。

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
- Streaming Paraformer 不再下载包含 FP32 的约 1.1 GB 整包，只从官方 Hugging Face 模型仓库下载 `encoder.int8.onnx`、`decoder.int8.onnx`、`tokens.txt` 三个必要文件，约 237/238 MB。

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
- PotPlayer process loopback 使用 Windows 官方 Application Loopback 机制，不回退到全系统音频。
- 实时识别器采用 sherpa-onnx 1.13.4 C API 的在线 Paraformer 路径，P/Invoke 代码内置于 EXE，native DLL 外置于 `ASR\_runtime`。
- 实时下拉框只列出真正的 Streaming Paraformer，不再把 SenseVoice 冒充真正 streaming 模型。SenseVoice 保留给后台和后续模拟流式模式。

### 字幕跟随

- HTML overlay 初始化改为等待 WebView2 和 HTML 导航完成，不再丢第一句。
- overlay 为 TopMost、非激活、鼠标穿透。
- 60 ms 检查 PotPlayer 窗口位置。
- 不只使用 `MainWindowHandle`，而是枚举 PotPlayer 进程可见顶层窗口并选择面积最大的窗口，以覆盖普通窗口、最大化、全屏和多窗口场景。
- 播放器移动/缩放时字幕随动；最小化时隐藏。

### 其他

- 后台页已有文件拖放队列、关键词数据结构和 TXT exporter 骨架。
- 启动及未处理异常记录到 EXE 同级 `LocalSub-crash.log`。

## 2026-08-15 关键故障记录

- 曾有模型页复杂 `SplitContainer` 在 WinForms 构造阶段导致双击秒退。已回退并用 `TableLayoutPanel` 重建。
- 自该故障起，CI 增加 startup smoke test，真实启动 `LocalSub.exe` 并等待 4 秒，进程提前退出即构建失败。
- 曾出现 `.tar.bz2` 下载成功但 `ArchiveFactory` 解压失败，已改为 SharpCompress 0.50.x 对应的 `ReaderFactory` 路径。
- 用户实机确认旧版只显示静态演示字幕、无真实转写且不随 PotPlayer 移动。本轮已将该骨架替换为真实实时 ASR 和窗口跟随链路。

## 最新构建验证

- 最新代码 head：`658a0e5cd1a878e69506e745042047cd68880e5e`。
- Windows CI run：`31890719217`，结论 success。
- `dotnet publish` 成功。
- `Smoke test LocalSub startup` 成功，EXE 启动后持续存活。
- `Verify sherpa win-x64 runtime package` 成功，runner 实际下载 `org.k2fsa.sherpa.onnx.runtime.win-x64 1.13.4` 并成功加载 `sherpa-onnx-c-api.dll`。
- 打包前再次检查 ASR 目录，不允许模型、ONNX Runtime 或 sherpa native DLL 混入发布包。
- 该 CI 不能模拟用户真实 PotPlayer 音频播放，因此 PotPlayer process loopback 的实际有声识别和播放器随动仍需用户 Windows 实机最终验证。

## 用户下一步实机验证

1. 覆盖最新增量包。
2. 在模型页下载 `Streaming Paraformer 中英 INT8`，约 237 MB。若 Hugging Face 受限，使用已经配置好的 SOCKS5。
3. 实时页先选 `所有音频` 测试，点击开始。首次会把约 8 MB sherpa native runtime 下载到 `ASR\_runtime`。
4. 确认真正出现识别文本和 partial 更新。
5. 再切 `PotPlayer`，确认仅 PotPlayer 音频可识别。
6. 拖动、缩放、最大化、全屏、最小化 PotPlayer，确认字幕跟随和隐藏行为。
7. 如启动/运行异常，检查 EXE 同级 `LocalSub-crash.log`；如识别失败，记录实时页状态文本。

## 当前真实未完成项

- SenseVoice 模拟流式尚未接入。
- 后台 FFmpeg/媒体解码、波形、VAD、离线 ASR 流水线尚未接入。
- 实时字幕样式、偏移、字号等用户设置尚未收口。
- PotPlayer process loopback 虽已按 Windows 官方机制实现并通过编译/启动门禁，但尚未经过用户真实 PotPlayer 播放实机验证。

## 下一准确断点

先以用户实机验证真实实时闭环为硬门禁。若 `所有音频` 有输入电平但无文本，优先检查 Streaming Paraformer 模型完整性、sherpa native ABI 和 PCM->16 kHz 数据链；若 `所有音频` 正常而 `PotPlayer` 无文本，优先检查 process loopback 激活/捕获；若文本正常但字幕位置异常，优先检查 PotPlayer HWND 选择与多屏/DPI 坐标。实时闭环稳定后再推进后台文件转写。
