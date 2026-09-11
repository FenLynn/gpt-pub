# P105｜LocalSub

LocalSub 是 Windows 本地实时字幕与后台媒体转写工具，优先服务 PotPlayer，也支持捕获 Windows 输出音频。核心 ASR 本地运行，不依赖云端 API。

## 项目身份

- GPT-Pub 正式编号：`P105`
- 正式路径：`projects/1-桌面软件/105-LocalSub/`
- 日常开发：`p105-exp`
- 稳定候选：`p105-stable`
- 正式主线：`main`
- 固定流转：`main → p105-exp → p105-stable → main`
- P105 长期只保留 `p105-exp` 与 `p105-stable` 两条项目分支。
- 旧 `p103-localsub-*` 仅属于编号错误的历史，不再作为活动开发入口。

## 当前架构基线

Phase 1A 已建立双进程边界：

```text
LocalSub.exe
├─ WinForms 主界面
├─ 托盘
├─ 字幕 Overlay
├─ 实时 PotPlayer 链，暂时保留
└─ Named Pipe IPC
        ↓
LocalSub.Core.exe
├─ 媒体解析
├─ Media Foundation / FFmpeg
├─ 波形数据生成
├─ Silero VAD
└─ 后台离线 ASR
```

已经迁入 Core 的后台媒体分析和后台转写禁止静默回退到 GUI 进程。Core 异常时当前后台任务明确失败，`LocalSub.exe` 应继续存活，下一次后台任务按需重新启动 Core。

v0.1.1 在 Phase 1A 基础上增加连接代际隔离、Core 异常退出显式失效、取消超时回收、Shell 正常退出主动 shutdown，以及 Windows CI 中真实强杀 Core 后重连的故障注入门禁。

详细架构见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 运行与分发边界

- Windows x64。
- `.NET 8` framework-dependent single-file。
- `LocalSub.exe` 与 `LocalSub.Core.exe` 同目录。
- 模型默认在 EXE 同级 `ASR/`，不进入基础包。
- sherpa native runtime 位于 `ASR/_runtime/`，不进入基础包。
- FFmpeg 为外部可选组件，优先复用 Mediova、手动路径或系统 PATH。
- 不将 ONNX Runtime、sherpa native runtime、模型或 FFmpeg 打入基础绿色包。

构建与增量覆盖说明见 [`docs/BUILD.md`](docs/BUILD.md)。

## 当前状态

- v0.1.1 已正式发布，正式标签与 Release 保持不可变。
- 本轮新架构改造前，`main = p105-stable = p105-exp = 042329ede97b09cd375ebcf7c55d7245fc56b933`。
- `p105-stable` 与 `main` 从该点保持为改造前可运行基线，新架构只在 `p105-exp` 推进。
- Phase 1A 自动门禁已覆盖 Core IPC、Core 强杀与 generation 2 重连、Shell 启动、后台工作区、Process Loopback、sherpa runtime 与 native offline ASR。
- 用户特定媒体、模型和机器条件下的高负载 GUI 响应性仍属于实机待验证项。
- 当前进入 Phase 1B.0，先冻结 Shell / Core / Web UI Application Contract。
- 后续 Phase 1B.1 先将实时 ASR、WASAPI、PotPlayer Process Loopback 和实时解码队列迁入 Core。
- WebView2 + Vue 3 + TypeScript 主 UI 不再机械等待全部 Phase 1B 完成，而是在稳定契约下与后续 Core 迁移交错推进。
- 详细边界见 [`docs/APP_CONTRACT.md`](docs/APP_CONTRACT.md)。

当前状态证据见 [`阶段记录.md`](阶段记录.md) 和 [`工作记录.md`](工作记录.md)。

## 开发入口

接续开发前按以下顺序读取：

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. 本目录 [`开发约束.md`](开发约束.md)
5. 本文件
6. [`阶段记录.md`](阶段记录.md)
7. [`工作记录.md`](工作记录.md)
8. [`设计与演进.md`](设计与演进.md) 与相关 `docs/`
9. `p105-exp / p105-stable / main`、PR、当前 head CI、tag 与 Release

跨对话恢复使用 [`HANDOFF.md`](HANDOFF.md)。