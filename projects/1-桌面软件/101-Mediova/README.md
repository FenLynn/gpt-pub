# Mediova

Mediova 是面向 Windows 10/11 x64 的本地媒体处理与创作工作站，统一处理视频与图片的批量导入、方向修正、转码、压缩、裁剪、兼容判断、结果校验和任务恢复。

## 当前入口

- 新对话固定接续入口：[HANDOFF.md](HANDOFF.md)
- 当前正式基线：[阶段记录](阶段记录.md)（Mediova v4.5.0，标签与 Release `p101-v4.5.0`）
- 当前工作与真实环境观察项：[工作记录](工作记录.md)
- 项目长期规则：[开发约束](开发约束.md)
- 设计与演进：[软件开发总结](软件开发总结.md)
- 当前正式版本说明：[Mediova_v4.5.0_版本说明.md](Mediova_v4.5.0_版本说明.md)
- 连续开发里程碑：[v4.2.3](Mediova_v4.2.3_版本说明.md)｜[v4.3.0](Mediova_v4.3.0_版本说明.md)｜[v4.4.0](Mediova_v4.4.0_版本说明.md)
- 历史正式版本：[v4.2.2](Mediova_v4.2.2_版本说明.md)｜[v4.2.1](Mediova_v4.2.1_版本说明.md)｜[v4.2.0](Mediova_v4.2.0_版本说明.md)｜[v4.1.1](Mediova_v4.1.1_版本说明.md)
- v4.0.0 公开迁移证据：[迁移校验清单](迁移校验清单.md)

新对话必须先读取 `HANDOFF.md`，再按其中流程读取 A｜`/GPT_RULES.md` → B｜`../开发约束.md` → C｜本项目 `开发约束.md` 及当前记录。用户提供的上一轮记录用于快速定位，实际状态仍须由项目文档和 GitHub 核验。

## 转交给新对话

在新对话中复制下面整段即可。若能够取得上一轮交接记录，可继续粘贴在这段文字后面；没有上一轮记录也可以直接接续。

```text
请接续 Mediova 项目。请先阅读并严格按照下面的 HANDOFF.md 恢复项目上下文：
https://github.com/FenLynn/gpt-pub/blob/main/projects/1-%E6%A1%8C%E9%9D%A2%E8%BD%AF%E4%BB%B6/101-Mediova/HANDOFF.md

我可能会在本段文字后附上上一轮交接记录；如未附上，请直接从仓库恢复上下文。请先核对并汇报当前正式版本、开发阶段、最近完成事项、未完成或待实机验证事项及准确断点。本轮先不要修改代码、文档、分支、PR、标签或 Release。
```

## 工程入口

- 正式路径：`projects/1-桌面软件/101-Mediova/`
- 源码：`代码/`
- 活动 CI：`.github/workflows/p101-mediova-ci.yml`
- 日常分支：`p101-exp`
- 稳定分支：`p101-stable`

v4.5.0 内部完整 Runtime 验证构建入口：

```powershell
cd projects/1-桌面软件/101-Mediova/代码
./build_v4.5.0.ps1 -FFmpegBin "C:\path\to\ffmpeg\bin"
```

用户默认下载 Release 中的 [`Mediova-v4.5.0-Light.zip`](https://github.com/FenLynn/gpt-pub/releases/download/p101-v4.5.0/Mediova-v4.5.0-Light.zip)。轻量包不包含 FFmpeg/FFprobe；覆盖更新时保留原 `Components\FFmpeg\bin`，首次使用时可在软件中选择已有 FFmpeg 路径或自行补入该目录。

## 当前正式能力

Mediova 保留一个直接启动的 `Mediova.exe`，公开运行依赖位于透明 Runtime，配置、历史、会话、缓存和日志位于独立 Data。

- v4.2.0–v4.2.2 建立视频/图片双参数体系、入队冻结、动态追加、单媒体活动队列、独立搁置编辑、真实列表条形和双工作区可读性。
- v4.2.3 将底部进度、状态与三个主要按钮统一到同一 footer 几何模型，修复视频、图片及禁用状态的错位和残影。
- v4.3.0 完善时间与画面裁剪，加入比例预设、居中适配、比例锁定、键盘微调和批量应用。
- v4.4.0 将画面裁剪扩展到图片，并为 HEIC、HEIF、AVIF 增加有界 FFmpeg 解码预检和明确失败提示。
- v4.5.0 引入版本化会话包络、原子保存与 `.bak` 回退、冻结快照恢复、文件级 0% 重启和 2500 项恢复压力测试。

完整边界、设计原因和验证证据分别以 `开发约束.md`、`软件开发总结.md`、`阶段记录.md` 与 `工作记录.md` 为准。

## 分支与发布

```text
最新 main
→ p101-exp
→ PR：p101-exp → p101-stable
→ 完整准入与 UI 截图复核
→ PR：p101-stable → main
→ 标签与 Release
→ main 回流 p101-stable / p101-exp
```

正式标签和 Release 只能从 `main` 建立。版本专用实施、诊断、触发和发布工作流完成后必须从主线删除。P101 不得修改 AtlasDesk 的产品、CI、分支或发布记录。

## 版权

Copyright © 2026 FenLynn. All rights reserved.

项目源码未附带开源许可证。完整 Runtime 中的第三方组件按其自身许可证单独披露。
