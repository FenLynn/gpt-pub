# LocalSub HANDOFF

## 项目定位

Windows 本地实时字幕与后台视频转写工具。优先服务 PotPlayer，同时支持捕获所有 Windows 输出音频。基础 ASR 永远本地运行，不依赖云端 LLM/API。

## 已确认硬约束

- 绿色 ZIP，解压即用，不需要安装器。
- 基础程序发布方式与 AtlasDesk / DavBridge 对齐：`.NET 8`、`SelfContained=false`、`PublishSingleFile=true`。
- 不再要求或下载 `.NET 10 Desktop Runtime`；复用用户电脑已有的 `.NET 8 Desktop Runtime`。
- 模型绝不随程序包分发。
- 默认模型根目录为 EXE 同级 `ASR`，设置中可改路径。
- 模型按 catalog 独立下载、完整性扫描、删除与后续升级。
- 模型下载正式支持系统代理、直连、SOCKS5 三种通道，SOCKS5 为受限网络下的一等下载通道。
- SOCKS5 支持手工地址，例如 `socks5://127.0.0.1:7891`，并可自动探测本机常见端口 7890、7891、10808、1080。
- 模型下载连接超时从 20 秒提高到 60 秒；下载失败自动重试三次并保留 `.part` 文件用于断点续传。
- 模型下载错误需区分连接失败、连接超时、用户取消和文件中断，不再只显示 `The operation was canceled.`。
- “测试模型下载链”使用真实 GET + Range 请求，验证 GitHub Release 到实际大文件资源域名的重定向链，而不是只做 HEAD 探测。
- 实时音源仅保留 `PotPlayer` 与 `所有音频` 两种模式。
- 字幕使用 WebView2 + HTML/CSS 渲染。
- 后台支持拖入视频，高速转写方向固定为：媒体解码、波形、VAD、离线 ASR、关键词高亮/标记、TXT 导出。
- 项目自身可下载组件尽量保留在 EXE 所在目录树内，不主动写入 Program Files / AppData 作为依赖目录。

## 当前开发分支

`p103-localsub-exp`

## 当前版本

`v0.1.0-dev`

## 当前已实现

- WinForms / .NET 8 Windows 工程骨架。
- 便携配置与 EXE 相对路径解析。
- ASR 目录默认建立在 `<EXE>\ASR`。
- 模型 catalog：SenseVoice Small INT8、Streaming Paraformer 中英、Streaming Paraformer 中英粤、Fun-ASR-Nano INT8、Silero VAD。
- ModelManager：扫描、下载、`.tar.bz2` 解压、关键文件完整性检测、删除、断点续传、三次自动重试。
- 下载传输：系统代理、直连、SOCKS5；新增本机 SOCKS5 自动探测和真实模型链路测试。
- PotPlayer 进程检测。
- 所有音频 WASAPI loopback 输入探针与电平显示。
- WebView2 HTML 字幕 overlay 骨架。
- 后台文件拖放队列、关键词数据结构、TXT exporter 骨架。
- Windows x64 framework-dependent 单文件绿色包 CI，且 CI 检查 `publish/ASR` 不得含 ONNX 模型、不得携带 .NET runtime 或 ONNX Runtime。

## 构建验证

- 初始 self-contained 验证包曾约 66 MB，仅用于工程验证，已废弃作为正式发布结构。
- 后续轻量化去除 .NET runtime 后约 8 MB。
- 2026-08-15 已对照 AtlasDesk 与 DavBridge，将 LocalSub 从 `net10.0-windows` 改为 `net8.0-windows10.0.19041.0`，并启用 framework-dependent 单文件发布。
- Windows CI run `31884989845` 已成功完成 .NET 8 单文件构建。
- SOCKS5 下载增强版本 Windows CI run `31885669915` 已成功完成 restore、publish、portable layout 与 artifact upload。
- 最新实际绿色 ZIP：`LocalSub-v0.1.0-dev-win-x64-net8-socks5-green.zip`，SHA-256 `af89bca91531de96914a97a88616e65a68f334fb2ee99c2ca6d500f97c40cc6f`。
- 绿色包继续保持无 ASR 模型、无 ONNX Runtime、无 .NET runtime。

## 当前真实未完成项

- PotPlayer process-specific loopback 尚未接入，当前只检测 PID，不会错误回退到全局音频。
- sherpa-onnx 真实流式 ASR 尚未接入音频链路。
- 后台 FFmpeg/媒体解码、波形、VAD、离线 ASR 流水线尚未接入。
- 字幕 overlay 尚未自动跟随 PotPlayer 窗口位置与全屏状态。

## 下一准确断点

先由用户实机验证 SOCKS5 模型下载链和断点续传行为。通过后优先实现 `PotPlayer Process Loopback -> 16 kHz mono -> streaming recognizer -> HTML overlay` 的完整实时闭环；随后接 `File Decode -> Waveform/VAD -> offline recognizer -> keywords/TXT` 后台闭环。
