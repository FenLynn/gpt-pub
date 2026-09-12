# P105｜LocalSub Application Contract

> 本文件定义 LocalSub 新一轮架构迁移中 Shell、Core 与未来 Web UI 的长期边界。
> 实现细节可以演进，但不得绕过本契约把重任务重新塞回 UI 层。

## 1. 当前冻结基线

本轮架构改造开始前：

```text
main
p105-stable
p105-exp
```

均指向：

```text
042329ede97b09cd375ebcf7c55d7245fc56b933
```

从该基线开始：

- `main` 保持正式主线。
- `p105-stable` 保持改造前可运行基线，不承载新架构开发。
- 新架构只在 `p105-exp` 推进。
- 新候选未通过自动门禁与必要实机验证前，不提升到 `p105-stable`。
- 不通过强推或重置长期分支回退。若 exp 实验失败，使用 revert 或后续修复提交收敛。
- 旧基线始终可由 `p105-stable` 或上述准确提交重新构建。

## 2. 最终三层结构

```text
Vue 3 + TypeScript
        │
        │ typed JSON bridge
        ▼
LocalSub.exe
C# lightweight Windows Shell
├─ main window / WebView2 host
├─ tray / lifecycle
├─ native dialogs
├─ PotPlayer process discovery and window tracking
├─ subtitle Overlay
├─ settings persistence
└─ Core supervisor
        │
        │ Windows Named Pipe
        ▼
LocalSub.Core.exe
├─ realtime audio capture
├─ PotPlayer Process Loopback
├─ realtime ASR
├─ offline ASR
├─ media analysis
├─ waveform extraction
├─ VAD
├─ model heavy work
└─ long-running compute
```

原则是：

```text
Web UI 只表达状态和意图
Shell 只拥有 Windows 原生能力和应用生命周期
Core 只拥有重计算与长任务
```

## 3. Shell 所有权

以下能力长期属于 `LocalSub.exe`：

- 主窗口和 WebView2 生命周期。
- 托盘、单实例和应用退出。
- Windows 文件选择器和需要原生权限的对话框。
- PotPlayer 进程发现、PID 获取、窗口位置和最小化状态。
- 字幕 Overlay 窗口、TopMost、NoActivate、点击穿透和窗口跟随。
- AppSettings 的持久化入口。
- Core 启动、重启、退出、generation 管理和故障可诊断性。
- Web UI 与 Core 之间的白名单桥接。

Shell 不得长期承担：

- ASR 模型推理。
- WASAPI 音频捕获。
- Process Loopback 音频流处理。
- 媒体解码和波形分析。
- 大模型下载后的解压、校验和大目录替换。
- 其他会持续占用 CPU、内存或原生资源的重任务。

## 4. Core 所有权

`LocalSub.Core.exe` 长期承担：

- 媒体解析和波形数据生成。
- 后台转写。
- 实时 Streaming Zipformer / Paraformer。
- SenseVoice、Fun-ASR-Nano 等实时或模拟流式识别。
- WASAPI 和 PotPlayer Process Loopback。
- VAD。
- sherpa / ONNX 等原生识别链。
- 模型下载、断点续传、解压、校验、目录替换和大目录删除。
- 可以阻塞、崩溃或耗时较长的计算任务。

某能力一旦迁入 Core：

- Shell 不得保留静默 fallback。
- Core 断开时当前任务明确失败。
- GUI 必须继续响应。
- 下一次任务允许 supervisor 拉起新 Core。

## 5. Web UI 权限

未来 Vue 主界面只能：

1. 接收 Shell 提供的 DTO。
2. 显示页面状态、进度、波形、字幕、模型和设置。
3. 发送固定白名单命令。
4. 接收白名单事件。

Vue 不得直接：

- 打开 Named Pipe。
- 调用 WASAPI 或 Process Loopback。
- 操作 sherpa、ONNX 或模型文件。
- 读取用户日志和内部状态文件。
- 直接访问任意本地文件路径。
- 操作 PotPlayer HWND。
- 自己保存敏感配置。
- 复制 C# 业务核心形成第二套逻辑。

## 6. UI 状态契约

主 UI 以 snapshot 为事实源，而不是从控件反推业务状态。

建议顶层状态：

```text
LocalSubSnapshot
├─ app
├─ core
├─ live
├─ batch
├─ models
├─ settings
└─ system
```

