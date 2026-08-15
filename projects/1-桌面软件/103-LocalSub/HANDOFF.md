# LocalSub HANDOFF

## 项目定位

Windows 本地实时字幕与后台视频转写工具。优先服务 PotPlayer，同时支持捕获所有 Windows 输出音频。基础 ASR 永远本地运行，不依赖云端 LLM/API。

## 已确认硬约束

- 绿色 ZIP，解压即用，不需要安装。
- 模型绝不随程序包分发。
- 默认模型根目录为 EXE 同级 `ASR`，设置中可改路径。
- 模型按 catalog 独立下载、完整性扫描、删除与后续升级。
- 模型下载支持系统代理、直连、显式 SOCKS5，例如 `socks5://127.0.0.1:7890`。
- 实时音源仅保留 `PotPlayer` 与 `所有音频` 两种模式。
- 字幕使用 WebView2 + HTML/CSS 渲染。
- 后台支持拖入视频，高速转写方向固定为：媒体解码、波形、VAD、离线 ASR、关键词高亮/标记、TXT 导出。

## 当前开发分支

`p103-localsub-exp`

## 当前版本

`v0.1.0-dev`

## 当前已实现

- WinForms / .NET 10 Windows 工程骨架。
- 便携配置与 EXE 相对路径解析。
- ASR 目录默认建立在 `<EXE>\ASR`。
- 模型 catalog：SenseVoice Small INT8、Streaming Paraformer 中英、Streaming Paraformer 中英粤、Fun-ASR-Nano INT8、Silero VAD。
- ModelManager：扫描、下载、`.tar.bz2` 解压、关键文件完整性检测、删除。
- 下载传输：系统代理、直连、SOCKS5。
- PotPlayer 进程检测。
- 所有音频 WASAPI loopback 输入探针与电平显示。
- WebView2 HTML 字幕 overlay 骨架。
- 后台文件拖放队列、关键词数据结构、TXT exporter 骨架。
- Windows x64 self-contained 绿色包 CI，且 CI 检查 `publish/ASR` 不得含 ONNX 模型。

## 首次真实构建验证

- CI workflow 已通过独立 PR #383 合入 main，项目源码仍只在 `p103-localsub-exp`。
- Windows run #6（run id `31883721431`）已完整成功：restore、publish、portable layout、artifact upload 均通过。
- 产物：`LocalSub-v0.1.0-dev-win-x64.zip`。
- CI artifact SHA-256：`64359cb15e8ce85d2797fd7d77da75d5563d06fbc7b1d3398a5fe68836e25c4d`（GitHub artifact 外层）。
- 提取出的实际绿色 ZIP 已再次扫描，`ASR` 中模型文件数量为 0。

## 当前真实未完成项

- PotPlayer process-specific loopback 尚未接入，当前只检测 PID，不会错误回退到全局音频。
- sherpa-onnx 真实流式 ASR 尚未接入音频链路。
- 后台 FFmpeg/媒体解码、波形、VAD、离线 ASR 流水线尚未接入。
- 字幕 overlay 尚未自动跟随 PotPlayer 窗口位置与全屏状态。

## 下一准确断点

优先实现 `PotPlayer Process Loopback -> 16 kHz mono -> streaming recognizer -> HTML overlay` 的完整实时闭环；随后接 `File Decode -> Waveform/VAD -> offline recognizer -> keywords/TXT` 后台闭环。
