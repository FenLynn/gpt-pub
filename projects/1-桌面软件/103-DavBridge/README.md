# P103｜DavBridge

DavBridge 是面向 Windows 的可靠、低速、可恢复、强校验的**单向数据迁移、备份和镜像任务管理器**。

它不定位为双向同步软件。当前优先保证数据安全、低速后台运行、断点恢复、强校验和服务端配额约束，不实现双向冲突合并或循环同步。源端删除只通过跨周期回收站与人工确认流程受控处理。

## 当前正式版本

**DavBridge v0.4.0** 是当前正式发布版本。

运行架构：

```text
Vue 3 + TypeScript + Vite
        ↓ typed JSON bridge
Microsoft WebView2
        ↓
C# / .NET 8 极薄 Windows 宿主
        ↓
既有 DavBridge.Core 与既有 C# 安全链
```

v0.4.0 只替换 UI 与桌面宿主展示层，不重写已经完成真实服务验证的核心迁移逻辑。

正式 Release 标签：`p103-v0.4.0`。

正式 Release 必须从 `main` 的准确提交重新构建，不直接复用旧实验分支 Artifact。

## 当前入口

- 新对话固定接续入口：[HANDOFF.md](HANDOFF.md)
- 项目长期硬规则：[开发约束.md](开发约束.md)
- v0.4 UI 迁移补充约束：[开发约束-v0.4-补充.md](开发约束-v0.4-补充.md)
- v0.4 UI 架构：[UI架构-v0.4.md](UI架构-v0.4.md)
- 当前开发记录：[工作记录.md](工作记录.md)
- 正式与开发阶段：[阶段记录.md](阶段记录.md)
- 本地 Data 升级与回滚：[数据兼容与升级.md](数据兼容与升级.md)
- 重大架构取舍：[设计与演进.md](设计与演进.md)
- 完整源码与恢复入口：[代码/README.md](代码/README.md)
- Visual Studio / dotnet 统一解决方案：[代码/DavBridge.sln](代码/DavBridge.sln)

新对话必须先读取 `HANDOFF.md`，再核对 `main`、`p103-stable`、`p103-exp`、CI、标签与 Release 的真实状态。

## 核心安全语义

以下链路已经完成真实服务验证，并在 v0.4.0 中继续冻结：

```text
InfiniCLOUD authoritative source，只读
→ Zotero .zip + .prop Group
→ 源端完整 GET + SHA-256
→ 目标缺失时安全 PUT，或既有副本 NO-WRITE 接管
→ 准确资源确认
→ 目标重新 GET
→ 双端 SHA-256 一致
→ StrongVerified
→ 状态持久化
→ quota / Cycle / 网络恢复
```

同时保留：

- SourceChanged 周期维护；
- 历史 GoodSync 副本强校验接管；
- WriteUnknown reconciliation；
- HTTP 412 协调；
- 每周期 InfiniCLOUD 源端对账；
- 新增对象进入普通 backlog，不提高优先级；
- 回收站跨周期观察；
- DELETE 必须人工确认并再次核验；
- DPAPI 与现有 Data 文件；
- 坚果云上传、下载额度与安全预留。

Vue 前端只接收安全 DTO 和发送白名单命令。WebDAV 凭据、DPAPI、原始 state/reconcile 文件和真正的 PUT/DELETE 逻辑不进入 JavaScript。

## v0.4 UI

一级页面：

```text
总览 | 转移 | 回收站 | 文档
```

总览集中显示：

- InfiniCLOUD → 坚果云路由；
- 当前 Cycle；
- 源端对账、变化修复、普通迁移阶段；
- StrongVerified 镜像覆盖；
- 当前任务；
- 上传、下载额度；
- 必要人工提示与暂停、继续操作。

WinForms 不再负责业务页面布局，只作为 Windows 原生宿主保留窗口、托盘、单实例、登录自启动、WebView2 生命周期、原生设置窗口与危险操作最终确认。

## Data

Runtime 与私人 Data 严格分离。当前 Data 继续使用既有兼容格式：

```text
%APPDATA%\DavBridge\config.json
%APPDATA%\DavBridge\state.json
%APPDATA%\DavBridge\state.json.bak
%APPDATA%\DavBridge\secrets.dat
%APPDATA%\DavBridge\reconcile.json
%APPDATA%\DavBridge\reconcile.json.bak
```

Release、Artifact、源码和 CI 不得包含真实 WebDAV 凭据、私人 Zotero 文件清单、用户日志或其他私人 Data。

## 工程入口

```text
代码/
├── DavBridge.sln
├── DavBridge.Core/
├── DavBridge/
│   └── WebUi/
└── DavBridge.Smoke/
```

活动 CI：`.github/workflows/p103-davbridge-ci.yml`。

正式发布：`.github/workflows/p103-davbridge-v040-release.yml`。

P103 分支清理：`.github/workflows/p103-davbridge-branch-hygiene.yml`。

## 分支治理

长期只保留：

```text
p103-exp
p103-stable
```

`main` 是跨项目正式主线，不属于 P103 专属分支。

P103 的临时 PR 分支在合并后自动删除；每周卫生任务只清理**已经完整包含于 main** 的 P103 临时分支，不自动删除仍有独有提交的分支。这样不需要开启仓库级 `Automatically delete head branches`，也不会误删其他项目的长期分支。

正式 Release 只从 `main` 的准确提交建立。
