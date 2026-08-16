# LocalSub HANDOFF

## 项目定位

Windows 本地实时字幕与后台视频转写工具，优先服务 PotPlayer，同时支持捕获所有 Windows 输出音频。核心 ASR 本地运行，不依赖云端 API。

## 当前用户决策

- Mediova 与 LocalSub 暂不合并，未来若统一入口只考虑轻量总控/启动器。
- 当前核心语言限定中文、英文，翻译和多语言专项优化延后。
- 当前阶段以完整候选和真实实机问题修复为主，不继续无边界增加功能。
- FFmpeg 优先复用已有 Mediova/系统 FFmpeg，独立下载只作为兜底。
- 日常交付默认给相对上一用户版的增量覆盖 ZIP。

## 硬约束

- Windows 绿色 ZIP。
- `.NET 8` framework-dependent single-file，不引入 `.NET 10`。
- 模型不进入程序包，默认位于 EXE 同级 `ASR`，路径可配置。
- sherpa native runtime 位于 `ASR\_runtime`，程序补丁不重复携带。
- PotPlayer 模式只能做进程专用捕获，不得静默回退为全系统音频。
- FFmpeg、模型等大型组件独立管理。

## 当前开发状态

- 分支：`p103-localsub-exp`
- 版本：`v0.1.0-dev`
- 当前功能 head：`5fc9ab4d2dbd08e2728656da8c44c9afc3ea697a`
- Windows CI run：`31945115694`，结论 `success`。
- 该 run 已通过：publish、绿色包检查、EXE 真启动、后台工作区真切换、Windows Process Loopback 真激活、sherpa native runtime 加载、**native 离线 ASR 真解码**、最终打包。
- native 离线 ASR smoke 会临时下载 sherpa 官方小型 TDNN yes/no 模型，实际执行 CreateRecognizer -> CreateStream -> AcceptWaveform -> Decode -> JSON result，并验证返回非空文字。测试模型和 runtime 不进入发布包。

## 已实机确认基线

- `所有音频 + Streaming Paraformer 中英 INT8` 可真实出字幕，但用户认为准确率一般，定位为低延迟档。
- `Streaming Zipformer Large 中文 INT8` 实机可用，用户反馈明显好一些，当前中文实时推荐基线。
- PotPlayer 普通窗口和全屏 overlay 已实机可见。
- PotPlayer 快进/快退曾出现 `HRESULT 0x8000FFFF`，恢复 supervisor 已改为按 PCM 失活判断和退避重试，用户反馈较旧版“好一点”，仍需持续实机验证。
- 后台 MP4 可由 Media Foundation 正常解析，能够取得时长、采样率、声道并生成波形。
- 后台第一次真实转写曾出现 `完成 0 段 / RTF 0.01`，已加入 Silero VAD 放宽、自适应 RMS fallback 和宽松 8 秒 fallback。
- 后台随后暴露 `Object reference not set`，进一步定位到 sherpa 1.13.4 managed `OfflineStream.Result` 对空 native result 不安全。
- 绕过 Result 后又暴露 `sherpa-onnx 未能创建离线识别流`，进一步确认 managed `OfflineRecognizer` 构造器不会检查 native recognizer 是否为 NULL。
- 2026-08-16 当前修复已将 LocalSub 的离线 recognizer 创建迁移到直接 sherpa C API，尚待用户用真实 SenseVoice/Fun-ASR-Nano 再次实机验证。

## 实时字幕

- 音源：`PotPlayer` / `所有音频`。
- PotPlayer 使用 raw COM Process Loopback，Windows 10 build 19041+ 实际尝试，不静默回退。
- `ResilientPotPlayerCaptureService`：标题变化不再立即拆流，PCM 真失活后才重建；恢复退避约 0.35 / 0.7 / 1.2 / 2 / 3 秒；真正重建时清旧 PCM 和当前流式句状态，但不重新加载模型。
- WebView2 overlay 非激活、鼠标穿透、持续 TopMost，支持普通窗口、最大化和全屏。
- 字幕最多当前句 + 上一句，默认 3 秒无更新消失。
- 字幕设置已支持：自动/固定字号、自动字号倍率 60%~160%、当前字幕颜色/字重、上一条大小比例/颜色/透明度/字重、描边颜色/粗细、阴影强度、底部偏移、最大宽度、底纹和持续时间。

## 模型

主要 catalog：

- Zipformer CTC Small 中文 INT8，约 26 MB。
- Zipformer CTC Large 中文 INT8，约 155 MB。
- Zipformer Large 中文 INT8，约 160 MB。
- Streaming Paraformer 中英 INT8，约 237 MB。
- SenseVoice Small INT8，约 230 MB。
- Offline Zipformer CTC 中文 INT8，约 350 MB。
- Zipformer CTC XLarge 中文 INT8，约 728 MB。
- Zipformer XLarge 中文 INT8，约 736 MB。
- Fun-ASR-Nano INT8，约 0.9 GB。
- Silero VAD，约 2 MB。

