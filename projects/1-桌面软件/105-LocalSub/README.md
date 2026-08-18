# P105｜LocalSub

LocalSub 是 Windows 本地实时字幕与后台媒体转写工具，优先服务 PotPlayer，也支持捕获 Windows 输出音频。核心 ASR 本地运行，不依赖云端 API。

## 项目身份

- GPT-Pub 正式编号：`P105`
- 正式路径：`projects/1-桌面软件/105-LocalSub/`
- 日常开发：`p105-exp`
- 稳定候选：`p105-stable`
- 正式主线：`main`
- 固定流转：`main → p105-exp → p105-stable → main`
- 旧 `p103-localsub-*` 仅属于编号错误的迁移历史，不再作为活动开发入口。

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

已经迁入 Core 的后台媒体分析和后台转写禁止静默回退到 GUI 进程。Core 异常时当前后台任务可以失败，但 `LocalSub.exe` 应继续存活，下一次后台任务按需重新启动 Core。

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

- Phase 1A：代码与 Windows CI 已完成第一版，P105 正式准入后继续做用户实机响应性验收。
- Phase 1B：计划将实时 Zipformer、SenseVoice、WASAPI、PotPlayer Process Loopback 和模型重任务逐步迁入 Core。
- Phase 2：Core API 稳定后再引入 WebView2 + Vue 3 + TypeScript 主界面，不进行一次性全量重写。

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
9. `p105-exp / p105-stable / main`、PR 与当前 head CI

跨对话恢复使用 [`HANDOFF.md`](HANDOFF.md)。
