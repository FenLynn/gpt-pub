# P102｜AtlasDesk

AtlasDesk 是面向个人科研与软件开发的 Windows 桌面工作台，统一管理工作区、资料库、项目、Python 环境、终端、任务和工具。

## 固定接入顺序

1. 阅读仓库根目录 `GPT_RULES.md`；
2. 阅读根目录 `目录.md`；
3. 阅读 `projects/1-桌面软件/README.md`；
4. 阅读本文件；
5. 阅读 [`阶段记录.md`](阶段记录.md)；
6. 涉及历史、迁移或发布核验时阅读 [`迁移校验清单.md`](迁移校验清单.md)。

## 当前事实源

- GPT-Pub 项目编号：`P102`；
- 外部历史编号：`P202`；
- 产品名：`AtlasDesk`；
- 当前正式版本：`v0.7.3`；
- 当前源码目录：[`代码/`](代码/)；
- 当前唯一维护仓库：`FenLynn/gpt-pub`；
- 当前正式路径：`projects/1-桌面软件/102-AtlasDesk/`；
- 外部历史来源：`FenLynn/gpt-hub`；
- 冻结源提交：`c48180a2ac74b6336220bce484c8051551d4e2fb`；
- 更早原仓库：`FenLynn/agent-foundry`；
- 原始 v0.7.2 固定提交：`1f9f043dcbc31bf39397757f0eb07a137b586cf1`。

旧提交和报告中的 `Personal Workbench`、`P202` 与旧路径不做历史改写。公开交付文件使用 `AtlasDesk.exe`，但内部 Assembly、namespace、AppData、配置、备份、终端和任务历史兼容标识继续保持 `PersonalWorkbench`，避免旧用户数据重置。

## 当前产品能力

- 本地工作区、轻量编辑和 Markdown 预览；
- Zotero 只读资料库；
- 项目中心与 Python 环境管理；
- xterm.js 与 Windows 原生 ConPTY 终端；
- 任务中心、文件完整性工具、备份恢复和脱敏诊断；
- `AtlasDesk Command Center`：通过 Ctrl+K 按需检索页面、项目、文件、任务、工具、文献和常用命令。

## 工程结构

```text
代码/
├── personal-workbench-native/         # .NET 8 / WPF 主程序
├── personal-workbench-launcher/       # Go 单文件启动器
├── personal-workbench-terminal-host/  # C++20 原生 Windows ConPTY 宿主
└── personal-workbench-smoke/          # 运行时与回归验证
```

工程目录暂时保留历史名称。全面改名、配置迁移、架构重写或用户数据路径调整必须单独立项，不得与普通功能版本混合。

## 长期产品边界

- 本地优先、轻量、按需读取；
- Zotero 只读 SQLite，不修改用户文献库；
- 项目扫描和命令中心检索均有界、可取消且不执行项目代码；
- 终端生产路径与测试路径共同使用已验证的 Windows ConPTY 后端；
- 不捆绑 .NET、WebView2、Node、Python、Conda、uv 或 PDF 运行时；
- 不在 v0.7.x 引入 AI 编排平台、插件市场、任意脚本自动化或全盘后台索引；
- 旧配置、用户数据、工作区、终端和恢复格式必须向后兼容。

## 构建与验证

活动 CI：`.github/workflows/p102-atlasdesk-ci.yml`

主要本地命令：

```powershell
dotnet restore projects/1-桌面软件/102-AtlasDesk/代码/personal-workbench-smoke/PersonalWorkbench.Smoke.csproj
dotnet run --project projects/1-桌面软件/102-AtlasDesk/代码/personal-workbench-smoke/PersonalWorkbench.Smoke.csproj -c Release --no-restore
```

正式准入必须在 Windows Runner 上完成 C++20 终端宿主、.NET 8/WPF/XAML、完整 smoke、真实 CMD/ConPTY、framework-dependent 发布、Go 启动器、轻量边界、打包和 SHA-256 复核。

## 长期分支与版本

- 日常开发：`p102-exp`；
- 稳定候选：`p102-stable`；
- 正式主线：`main`；
- 正式标签：`p102-vX.Y.Z`；
- 日常流程：`p102-exp → p102-stable → main`；
- `stable` 和 `main` 不做日常开发；
- 首次公开迁移完成后，`p102-stable` 与 `p102-exp` 必须从同一个公共 `main` 提交建立。

仓库公开可见不等于自动授予额外使用许可；许可范围以仓库根目录实际存在的许可证文件为准。

当前状态、验证结果和下一任务见 [`阶段记录.md`](阶段记录.md)。
