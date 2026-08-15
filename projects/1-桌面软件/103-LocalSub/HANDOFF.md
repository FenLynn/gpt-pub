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
- 当前用户核心语言限定为中文、英文；多语言优化与翻译延后，不进入当前阶段。

## 当前开发分支与版本

- 分支：`p103-localsub-exp`
- 版本：`v0.1.0-dev`

## 当前已实机确认

- `所有音频 + Streaming Paraformer 中英 INT8` 可以真实出字幕，因此模型、sherpa runtime、全局 loopback、16 kHz 音频链和 HTML 输出主链已经真实跑通。
- 用户反馈 Streaming Paraformer 整体识别效果一般，准确率不足，因此定位为“低延迟/极速实时档”。
- `Streaming Zipformer Large 中文 INT8` 用户实机反馈“好一点，还是可以的”，当前作为中文实时推荐候选。
- PotPlayer 普通窗口和全屏的外部字幕覆盖已经实机确认可见。全屏字幕链冻结，非回归不再改动。
- SenseVoice Small INT8 仍未通过用户实机验证，继续作为模拟流式/后台候选而非当前默认实时档。

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
- `Streaming Zipformer Large 中文 INT8`：中文准确率取向真流式模型，已实机验证比 Paraformer 更好一些。
- `SenseVoice Small INT8`：中英日韩粤，作为 VAD/能量分段模拟流式及后台模型，继续修复。
- `Fun-ASR-Nano INT8`：高质量后台模型。

### SenseVoice 当前修复

- VAD 优先 + RMS 音量 fallback。
- 当前参数：能量起始 RMS 0.008、维持 RMS 0.0035、连续 4 个 512-sample 窗口触发、550 ms 低能量判为停顿、最长单段 6.5 s。
- 语音进行时约每 650 ms 做一次 SenseVoice interim decode；停顿或达到最长分段时执行 final decode。
- 状态区区分 VAD 检测、RMS fallback、解码空文本等状态。

### PotPlayer Process Loopback

- 当前链：`ActivateAudioInterfaceAsync -> IAudioClient -> IAudioCaptureClient -> event-driven capture -> mono/16 kHz`。
- Windows 10 build 19045 允许实际尝试，不再被错误门槛阻断。
- CI 已真实执行 Process Loopback 激活、Initialize、GetService、Start、Stop。

### 字幕显示与跟随

- overlay 为非激活、鼠标穿透窗口。
- 60 ms 跟随 PotPlayer 最大可见顶层窗口。
- 每次跟随和每次新字幕写入均重新断言 `HWND_TOPMOST`，不抢 PotPlayer 焦点。
- 用户已确认全屏有字幕，本问题当前视为解决。
- 字幕只保留当前句 + 上一句，最后一次识别更新后 3 秒自动清空。
- 当前默认 CSS 仍偏测试版：当前句 34 px、font-weight 600、黑色半透明块底纹。用户已明确要求下一轮调整并开放位置、字号、尺寸、底纹等设置。

## 2026-08-16 下一阶段用户裁决

用户明确同意进入第二阶段，要求：

1. **字幕样式正式可调**。默认应比当前更小、更轻，优先采用无整块底纹、黑色描边/阴影的播放器原生风格。设置至少包含字号/自动字号、底部偏移、最大宽度、底纹模式和透明度、显示时长，并提供实时预览。
2. **模型表格扩展**。把当前讨论过且对中文/英文有实际意义的模型都加入 catalog，并在模型表格显示体积、实时性评分、准确率评分、综合性价比。评分属于 LocalSub 面向 CPU 本地字幕场景的相对工程评分，后续可根据用户实机 A/B 调整，不伪装成官方基准。
3. **实时模型继续扩展**。除现有 Zipformer Large 外，加入 Zipformer XLarge Transducer、Zipformer CTC Large、Zipformer CTC XLarge 等中文流式候选；保留 Paraformer 中英作为英文/低延迟档。用户目前只关心中文、英文，多语言和翻译暂缓。
4. **后台视频解析正式开始**。不再只保留拖放占位。第一步闭环为：拖入视频 -> 解析媒体/音频轨 -> 解码音频 -> 生成声音波形/幅度轨 -> 显示媒体时长、音频信息与解析进度。随后在该时间轴上接 VAD、离线 ASR、关键词事件。
5. 媒体解析组件仍遵循绿色规则。若采用 FFmpeg，不塞进每次程序补丁，应下载/放置在 EXE 目录树下独立复用，不污染 Program Files/AppData。

## 后台方向

- 已有文件拖放队列、关键词数据结构和 TXT exporter 骨架。
- 下一准确实现断点：接媒体探测与音频解码、声音波形时间轴，然后接 VAD 和离线 ASR。

## 关键故障记录

- 模型页复杂 SplitContainer 曾导致启动秒退，已改安全 TableLayoutPanel，并固化 EXE startup smoke test。
- `.tar.bz2` 曾下载成功但 ArchiveFactory 解压失败，已改 ReaderFactory。
- 旧 Process Loopback NAudio 2 RCW 强转触发 E_NOINTERFACE，已改 raw COM。
- Windows 19045 曾因错误的 20348 门槛被阻断，已改实际尝试。
- sherpa managed wrapper 曾把 `onnxruntime.dll` 传递带回 publish，CI 已拦截并在 publish 阶段剥离。
- PotPlayer 全屏 overlay 曾不可见，已增加持续 TopMost Z-order 维护，用户已实机确认解决。

## 最新构建验证

- 最新代码验证 head：`3df59dc943577347c621e93f894bc3a23299b003`。
- Windows CI run：`31894237657`，结论 success。
- `dotnet publish`、EXE startup、Process Loopback、sherpa native runtime、轻量打包均 success。
- 最新 catalog head 在此后继续更新模型列表。

## 下一准确断点

优先一次性推进三项：字幕样式设置、完整模型评分表、后台媒体解析与声音波形。实时主链和全屏 overlay 已有可用基线，除非回归不再重构。后台解析第一版先做到“视频拖入后很快看见媒体信息和声音波形”，再把离线 ASR 接到同一时间轴。