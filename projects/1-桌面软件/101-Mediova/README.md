# Mediova

Mediova 是面向 Windows 10/11 x64 的本地媒体处理与创作工作站，统一处理视频与图片的批量导入、方向修正、转码、压缩、裁剪、兼容判断、结果校验和任务恢复。

## 当前入口

- 新对话固定接续入口：[HANDOFF.md](HANDOFF.md)
- 当前正式基线：[阶段记录](阶段记录.md)（Mediova v4.5.0，标签与 Release `p101-v4.5.0`）
- 当前实机反馈修复规格：[Mediova v4.5.2 实机反馈修复规格](Mediova_v4.5.2_实机反馈修复规格.md)
- v4.5.2 五轮实施与验证：[Mediova v4.5.2 工作记录](Mediova_v4.5.2_工作记录.md)
- v4.5.1 Windows 原生验证与用户试用结论：[Mediova v4.5.1 验证说明](Mediova_v4.5.1_验证说明.md)
- v4.5.0–v4.5.1 既有工作证据：[工作记录](工作记录.md)
- 项目长期规则：[开发约束](开发约束.md)
- 设计与演进：[软件开发总结](软件开发总结.md)
- 当前正式版本说明：[Mediova_v4.5.0_版本说明.md](Mediova_v4.5.0_版本说明.md)

新对话必须先读取 `HANDOFF.md`，再按其中流程读取 A｜`/GPT_RULES.md` → B｜`../开发约束.md` → C｜本项目 `开发约束.md` 以及当前记录。旧聊天记录只作为补充；实际状态仍须由项目文档和 GitHub 核验。

## 转交给新对话

在新对话中复制下面整段即可。若能够取得上一轮交接记录，可继续粘贴在这段文字后面；没有上一轮记录也可以直接接续。

```text
请接续 Mediova 项目。请先阅读并严格按照下面的 HANDOFF.md 恢复项目上下文：
https://github.com/FenLynn/gpt-pub/blob/main/projects/1-%E6%A1%8C%E9%9D%A2%E8%BD%AF%E4%BB%B6/101-Mediova/HANDOFF.md

我可能会在本段文字后附上上一轮交接记录；如未附上，请直接从仓库恢复上下文。请先核对并汇报当前正式版本、开发阶段、最近完成事项、未完成或待实机验证事项及准确断点。本轮先不要修改代码、文档、分支、PR、标签或 Release。
```

## 当前开发状态

- 正式版本仍为 v4.5.0；正式标签和 Release 未改变。
- v4.5.1 是 Windows 原生持久化、权限、磁盘写满、便携模式和 Runtime 门禁验证产物，不创建正式 Release。
- v4.5.2 五轮用户反馈修复已经完成并通过 PR #341 合入 `p101-stable`；用户实机验证后再决定是否建立正式标签和 Release。
- 第四轮 PR #332 合并提交：`8eadd2ff96d5211db19d005a5093036e766e2428`。
- 第五轮 PR #341 合并提交：`bfaa0d0839ea447beec6e49b7bfecf7e9666f4b2`。
- `p101-stable` 已核对与该合并提交完全一致。
- 第五轮冻结产品候选：`3ba4b43bc94ff38ab02aae910ff698e5ecbd7881`。
- 最终产品 CI：`P101 Mediova CI #388`，run `30883792882`，范围、Linux、Windows 原生链全部通过。
- 最终文档头 CI：`P101 Mediova CI #390`，run `30884258441`，全部通过。

本轮不修改 `p101-v4.5.0` 标签与正式 Release。CI 生成的可执行文件属于 **v4.5.2 验证候选**，Windows 文件版本资源仍沿用正式基线 `4.5.0`。

## v4.5.2 五轮结果

