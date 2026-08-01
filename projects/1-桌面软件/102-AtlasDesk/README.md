# P102｜AtlasDesk

AtlasDesk 是面向个人科研与软件开发的 Windows 桌面工作台，统一管理工作区、资料库、项目、Python 环境、终端、任务和工具。

## 当前状态

- 当前版本：`v0.7.4`；
- 唯一维护仓库：`FenLynn/gpt-pub`；
- 正式路径：`projects/1-桌面软件/102-AtlasDesk/`；
- 日常分支：`p102-exp`；
- 稳定分支：`p102-stable`；
- 正式主线：`main`；
- 活动 CI：`.github/workflows/p102-atlasdesk-ci.yml`。

## 产品身份与本地路径

对用户只使用 `AtlasDesk` 称谓：

```text
配置与日志：%APPDATA%\AtlasDesk
程序释放目录：%LOCALAPPDATA%\AtlasDesk\App\<版本>
释放文件：AtlasDesk.App.exe
交付文件：AtlasDesk.exe
```

v0.7.4 首次启动会在 `%APPDATA%\AtlasDesk` 尚不存在时，将旧 `%APPDATA%\PersonalWorkbench` 自动迁移过去。若移动失败则复制，旧目录保留；若新目录已存在则绝不覆盖。

工程目录、namespace、Assembly、旧备份 schema 和部分无空格内部标识暂时保留历史名称，只作为兼容实现，不再作为产品称谓显示给用户。

## 当前能力

- 本地工作区、轻量编辑与 Markdown 预览；
- Zotero 只读资料库；
- 项目中心、Python 环境和任务中心；
- xterm.js 与 Windows 原生 ConPTY 终端；
- 文件完整性、备份恢复和脱敏诊断；
- AtlasDesk Command Center 全局检索。

## 构建与验证

```powershell
dotnet restore projects/1-桌面软件/102-AtlasDesk/代码/personal-workbench-smoke/PersonalWorkbench.Smoke.csproj
dotnet run --project projects/1-桌面软件/102-AtlasDesk/代码/personal-workbench-smoke/PersonalWorkbench.Smoke.csproj -c Release --no-restore
```

正式准入必须通过 Windows C++20 终端宿主、.NET 8/WPF/XAML、完整 smoke、真实 CMD/ConPTY、Go 启动器、轻量发布、ZIP/EXE 一致性和 SHA-256。

详细版本结果见 [`阶段记录.md`](阶段记录.md)；历史迁移证据见 [`迁移校验清单.md`](迁移校验清单.md)。
