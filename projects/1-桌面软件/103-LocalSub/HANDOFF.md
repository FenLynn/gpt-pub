# LocalSub HANDOFF

## 项目定位

Windows 本地实时字幕与后台视频转写工具。优先服务 PotPlayer，同时支持捕获所有 Windows 输出音频。基础 ASR 永远本地运行，不依赖云端 LLM/API。

## 已确认硬约束

- 绿色 ZIP，解压即用，不需要安装器。
- 后续日常测试默认交付“增量覆盖 ZIP”：只包含相对于用户上一版基线实际发生变化的运行文件，ZIP 内路径直接以 LocalSub 根目录为基准，用户解压到现有程序根目录并覆盖即可。
- 只有首次安装、运行依赖/目录结构发生变化、无法安全增量覆盖或用户明确要求时，才交付完整绿色包。
- 基础程序发布方式与 AtlasDesk / DavBridge 对齐：`.NET 8`、`SelfContained=false`、`PublishSingleFile=true`。
- 不再要求或下载 `.NET 10 Desktop Runtime`；复用用户电脑已有的 `.NET 8 Desktop Runtime`。
- 模型绝不随程序包分发。
- 默认模型根目录为 EXE 同级 `ASR`，设置中可改路径。
- 模型按 catalog 独立下载、完整性扫描、删除与后续升级。
- 模型下载正式支持系统代理、直连、SOCKS5 三种通道，SOCKS5 为受限网络下的一等下载通道。
- SOCKS5 支持手工地址，例如 `socks5://127.0.0.1:7891`，并可自动探测本机常见端口 7890、7891、10808、1080。
- 模型下载连接超时从 20 秒提高到 60 秒；下载失败自动重试三次并保留 `.part` 文件用于断点续传。
- “测试模型下载链”使用真实 GET + Range 请求，验证 GitHub Release 到实际大文件资源域名的重定向链。
- 实时音源仅保留 `PotPlayer` 与 `所有音频` 两种模式。
- 字幕使用 WebView2 + HTML/CSS 渲染。
- 后台支持拖入视频，高速转写方向固定为：媒体解码、波形、VAD、离线 ASR、关键词高亮/标记、TXT 导出。
- 项目自身可下载组件尽量保留在 EXE 所在目录树内，不主动写入 Program Files / AppData 作为依赖目录。
- CI 不得只验证编译。Windows 构建必须实际启动 `LocalSub.exe` 做 startup smoke test，确认程序未在启动阶段立即退出后方可打包。

## 当前开发分支

`p103-localsub-exp`

## 当前版本

`v0.1.0-dev`

## 当前已实现

- WinForms / .NET 8 Windows 工程骨架。
- 便携配置与 EXE 相对路径解析。
- ASR 目录默认建立在 `<EXE>\ASR`。
- 模型 catalog：SenseVoice Small INT8、Streaming Paraformer 中英、Streaming Paraformer 中英粤、Fun-ASR-Nano INT8、Silero VAD。
- ModelManager：扫描、下载、关键文件完整性检测、删除、断点续传、三次自动重试。
- `.tar.bz2` 模型包已改为 SharpCompress `ReaderFactory` 解压，不再使用 0.50.x 对压缩 TAR 不适合的 `ArchiveFactory` 路径。
- 完整 `.tar.bz2` 缓存可复用，避免解压失败后重新下载数百 MB；无效 BZip2 缓存会删除后提示重试。
- 下载传输：系统代理、直连、SOCKS5，本机 SOCKS5 自动探测和真实模型链路测试。
- PotPlayer 进程检测。
- 所有音频 WASAPI loopback 输入探针与电平显示。
- WebView2 HTML 字幕 overlay 骨架。
- 后台文件拖放队列、关键词数据结构、TXT exporter 骨架。
- 启动及未处理异常会记录到 EXE 同级 `LocalSub-crash.log`，不再静默秒退。
- Windows x64 framework-dependent 单文件绿色包 CI，且 CI 检查不得携带模型、.NET runtime 或 ONNX Runtime。

## 2026-08-15 启动故障与修复

- 用户实机反馈新增模型状态窗口版本双击无反应，程序无法打开。
- 故障范围已定位到新模型页复杂 `SplitContainer` 布局变更。该版本虽然能编译，但缺少真实启动验证。
- 已立即回退模型页到上一版已实机可启动的安全布局，保留 SOCKS5 下载增强。
- `.tar.bz2` 解压修复独立保留在 ModelManager 中。
- `Program.cs` 新增 EXE 同目录崩溃日志 `LocalSub-crash.log`。
- CI run `31889033321` 首次新增并通过 `Smoke test LocalSub startup`：真实启动 EXE，等待 4 秒确认进程仍存活，再终止并打包。
- 因此当前 hotfix 已同时通过编译验证和真实启动 smoke test。
- 之前计划的模型页“详细状态窗口、速度、阶段日志、取消按钮”暂时回退，下一轮必须用启动安全的布局重新实现，并继续通过 startup smoke test。

## 构建验证

- 初始 self-contained 验证包曾约 66 MB，仅用于工程验证，已废弃作为正式发布结构。
- 当前轻量 framework-dependent 包约 8 MB 压缩体积。
- 2026-08-15 已对照 AtlasDesk 与 DavBridge，将 LocalSub 改为 `net8.0-windows10.0.19041.0`，framework-dependent 单文件发布。
- SOCKS5 下载增强版本 Windows CI run `31885669915` 已成功。
- startup hotfix Windows CI run `31889033321` 已成功，包含真实 EXE 启动 smoke test。
- 绿色包继续保持无 ASR 模型、无 ONNX Runtime、无 .NET runtime。

## 当前真实未完成项

- 模型页详细状态窗口需在稳定启动基线上重新实现。
- PotPlayer process-specific loopback 尚未接入，当前只检测 PID，不会错误回退到全局音频。
- sherpa-onnx 真实流式 ASR 尚未接入音频链路。
- 后台 FFmpeg/媒体解码、波形、VAD、离线 ASR 流水线尚未接入。
- 字幕 overlay 尚未自动跟随 PotPlayer 窗口位置与全屏状态。

## 下一准确断点

先由用户实机验证 startup hotfix 能正常打开，并验证现有模型缓存能通过 ReaderFactory 正确解压。随后在不使用启动阶段危险 SplitContainer 参数的前提下，重新实现模型下载详细状态窗口，并保持 startup smoke test 为硬门禁。之后再推进 `PotPlayer Process Loopback -> 16 kHz mono -> streaming recognizer -> HTML overlay`。