### app

至少包含：

- productVersion
- activePage
- busy
- lastError

### core

至少包含：

- state: stopped / starting / ready / busy / failed
- pid
- generation
- currentOperation
- lastError

### live

当前 Web UI snapshot 至少包含：

- state: idle / starting / running / stopping / failed
- sourceId
- source
- modelId
- modelName
- availableModels
- level
- status
- currentText
- previousText
- lastError
- canStart

Core realtime 的 `sessionId` 与 PotPlayer `processId` 由 Shell 应用层持有，不作为当前 Vue 页面必须管理的状态。只有未来出现明确 UI 需求时才扩展 snapshot，避免让 Web UI 直接承担 Core session 生命周期。


### batch

至少包含：

- queue
- selectedFile
- mediaInfo
- waveform
- transcript
- progress
- state
- lastError

### models

当前查看与选择阶段至少包含：

- catalog：模型名、用途、语言、体积、实时/准确/性价比评分、推荐标记、实时/后台能力、组件标记和安装状态
- catalogCount
- installedCount
- liveModelId / liveModelName
- batchModelId / batchModelName
- status
- operation.state: idle / running / failed
- operation.kind: download / delete / null
- operation.modelId / modelName
- operation.stage / percent / detail / isIndeterminate
- operation.lastError / canCancel

模型页的轻量扫描与默认选择留在 Shell 应用层。Phase 1B.2 起，下载、断点续传、解压、校验、修复和大目录删除统一通过 Core 长任务接口执行，Shell 不保留进程内 fallback。

### settings

只向 UI 提供允许编辑的设置 DTO，不暴露内部文件位置和不必要的实现细节。v0.1.6 已进入 snapshot 的主要设置包括音源、资源策略、托盘/开机/静默/自动实时、输入波形开关，以及字幕字号、位置、宽度、背景、颜色、透明度与停留时间等。

Vue 只能通过 `settings.update` 提交白名单字段。Shell 负责范围校验、AppSettings 持久化、HKCU 启动注册和 Overlay 更新。`settings.previewSubtitle` 只请求 Shell 显示当前字幕样式预览。

### system

v0.1.6 当前至少包含 `potPlayerDetected`、`autoStartPending` 和 `autoStartStatus`。PotPlayer PID、HWND、Core session ID 和注册表路径不暴露给 Vue。

## 7. Shell 到 Web UI 命令白名单

当前已经实现的命令：

```text
app.getSnapshot
app.navigate
settings.update
settings.previewSubtitle
live.start
live.stop
model.list
model.select
model.download
model.cancel
model.delete
```

`model.select` 只保存已安装且能力匹配的实时或后台默认模型。`model.download`、`model.delete` 通过 Shell 应用控制器进入 Core 长任务。`model.cancel` 只用于可安全中断的下载任务，不暴露 Core request ID；删除一旦进入目录脱离与递归清理阶段即完成收尾，不允许用户中途取消。

后续按页面迁移逐步加入：

```text
batch.pickFiles
batch.analyze
batch.transcribe
batch.cancel

model.openFolder

后续新增设置字段必须继续扩展现有 `settings.update` 白名单，不建立任意 key/value 配置通道。
```

实际实现必须继续使用显式白名单，不得使用任意方法名转发或反射式调用。Vue 只发送用户意图，realtime 的 session ID、PotPlayer PID、Core generation 与 Windows 句柄继续由 Shell 持有。

## 8. Core IPC 演进

当前 IPC v1 保留：

```text
ping
analyze
transcribe
model.download
model.delete
cancel
shutdown
```

下一阶段增加实时 session，而不是把实时任务建模成一个几小时才返回的普通请求。

建议方法：

```text
live.start
live.stop
```

`live.start` 成功后立即返回：

```json
{
  "sessionId": "...",
  "state": "running"
}
```

随后通过事件持续推送：

```text
live.status
live.level
live.partial
live.final
live.discontinuity
live.failed
```

`live.stop` 必须可以基于当前 session 明确停止实时链。

Core 需要显式维护：

```text
Idle
Starting
Running
Stopping
Failed
```

## 9. 实时事件节流

音量事件不得按音频 callback 原始频率穿过全部链路。

Core 内部可以高频处理，但对外 `live.level` 默认限制到约 10 Hz。