模型页显示语言、体积、实时性、准确率、性价比和安装状态。已安装且关键文件存在显示黑色，未安装显示浅灰色；实时/后台下拉框只显示对应能力且已安装的模型。

## 后台转写

链路：

`媒体 -> Media Foundation / FFmpeg fallback -> 16 kHz mono -> Silero VAD -> 自适应 RMS fallback -> Offline ASR -> 时间戳 transcript -> 关键词 -> TXT / JSON`

已实现：

- 视频/音频拖放和多文件队列。
- 添加、移除、清空、转写选中、全部转写、取消。
- Media Foundation 优先，FFmpeg fallback。
- FFmpeg 可手动指定已有路径，并自动尝试 LocalSub 自有、`MEDIOVA_RUNTIME_DIR`、附近 Mediova `Components\FFmpeg\bin`、系统 PATH。
- 修复 FFmpeg 下载 416，下载完成校验 ZIP、ffmpeg、ffprobe。
- Silero VAD + 自适应 RMS fallback + 宽松 8 秒 fallback。
- RMS/peak 声音波形、语音区间、关键词 marker。
- **波形显示已改为视觉归一化**：使用高分位有效峰值作为显示基准，主要峰值拉到轨道约 95%，孤立尖峰软限幅；仅影响绘图，不改变真实 PCM/VAD/ASR。
- 转写正文时间戳与关键词高亮。
- TXT 手工导出，结构化 JSON 自动保存到 `Data\Transcripts`。
- RTF、进度、分段数、日志 `Logs\batch.log`。
- 后台工作区延迟加载。

## 2026-08-16 离线 ASR 关键修复

### 问题链

1. `stream.Result.Text` 在部分空 native result 上抛 NullReference。
2. 改用 sherpa JSON result C API 后，实机暴露 `CreateStream()` 返回空句柄。
3. 对照 sherpa-onnx 1.13.4 源码确认 managed `OfflineRecognizer` 构造器只是保存 `SherpaOnnxCreateOfflineRecognizer()` 返回值，不检查 NULL，因此模型配置/加载失败会被延迟表现为 CreateStream=0。

### 当前修复

- 新增 `NativeOfflineRecognizer`，直接 P/Invoke sherpa-onnx 1.13.4 C API。
- native config 按官方 C 示例语义零初始化，只填写当前模型家族需要字段，未使用指针保持 NULL。
- Windows 路径使用 UTF-8 marshaling，不再依赖 managed offline wrapper 的 ANSI `LPStr` 路径。
- 支持当前后台模型：SenseVoice、Offline Zipformer CTC、Fun-ASR-Nano。
- 识别结果使用 `SherpaOnnxGetOfflineStreamResultAsJson()`，空指针安全处理。
- LocalSub 内部 compatibility bridge 保持现有 batch/VAD/fallback 调用结构不变，但离线 recognizer/stream 创建已经切到 native C API。
- SenseVoice 增加宽松体积完整性预检，明显截断的 `model.int8.onnx` 或 `tokens.txt` 会直接提示重新下载/修复，而不是继续显示成不可解释的流创建失败。
- CI 新增 native offline ASR 真烟测，run `31945115694` 已成功解码官方小型测试 WAV。

## 性能与系统

- 资源模式：节能 / 自动 / 最大性能，默认自动。
- 可选最小化到托盘和当前用户开机启动。
- 冷启动耗时写入 `Logs\startup.log`。
- 模型加载与 PotPlayer 捕获可并行启动。

## 本阶段明确不做

- 翻译。
- 多语言专项优化。
- 说话人分离。
- 会议总结。
- 云端 LLM。
- 重型字幕编辑器。
- Mediova 源码合并。

## 下一实机验收断点

后台优先：

1. 覆盖 run `31945115694` 对应 EXE。
2. 使用用户此前的 `2:57 MP4 + SenseVoice Small INT8` 再次“转写选中”。
3. 预期不应再出现 `未能创建离线识别流`。若模型文件明显损坏，应在模型加载阶段直接报告文件体积异常；若模型正常，应开始产生真实转写段。
4. 同一文件再测试 Fun-ASR-Nano，确认 native bridge 对第二种离线模型同样可用。
5. 观察归一化后的波形是否明显展开，主要有效峰值应接近轨道 95% 高度。
6. 若仍失败，读取 `Logs\batch.log`，当前日志会保留模型加载/解码阶段、时间点和完整异常。

实时继续：

1. Zipformer Large + PotPlayer 连续小幅/大幅快进快退。
2. 连续换 2~3 个视频，确认无需重新点击开始即可自动恢复字幕。
3. 真正重建后不应拼接跳转前旧半句话。

其余统一验收：不同实时/后台模型效果、MKV/WebM FFmpeg fallback、TXT/JSON、托盘和启动速度。
