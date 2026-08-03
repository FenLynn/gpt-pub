# P102｜AtlasDesk

AtlasDesk 是面向个人科研与软件开发的 Windows 桌面工作台，统一管理工作区、Zotero、Dashboard、项目、Python 环境、终端、任务和本地工具。

## 当前入口

- 正式版本、标签、Release 与验证证据：[阶段记录](阶段记录.md)；
- 当前开发目标与实时进度：[工作记录](工作记录.md)；
- 项目长期硬规则：[开发约束](开发约束.md)；
- 重大设计原因与历史取舍：[设计与演进](设计与演进.md)；
- 桌面软件记录参考：[软件设计记录建议书](../软件设计记录建议书.md)。

仓库内文件、正式标签和 Release 是项目事实源，旧聊天记录只作为补充。

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