`live.partial`、`live.final`、错误和状态变化按实际事件即时发送。

目标是让：

```text
Core
→ Named Pipe
→ Shell
→ WebView2
→ Vue
```

保持低开销和可诊断。

## 10. PotPlayer 边界

Shell 负责：

- 查找 PotPlayer。
- 获取 PID。
- 获取窗口 bounds。
- 判断最小化。
- Overlay 跟随。

Core 负责：

- 按 PID 建立 Process Loopback。
- 处理断流和时间线跳转。
- 音频缓冲。
- ASR。

调用形态：

```text
Shell 找到 PID
→ Core live.start(processId)
→ Core 推送识别事件
→ Shell 更新 snapshot
→ Vue 显示状态
→ Overlay 显示字幕
```

不得让 Vue 直接参与 PotPlayer 进程控制。

## 11. 页面迁移顺序

不是一次性替换全部 WinForms。

固定采用：

1. WebView2 主 Shell、导航、设置、关于、Core 状态。
2. 实时字幕页。
3. 模型页。
4. 后台转写与 waveform 工作台。
5. 删除旧 WinForms 业务页。

每一页切换到 Web UI 后，都必须继续使用同一个 Application Contract，不在 Vue 中复制旧控件事件处理逻辑。

### 默认主界面与迁移期回退

自 v0.1.3 起，普通启动 `LocalSub.exe` 直接进入 WebView2/Vue 主界面。v0.1.6 起默认页面为主页。旧 WinForms 不再默认出现，只作为后台 Web 工作区尚未完成迁移期间的显式备用入口：

```text
LocalSub.exe --legacy-ui
```

也可使用 `LOCALSUB_LEGACY_UI=1`。该备用入口不改变三层所有权，不允许 WebShell 在 Core 故障时退回 WinForms 执行重任务。Phase 3 删除旧 WinForms 后同时删除该备用入口。

v0.1.6 新增 `--startup-silent` 作为 Windows 自动启动时的显式生命周期参数。它只让主窗口进入托盘，不改变普通双击行为。若同时启用 AutoStartLive，Shell 根据保存的音源和模型启动实时字幕；PotPlayer 音源缺少目标进程时保持等待，不允许回退 All Audio。

## 12. 新阶段顺序

调整后的迁移阶段：

### Phase 1B.0

冻结本 Application Contract，抽离 snapshot、command 和 session 边界，不改变现有用户功能。

### Phase 1B.1

把 `LiveAsrPipeline` 及实时音频捕获、Process Loopback、实时 ASR 迁入 Core。

### Phase 2A

建立 WebView2 + Vue 3 + TypeScript 主 Shell。可以在 1B 后续迁移期间并行推进，但只能依赖已经冻结的 DTO 和白名单命令。

### Phase 1B.2

把模型下载、解压、校验、大目录替换等重任务迁入 Core。

### Phase 2B

按“实时、模型、后台、设置”逐页切换 Web UI。

### Phase 3

删除旧 WinForms 业务页面。Shell 只保留 Windows 原生宿主职责。

## 13. 回退规则

本轮改造前可运行基线固定为：

```text
042329ede97b09cd375ebcf7c55d7245fc56b933
```

并由 `p105-stable` 与 `main` 保持。

开发期间：

- stable 不跟随 exp 的实验提交。
- 每个可独立验证的小阶段都在 exp 形成清晰提交。
- 问题修复优先追加提交或 revert，不重写长期分支历史。
- 需要旧程序时直接从 stable 或准确 SHA 重建。
- 只有新候选达到稳定准入标准后，才允许 `p105-exp → p105-stable`。
- stable 更新前必须保留当前基线可追溯性，并完成新候选 exact-head CI。

## 14. CI 演进

进入 Web UI 后，P105 长期 CI 在现有 Shell/Core 门禁基础上增加：

- Node 依赖安装。
- TypeScript typecheck。
- Vite production build。
- bundle 完整性检查。
- 多尺寸浏览器视觉预览。
- WebView2 host self-test。
- Web UI bridge 白名单检查。
- Core logic 不进入 JavaScript 的边界检查。
- 继续保留 Shell/Core publish、Core fault injection、Process Loopback、native ASR 和包边界验证。

浏览器截图只能发现明显视觉错误，不能替代用户真实 Windows UI 验收。
