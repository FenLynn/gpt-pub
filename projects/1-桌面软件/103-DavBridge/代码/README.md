# DavBridge 源码入口

本目录是 P103 DavBridge 的完整可恢复源码入口。任何新对话、开发机或 CI 都应从这里恢复工程，不依赖聊天记录或本地临时文件。

## 当前实验候选

`p103-exp`：**v0.3.0**

准确完成 CI 的代码 head：`22d321f9811bb047f2ddd96c5a7463225fed51f1`

CI run：`31869299097`，结果 **success**。

正式稳定基线仍为 `main / p103-stable = v0.1.7`。

## 解决方案

源码入口：

```text
代码/DavBridge.sln
```

主要项目：

```text
DavBridge.Core
DavBridge
DavBridge.Smoke
```

## v0.3 核心文件

### DavBridge.Core

`Models.cs`

- 原迁移状态与 TransferRecord；
- `EngineState.WaitUser` 追加在旧枚举值之后；
- `MigrationState.SchemaVersion` 仍为 1。

`ReconciliationModelV030.cs`

- Cycle `yyMMdd`；
- 回收站 disposition；
- 历史 StrongVerified 证据判断；
- metadata current 判断。

`MigrationEngine.cs`

- 原上传、StrongVerified、SourceChanged、Conflict、WriteUnknown 主安全链；
- SourceChanged 组优先于普通 backlog。

`StateAndQuota.cs`

- `state.json` 原子保存；
- 配额模型。

`WebDav.cs`

- WebDAV read/write；
- HTTPS only；
- GET / PUT IO progress。

### DavBridge

`ReconciliationRuntimeV030.cs`

- `%APPDATA%/DavBridge/reconcile.json` sidecar；
- 每 Cycle 自动源端对账；
- 源 metadata 变化后的 InfiniCLOUD SHA256 复核；
- 首次缺失、跨周期审查、人工保留；
- 对账与人工回收站事务使用同一互斥门。

`ReconciliationRemovalV030.cs`

- 只有人工调用的受控 DELETE；
- 删除前再次确认全部源成员仍缺失；
- zip / prop 部分恢复时禁止删除；
- 目标大小 / ETag / 必要 SHA256 身份确认；
- DELETE 不确定结果 reconciliation；
- 删除后目标准确路径复核；
- 删除成功后保留历史 SHA 证据并把记录置为待恢复语义。

`AppInfrastructure.cs`

- 重置真实探测；
- 新 Cycle 后先走 `ReconciliationRuntimeV030.BeforeMigrationAsync`；
- 有人工阻塞时进入 `WaitUser`；
- 无人工阻塞才进入普通 MigrationEngine。

`UiShellV030.cs`

- 当前唯一运行 UI shell；
- `总览 | 转移 | 回收站`；
- 无宽左栏；
- Cycle、双右箭头、流量、镜像覆盖、人工提示；
- 回收站审查默认零选择，不在动画 Timer 中重建。

`Program.cs`

- 运行时只挂载 `ReconciliationRuntimeV030 + UiShellV030`；
- 旧 v0.2 UI generation 仍在源码中作为历史过渡文件，但不再运行挂载。

### DavBridge.Smoke

`ReconciliationSmokeV030.cs`

- Cycle 日历日期不受 CI 时区换日；
- 首次缺失只能观察；
- 跨后续 Cycle 才可人工审查；
- 本周期保留只对当前 Cycle 有效；
- blocked 人工保留下周期重新出现；
- zip + prop 历史完整性；
- WaitUser 枚举追加兼容。

## 关键安全不变量

1. InfiniCLOUD 正式客户端只读。
2. StrongVerified 只有双端 GET + SHA256 一致才能成立。
3. 源 SHA 真变化后优先刷新历史镜像。
4. 新增对象不插队。
5. 首次源缺失永远不 DELETE。
6. DELETE 永远要求人工明确确认。
7. 本周期人工保留后任何代码路径都不得再删除该组。
8. 源只恢复部分 Zotero 成员时禁止删除。
9. 删除前目标身份无法证明时禁止删除，或在安全下载预算允许时做目标 SHA256。
10. DELETE 结果不确定先查询目标，不盲目重复。
11. `reconcile.json` 丢失只能让删除更保守，不能让删除更容易。

## 本地 Data

核心旧 Data 保持不迁移：

```text
%APPDATA%/DavBridge/config.json
%APPDATA%/DavBridge/state.json
%APPDATA%/DavBridge/state.json.bak
%APPDATA%/DavBridge/secrets.dat
```

v0.3 新增：

```text
%APPDATA%/DavBridge/reconcile.json
%APPDATA%/DavBridge/reconcile.json.bak
```

## 构建

CI Windows x64 使用 .NET 8 framework-dependent single EXE publish。

v0.3.0 Artifact：`DavBridge-v0.3.0-win-x64`

EXE SHA256：`37f78cba17fd2eb5a4864b788596371f6858e8e6de42a263f5919a5515c749c3`
