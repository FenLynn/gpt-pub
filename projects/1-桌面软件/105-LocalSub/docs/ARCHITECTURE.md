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
- 当前业务 UI：WinForms，暂时作为验证壳
- Phase 2A 主 UI：WebView2 + Vue 3 + TypeScript，开始建立
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

基础方法：`ping`、`analyze`、`transcribe`、`cancel`、`shutdown`。

realtime 第一版增加：

```text
live.start
live.stop

live.status
live.level
live.partial
live.final
live.discontinuity
live.failed
```

`live.start` 成功后返回 session ID，长期事件不依赖原 start request 保持 pending。`live.level` 对外默认约 10 Hz。当前版本 realtime session 存在时明确拒绝其他重任务并发，避免原生资源隐式竞争。

## 迁移阶段

迁移遵守 [Application Contract](APP_CONTRACT.md)，不再等待 Phase 1B 全部完成后才开始 Web UI。

### Phase 1A：后台进程隔离

状态：**自动化基线已建立，用户特定高负载 GUI 响应性仍待实机验证。**

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
- PotPlayer 进程发现与窗口跟随
- Overlay

Shell 工程对后台媒体分析、后台转写和已经迁移的 realtime 重实现采用编译期排除，只保留 Proxy，禁止 Core 故障时自动进程内 fallback。

### Phase 1B.0：Application Contract

状态：**第一版已完成。**

先固定：

- Shell / Core / Web UI 所有权
- Snapshot DTO
- Web UI command whitelist
- Core event contract
- realtime session 状态机
- 回退基线

本阶段不改变用户功能。

### Phase 1B.1：实时链迁入 Core

状态：**第一版自动化闭环已完成，真实 PotPlayer + 已安装模型仍待用户实机验证。**

已迁入 Core：

- Streaming Zipformer / Paraformer
- SenseVoice / Fun-ASR-Nano 实时链
- All Audio / WASAPI
- PotPlayer Process Loopback
- PotPlayer 音频恢复
- audio queue
- realtime model load
- realtime decode loop

Shell 只保留 PotPlayer 进程发现、PID、窗口位置、最小化状态和 Overlay 跟随。

最后完整验证代码 head：`944cc4674b3fecefae5ef88c1c4bc88f30918013`，P105 Windows CI run `34581474053` success。

### Phase 2A：Web Shell

状态：**当前开始实施。**

建立 WebView2 + Vue 3 + TypeScript 主 Shell，先完成：

- 左侧导航
- Core 状态
- 设置
- 关于
- 实时页面骨架

Phase 2A 可以与 1B 后续交错推进，但只能消费已经冻结的 DTO 与白名单命令。

### Phase 1B.2：模型重任务迁入 Core

迁移：

- 模型下载
- 断点续传
- 解压
- 校验
- 大目录替换
- 重型删除

### Phase 2B：逐页切换

推荐顺序：

1. 实时字幕
2. 模型
3. 后台转写与 waveform
4. 设置细节

每一页切换后继续复用同一个 Application Contract。

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