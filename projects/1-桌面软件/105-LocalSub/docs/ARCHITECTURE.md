# LocalSub Architecture

## 目标架构

LocalSub 采用“轻量 Windows Shell + Web UI + 独立 C# Core 工作进程”的渐进式架构。

最终目标：

```text
LocalSub.exe
C# lightweight Windows shell
├─ window / tray / lifecycle
├─ transparent subtitle overlay
├─ WebView2 host
└─ Named Pipe IPC
        │
        ├─ Vue 3 + TypeScript main UI
        │  ├─ realtime page
        │  ├─ batch workspace
        │  ├─ waveform canvas
        │  ├─ model manager UI
        │  └─ settings
        │
        └─ LocalSub.Core.exe
           C# isolated worker
           ├─ WASAPI / PotPlayer process loopback
           ├─ sherpa-onnx
           ├─ streaming/offline ASR
           ├─ VAD
           ├─ media decode
           ├─ FFmpeg integration
           ├─ model management
           └─ background transcription
```

## 技术栈选择

LocalSub 已积累并实机验证大量 Windows/C# 技术资产，包括 Process Loopback、raw COM、PotPlayer 恢复状态机、sherpa native C API、模型管理和 WebView2 overlay。当前不做全量 Rust/Tauri 重写，而是吸收 Web UI、消息传递、多进程隔离的设计思想，保留 C# 作为 Windows 与 ASR 核心实现语言。

当前实施栈：

- Shell / Core：C# .NET 8
- IPC：Windows Named Pipe，newline-delimited JSON
- 当前主 UI：WinForms
- 目标主 UI：WebView2 + Vue 3 + TypeScript
- 字幕 Overlay：透明 TopMost WebView2
- Rust：当前不引入

## 核心设计原则

### GUI 不执行已迁移重任务

主进程不得直接承担已经迁入 Core 的长时间媒体解码、后台离线模型加载与后台 ASR。重任务异常、崩溃或卡死不应让 Windows 把 `LocalSub.exe` 一起判定为未响应。

### 不静默退回旧架构

当某个功能已经迁入 `LocalSub.Core.exe` 后，Shell 不得在 Core 缺失或崩溃时偷偷退回进程内执行。应明确报告 Core 缺失/断开，并允许下一次操作重新启动 Core。

### Core 可重启

Shell 按需启动 Core。IPC 断开时当前请求失败，但 GUI 保持可用。下一次重任务应重新创建 Core。Shell 退出或 Pipe 断开后，Core 应自动退出，避免孤儿进程。

### 优先复用已经验证的 C# 资产

迁移阶段先建立进程边界，再逐步整理共享库。禁止为了“架构漂亮”重写已经验证的 Windows/ASR 底层逻辑。

### 绿色运行约束不变

- `LocalSub.exe` 与 `LocalSub.Core.exe` 位于同一根目录。
- 两者均为 .NET 8 framework-dependent、win-x64、single-file。
- 模型仍位于根目录 `ASR/`。
- sherpa native runtime 仍位于 `ASR/_runtime/`。
- FFmpeg 仍为可选外部组件，并优先复用 Mediova、手动路径或 PATH。
- 不把模型、ONNX Runtime、sherpa native runtime、FFmpeg 打进基础包。

## IPC v1

传输：Windows Named Pipe。编码：UTF-8，每行一个 JSON 消息。

请求：

```json
{"kind":"request","id":"...","method":"analyze","payload":{}}
```

事件：

```json
{"kind":"event","id":"...","event":"analysis-progress","payload":{}}
```

响应：

```json
{"kind":"response","id":"...","ok":true,"cancelled":false,"payload":{},"error":null}
```

v1 方法：`ping`、`analyze`、`transcribe`、`cancel`、`shutdown`。

同一个 Core v1 同时只执行一个重任务，Shell 对后台请求串行化。取消命令仍可在任务执行期间通过 Pipe 发送。

## 迁移阶段

### Phase 1A：后台进程隔离

状态：**第一版已实现并通过历史 Windows CI，P105 正式 CI 需重新验证，用户实机响应性待验证。**

已迁移到 Core：

- Media Foundation / FFmpeg 媒体解析
- 波形数据生成
- Silero VAD
- SenseVoice / Offline Zipformer / FireRedASR2 / Fun-ASR-Nano 后台识别
- 后台转写进度和结果

仍在 Shell：

- WinForms 主界面
- 波形绘制控件与结果展示
- 模型页 UI
- 实时 ASR
- PotPlayer 捕获
- Overlay

Shell 工程对后台媒体分析与后台转写完整实现采用编译期排除，只保留 Proxy，禁止 Core 故障时自动进程内 fallback。

### Phase 1B：实时与模型核心迁移

仅在 1A 实机边界确认后分项推进：

- Streaming Zipformer / Paraformer / SenseVoice 实时识别迁入 Core
- WASAPI 与 PotPlayer Process Loopback 迁入 Core
- 模型下载、解压、删除和版本状态逐步迁入 Core
- Shell 只接收 level、partial、final、status 等事件

目标是即使 native ASR 或音频链异常，主窗口仍保持响应。

### Phase 2：Vue 3 主界面

在 Core API 稳定后新增 WebView2 主 UI：Vue 3、TypeScript、Vite 与 Canvas/SVG waveform。先并存，不一次删除 WinForms，逐页迁移后台、模型、设置和实时页面。

### Phase 3：轻量 Shell 收口

删除旧 WinForms 业务页面，`LocalSub.exe` 最终只保留 WebView2 host、Windows 生命周期、托盘、Overlay、Core supervisor、IPC bridge 与崩溃恢复。

## CI 门禁

多进程版本至少验证：Shell/Core publish、双 EXE 包结构、Core Named Pipe 真连接与 `ping/shutdown`、Shell 真启动、后台工作区、Process Loopback、sherpa native runtime 真加载、native offline ASR 真解码，以及基础包不携带模型、FFmpeg、ONNX Runtime、sherpa native runtime。

活动 workflow 以 P105 项目级约束和 `.github/workflows/p105-localsub-ci.yml` 为准。

## 禁止事项

- 不把 Rust 引入当前 LocalSub 生产链。
- 不在 Core 边界尚未稳定时直接重写全部 UI。
- 不同时迁移后台、实时、模型管理和 UI 四条链。
- 不为了跨平台牺牲 PotPlayer / WASAPI 的 Windows 专用能力。
- 不让已经迁入 Core 的功能静默回退到 GUI 进程执行。