1. **基础 UI 与暂停语义**：修正顶部工具栏首次显示、输出目录焦点、主按钮图形、有效运行计时、进度防闪和状态灯。
2. **列表、队列与缩略图**：完成显式列模型、旧列宽迁移、缩略图生命周期、多选退出队列与列表视觉收口。
3. **导入、输出与通知**：完善直接文件共同顶层、跨卷与 UNC 分组、安全输出前缀、导入摘要和轻量通知。
4. **裁剪编辑器**：完成双端时间轴、播放头、区间平移、裁剪框移动与八方向缩放，并固定“旋转 → 裁剪 → 缩放 → 编码”的处理顺序。
5. **真实 Windows 收口**：完成真实鼠标消息级交互、最大化/还原、通知关闭、四方向 FFmpeg 输出矩阵，并修复裁剪输入框程序回填触发同步通知、覆盖裁剪模型的问题。

## 第五轮最终验证

- 原生自检：117 项，失败 0；
- 视频与图片裁剪窗口：移动、东/西/南/北及四个角共九类真实鼠标交互全部通过；
- 时间轴：开始端、结束端、播放头和整体区间拖动全部通过；
- 窗口：正常、最大化、还原与交互后截图全部通过；
- 通知：显示、截图、手动关闭与窗口销毁通过；
- FFmpeg：`0° / 90° / 180° / 270°` 真实输出矩阵通过；
- Linux：全测、全量竞态、`go vet`、Windows 交叉测试与交叉构建通过；
- Windows：源码测试、竞态、Runtime 构建、Manifest、隐私边界、UI 截图和原生自检通过；
- 第五轮固定清单：`代码/V452_ROUND5_WINDOWS_CLOSEOUT_FILES_SHA256.txt`；
- 全量源码清单：140 项通过。

冻结候选产物摘要：

```text
Mediova.exe SHA-256: 33ac9c35991cf1a09c21d6af7198bcce805750a70031b3a3654229575f234e29
Runtime ZIP SHA-256: 05dad60cbb88cb6ce94d6152c143250b08c416142fa1c295ac1812d6d4864dbe
CI Artifact SHA-256: 2d8405ece8b1e2811538519fbc28ae717e55e7abc6ffee4573a772ed99dbcde5
```

## 工程入口

- 正式路径：`projects/1-桌面软件/101-Mediova/`
- 源码：`代码/`
- 活动 CI：`.github/workflows/p101-mediova-ci.yml`
- 日常长期分支：`p101-exp`
- 稳定分支：`p101-stable`

v4.5.0 内部完整 Runtime 验证构建入口：

```powershell
cd projects/1-桌面软件/101-Mediova/代码
./build_v4.5.0.ps1 -FFmpegBin "C:\path\to\ffmpeg\bin"
```

用户默认下载 Release 中的 [`Mediova-v4.5.0-Light.zip`](https://github.com/FenLynn/gpt-pub/releases/download/p101-v4.5.0/Mediova-v4.5.0-Light.zip)。轻量包不包含 FFmpeg/FFprobe；覆盖更新时保留原 `Components\FFmpeg\bin`，首次使用时可在软件中选择已有 FFmpeg 路径或自行补入该目录。

## 运行与数据边界

Mediova 保留一个直接启动的 `Mediova.exe`。公开运行依赖位于透明 Runtime；配置、历史、会话、缓存和日志位于独立 Data。Runtime 不得包含 `config.json`、`history.json`、`session.json`、日志、密钥或其他用户私有数据。

## 分支与发布

```text
干净开发分支（从 p101-stable 建立）
→ 分轮 P101 范围门禁与回归
→ PR：开发分支 → p101-stable
→ 完整 Windows 原生准入与 UI 截图复核
→ 用户实机验证
→ PR：p101-stable → main
→ 标签与 Release
→ main 回流长期分支
```

正式标签和 Release 只能从 `main` 建立。版本专用实施、诊断、触发和发布工作流完成后必须从主线删除。P101 不得修改 AtlasDesk 的产品、CI、分支或发布记录。

## 版权

Copyright © 2026 FenLynn. All rights reserved.

项目源码未附带开源许可证。完整 Runtime 中的第三方组件按其自身许可证单独披露。
