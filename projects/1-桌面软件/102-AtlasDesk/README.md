# P102｜AtlasDesk

AtlasDesk 是面向个人科研与软件开发的 Windows 桌面工作台，统一管理工作区、Zotero、Dashboard、项目、Python 环境、终端、任务和本地工具。

## 当前入口

- 新对话固定接续入口：[HANDOFF.md](HANDOFF.md)；
- 正式版本、标签、Release 与验证证据：[阶段记录](阶段记录.md)；
- 当前开发目标与实时进度：[工作记录](工作记录.md)；
- 项目长期硬规则：[开发约束](开发约束.md)；
- 重大设计原因与历史取舍：[设计与演进](设计与演进.md)；
- 外部同类项目、可借鉴设计与拒绝边界：[同类项目与设计参考](同类项目与设计参考.md)；
- 桌面软件记录参考：[软件设计记录建议书](../软件设计记录建议书.md)。

新对话必须先读取 `HANDOFF.md`，再按其中流程读取 A｜`/GPT_RULES.md` → `/目录.md` → B｜`../开发约束.md` → C｜本项目 `开发约束.md`、README、阶段记录和工作记录，并核对 `main`、`p102-stable`、`p102-exp`、PR、CI、Artifact、标签与 Release 的真实状态。

仓库内源码、Git、PR、CI、Artifact、正式标签和 Release 是项目事实源，旧聊天记录只作为快速定位的补充。

## 转交给新对话

在新对话中复制下面整段即可。若能够取得上一轮交接记录，可继续粘贴在这段文字后面；没有上一轮记录也可以直接接续。

```text
请接续 AtlasDesk 项目。请先阅读并严格按照下面的 HANDOFF.md 恢复项目上下文：
https://github.com/FenLynn/gpt-pub/blob/main/projects/1-%E6%A1%8C%E9%9D%A2%E8%BD%AF%E4%BB%B6/102-AtlasDesk/HANDOFF.md

我可能会在本段文字后附上上一轮交接记录；如未附上，请直接从仓库恢复上下文。请先核对并汇报当前正式版本、当前稳定候选或开发版本、main/p102-stable/p102-exp 的真实关系、最近完成事项、未完成或待实机验证事项及准确断点。本轮先不要修改代码、文档、分支、PR、CI、标签或 Release。
```

## 工程入口

```text
代码/
├── personal-workbench-native/         # .NET 8 / WPF 主程序
├── personal-workbench-terminal-host/  # C++20 ConPTY 原生宿主
└── personal-workbench-smoke/          # 构建、边界与回归验证
```

活动 CI：`.github/workflows/p102-atlasdesk-ci.yml`

```powershell
dotnet restore projects/1-桌面软件/102-AtlasDesk/代码/personal-workbench-smoke/PersonalWorkbench.Smoke.csproj
dotnet run --project projects/1-桌面软件/102-AtlasDesk/代码/personal-workbench-smoke/PersonalWorkbench.Smoke.csproj -c Release --no-restore
```

## 分支与发布

```text
最新 main → p102-exp → 任务分支 → p102-stable → main → p102-vX.Y.Z 与 Release → 回流长期分支
```

- 日常开发：`p102-exp`；
- 稳定候选：`p102-stable`；
- 正式主线：`main`；
- 正式路径：`projects/1-桌面软件/102-AtlasDesk/`。

详细 Runtime/Data、安全、界面、测试和增量交付规则以 [开发约束](开发约束.md) 为准。
