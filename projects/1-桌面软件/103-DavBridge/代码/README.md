# DavBridge 源码入口

本目录是 P103 DavBridge 的完整可恢复源码入口。任何新对话、开发机或 CI 都应从这里恢复工程，不依赖聊天记录或本地临时文件。

## 目录结构

```text
代码/
├── DavBridge.sln
├── DavBridge.Core/
│   ├── DavBridge.Core.csproj
│   ├── Models.cs
│   ├── WebDav.cs
│   ├── StateAndQuota.cs
│   └── MigrationEngine.cs
├── DavBridge/
│   ├── DavBridge.csproj
│   ├── Program.cs
│   ├── AppInfrastructure.cs
│   ├── MainForm.cs
│   ├── SettingsDialog.cs
│   └── CalibrationDialog.cs
└── DavBridge.Smoke/
    ├── DavBridge.Smoke.csproj
    └── Program.cs
```

## 职责边界

### DavBridge.Core

只放与 UI 无关的迁移核心，包括：

- WebDAV 读写和准确资源确认；
- InfiniCLOUD 只读客户端；
- 坚果云目标写入客户端；
- Zotero `.zip + .prop` 分组；
- 强校验状态机；
- GoodSync 既有文件安全接管；
- 上传与下载配额；
- 状态持久化模型；
- 限速和请求节流。

核心层必须能够在没有 WinForms 的环境中独立编译和接受自动测试。

### DavBridge

Windows x64 WinForms 托盘程序，包括：

- 程序入口；
- DPAPI 凭据保存；
- 配置和状态文件路径；
- Windows 登录自启动；
- 主窗口和托盘；
- 连接诊断；
- 迁移就绪扫描入口；
- 流量校准；
- 设置界面。

UI 不得重新实现迁移判定逻辑，迁移事实以 `DavBridge.Core` 为准。

### DavBridge.Smoke

核心故障模型和回归入口。至少覆盖：

- 正常强校验；
- PUT 假成功；
- 源端传输期间变化；
- GoodSync 既有目标一致接管；
- 既有目标冲突；
- 上传和下载额度保护；
- 崩溃恢复；
- 部分 Group 恢复；
- 单文件上限；
- 6000 个 Zotero Group / 12000 个对象基线。

## 本地恢复和构建

在本目录执行：

```powershell
dotnet restore .\DavBridge.sln
dotnet build .\DavBridge.sln -c Release
```

运行核心 smoke：

```powershell
dotnet run --project .\DavBridge.Smoke\DavBridge.Smoke.csproj -c Release
```

生成与 CI 一致的 Windows x64 单 EXE：

```powershell
dotnet publish .\DavBridge\DavBridge.csproj `
  -c Release `
  -r win-x64 `
  --self-contained false `
  -p:PublishSingleFile=true `
  -p:DebugType=embedded
```

正式候选仍以 `.github/workflows/p103-davbridge-ci.yml` 的 Windows Artifact 为准，不以开发机手工构建代替 CI 证据。

## 数据与凭据边界

源码目录不得出现：

- `config.json`；
- `state.json` 或 `state.json.bak`；
- `secrets.dat`；
- 真实 WebDAV 密码、Cookie、Token；
- 真实 Zotero 文件清单；
- 用户日志；
- 本机 `%APPDATA%`、`%LOCALAPPDATA%` 私人数据副本。

正式用户 Data 只能位于 `%APPDATA%\DavBridge` 和 `%LOCALAPPDATA%\DavBridge`。

## Git 分支事实

当前开发期源码事实源是远端 `p103-exp`。`p103-stable` 只接受满足当前候选提升条件的版本，`main` 只保存已经完成正式准入的版本。

在 P103 尚未首次进入 `main` 前，新对话恢复源码时必须显式读取 `p103-exp`，不得因为默认分支是 `main` 而误判项目不存在。
