# P102｜AtlasDesk

AtlasDesk 是面向个人科研与软件开发的 Windows 桌面工作台，统一管理工作区、Zotero 资料库、Dashboard、项目、Python 环境、终端、任务和工具。

## 当前版本

- 当前架构版本：`v0.8.0`；
- 唯一维护仓库：`FenLynn/gpt-pub`；
- 正式路径：`projects/1-桌面软件/102-AtlasDesk/`；
- 日常分支：`p102-exp`；
- 稳定分支：`p102-stable`；
- 正式主线：`main`。

## 冻结架构

AtlasDesk 使用“透明文件夹 Runtime + 独立私人 Data”架构。

```text
用户创建的 AtlasDesk 文件夹（Runtime）
├── AtlasDesk.exe
├── AtlasDesk.TerminalHost.exe
├── Assets/
├── runtime-manifest.json
└── 其他公开运行依赖
```

Runtime 可以完整公开、复制、覆盖或删除后重建。程序运行期间不得向 Runtime 写入用户配置、日志、Cookie、缓存、Token 或私人路径。

```text
%APPDATA%\AtlasDesk                # 轻量、重要、私人、可备份
├── settings.json
├── task-history.json
├── security.json
├── vault.bin
└── backups/

%LOCALAPPDATA%\AtlasDesk           # 本机私人状态，可重新生成
├── WebView2/
├── Terminal/
├── Logs/
├── State/
├── Cache/
└── Crash/
```

正式程序代码不执行旧目录迁移。历史数据迁移由一次性外部 PowerShell 脚本完成，脚本不进入仓库和 Runtime。

## 安全边界

- 普通配置继续使用可读 JSON；
- 敏感密码、Token、密钥和私密备注进入 `vault.bin`；
- 主密码至少 20 位，使用 Argon2id 派生根密钥；
- 保险库内容使用 AES-256-GCM 加密；
- TOTP 与 Google Authenticator 兼容，二维码完全本地生成；
- 可选四位数字只用于用户主动触发的临时界面锁，不参与加密，可随时关闭；
- Runtime、公开仓库、Release 和增量更新包不得包含任何 Data。

## 当前能力

- 本地工作区、轻量编辑与 Markdown 预览；
- Zotero 只读资料库；
- 项目中心、Python 环境和任务中心；
- xterm.js 与 Windows 原生 ConPTY 终端；
- 文件完整性、备份恢复和脱敏诊断；
- AtlasDesk Command Center 全局检索；
- 本地加密保险库、TOTP 和可选临时四位锁。

## 更新方式

AtlasDesk 采用增量覆盖更新：

- 只修改主程序时，仅交付 `AtlasDesk.exe`；
- 多个运行文件变化时，按 AtlasDesk Runtime 根目录保留原相对路径打包；
- 更新包永远不包含 `%APPDATA%` 或 `%LOCALAPPDATA%` 下的 Data；
- `runtime-manifest.json` 记录 Runtime 文件、大小和 SHA-256；
- v0.8.0 因部署形态改变，首次提供完整 Runtime 文件夹。

## 工程结构

```text
代码/
├── personal-workbench-native/         # .NET 8 / WPF 直接主程序
├── personal-workbench-terminal-host/  # C++20 原生 Windows ConPTY 宿主
└── personal-workbench-smoke/          # 运行时、边界与回归验证
```

内部工程目录和 namespace 暂时保留历史名称，不影响用户可见产品名、Runtime 目录和 Data 目录。

## 构建与验证

活动 CI：`.github/workflows/p102-atlasdesk-ci.yml`

```powershell
dotnet restore projects/1-桌面软件/102-AtlasDesk/代码/personal-workbench-smoke/PersonalWorkbench.Smoke.csproj
dotnet run --project projects/1-桌面软件/102-AtlasDesk/代码/personal-workbench-smoke/PersonalWorkbench.Smoke.csproj -c Release --no-restore
```

正式准入必须在 Windows Runner 上完成 WPF/XAML、Argon2id/AES-GCM/TOTP 编译、C++20 终端宿主、真实 CMD/ConPTY、Runtime 打包、私人数据泄漏扫描和 SHA-256 复核。
