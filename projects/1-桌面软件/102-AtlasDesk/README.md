# P202｜AtlasDesk

AtlasDesk 是面向个人科研与软件开发的 Windows 桌面工作台，统一管理工作区、资料库、项目、Python 环境、终端、任务和工具。

## 固定接入顺序

1. 阅读仓库根目录 `GPT_RULES.md`；
2. 阅读根目录 `目录.md`；
3. 阅读 `projects/2-桌面软件/README.md`；
4. 阅读本文件；
5. 阅读 [`阶段记录.md`](阶段记录.md)；
6. 涉及迁移或历史核验时阅读 [`迁移校验清单.md`](迁移校验清单.md)。

## 当前事实源

- 当前项目编号：`P202`；
- 当前产品名：`AtlasDesk`；
- 当前基线：`v0.7.3`；
- 当前源码目录：[`代码/`](代码/)；
- 原仓库：`FenLynn/agent-foundry`；
- 原固定提交：`1f9f043dcbc31bf39397757f0eb07a137b586cf1`；
- 后续唯一维护仓库：`FenLynn/gpt-hub`。

旧提交、PR、分支和原始报告中的 `Personal Workbench` 名称不改写。v0.7.3 已完全在 GPT-Hub 中开发、验证和打包，证明新仓库能够无损接续。为保证旧配置和用户数据兼容，内部 Assembly、namespace、AppData 和配置标识暂时保留历史名称。

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

目录名暂时保留历史名称，避免把兼容迁移与功能开发混在一起。后续如需重命名工程目录，必须单独立项并验证构建、配置、诊断和升级路径。

## 长期产品边界

- 本地优先、轻量、按需读取；
- Zotero 只读 SQLite，不修改用户文献库；
- 项目扫描和命令中心检索均有界、可取消且不执行项目代码；
- 终端生产路径与测试路径必须共同使用已验证的 Windows ConPTY 后端；
- 不捆绑 .NET、WebView2、Node、Python、Conda、uv 或 PDF 运行时；
- 不在 v0.7.x 引入 AI 编排平台、插件市场、任意脚本自动化或全盘后台索引；
- 旧配置、用户数据、工作区、终端和恢复格式必须向后兼容。

## 构建与验证

长期 CI：`.github/workflows/p202-atlasdesk-ci.yml`

主要本地命令：

```powershell
dotnet restore projects/2-桌面软件/202-AtlasDesk/代码/personal-workbench-smoke/PersonalWorkbench.Smoke.csproj
dotnet run --project projects/2-桌面软件/202-AtlasDesk/代码/personal-workbench-smoke/PersonalWorkbench.Smoke.csproj -c Release --no-restore
```

正式准入还必须在 Windows Runner 上完成 WPF/XAML、STA runtime verifier、原生终端宿主、真实 CMD/ConPTY、轻量发布、体积检查、打包和 SHA-256。

## 分支与版本

- 正常分支：`p202-简短任务名`；
- 每个版本只处理一个清晰主题；
- PR 默认先 Draft，验证通过后合并；
- 合并后删除工作分支；
- 正式版本使用 `p202-vX.Y.Z` 标签，不保留常驻 release 分支。

当前状态、验证结果和下一任务见 [`阶段记录.md`](阶段记录.md)。
