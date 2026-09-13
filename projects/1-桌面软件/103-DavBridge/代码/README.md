# DavBridge 源码入口

本目录是 P103 DavBridge 的完整可恢复源码入口。任何新对话、开发机或 CI 都应从这里恢复工程，不依赖聊天记录或本地临时文件。

## 当前版本

当前正式版本：**v0.4.0**。

当前 `p103-exp` 候选：**v0.4.18**。

v0.4.18 功能实现 head：

```text
e76e4deda04ad0a5a9839e8a9781c0dbcce004d5
```

当前 stable/main 稳定基线仍为 v0.4.16 commit `73aefcf04570180bb9526a43cf805aff1e7673b3`。

最后完成完整构建验证的 v0.4.18 代码 head：`2c70a847c870133ae8e7f681929ff029ac35bcd8`。CI run `34752362599` 全绿。

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

## 当前运行架构

```text
DavBridge/WebUi
Vue 3 + TypeScript + Vite
        ↓
WebView2 typed JSON bridge
        ↓
DavBridge
C# / .NET 8 Windows 原生宿主
        ↓
DavBridge.Core
既有迁移与安全链
```

v0.3 的 WinForms 业务 UI 源码仍保留用于历史追溯和回滚参照，但当前正常运行路径已经使用 `WebUiHostV040` 和嵌入式 Vue UI，不再挂载旧 `UiShellV030/V032` 作为主业务界面。

## DavBridge.Core

核心实现继续包含：

`Models.cs`

- 原迁移状态与 TransferRecord；
- `EngineState.WaitUser` 保持追加兼容；
- `MigrationState.SchemaVersion` 沿用既有兼容策略。

`ReconciliationModelV030.cs`

- Cycle `yyMMdd`；
- 回收站 disposition；
- 历史 StrongVerified 证据判断；
- metadata current 判断。

`MigrationEngine.cs`

- 上传、StrongVerified、SourceChanged、Conflict、WriteUnknown 主安全链；
- SourceChanged 组优先于普通 backlog。

`StateAndQuota.cs`

- `state.json` 原子保存；
- 配额模型。

`WebDav.cs`

- WebDAV GET / PUT 等客户端逻辑；
- HTTPS only；
- IO progress。

v0.4.13 对 `DavBridge.Core/MigrationEngine.cs` 只增加人工暂停的安全 member 边界检查；WebDAV PUT/GET、StrongVerified、WriteUnknown、quota/Cycle、Reconciliation 与 DELETE 语义未改变。

## DavBridge Windows 宿主

当前重点文件：

`Program.cs`

- 单实例和应用启动；
- 当前运行入口挂载 v0.4 WebView2 UI；
- 支持显式打开回到总览。

`WebUiHostV040.cs`

- WebView2 生命周期；
- 嵌入式静态资源；
- 本地虚拟 host；
- typed JSON bridge；
- 前端命令白名单；
- 导航与 Web 权限边界；
- 原生设置和危险确认入口。

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
- 删除后目标准确路径复核。

旧 `Ui*V02xx/V03xx.cs` 文件属于历史 UI 演进，不应因为仍在项目中就被重新挂回正常业务路径。

## WebUi

目录：

```text
DavBridge/WebUi/
```

关键文件：

`src/App.vue`

- 当前总览、转移、回收站、文档、关于页面；
- 固定左侧导航；
- 前端白名单命令调用；
- 回收站人工操作入口。

`src/bridge.ts`

- typed JSON bridge 客户端；
- 与 C# 宿主交换安全 DTO 和白名单命令。

`src/styles.css`

- v0.4 主视觉与页面样式。

`src/sidebar-v043.css`

- v0.4.3 左侧栏方案的最后比例调整；
- 总览网格行高；
- 窄窗口覆盖卡文本；
- 低高度窗口兜底。

`src/mock.ts`

- 浏览器视觉预览用安全 mock snapshot；
- 不属于真实迁移事实源。

## DavBridge.Smoke

Smoke 测试继续覆盖迁移与安全不变量，包括：

- zip/prop Group；
- StrongVerified；
- SourceChanged；
- WriteUnknown 与 412；
- quota 与 Cycle；
- 跨周期回收站；
- WaitUser；
- DELETE 前再验证；
- Data 兼容；
- 人工安全暂停：当前 member 安全完成后停止，下一 member 不得启动。

UI 迁移后仍必须运行原 Core Smoke，不能只做 Vue 构建。

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
12. Vue 不得持有 WebDAV 凭据或直接实现 PUT/DELETE。

## 本地 Data

核心 Data 保持兼容：

```text
%APPDATA%/DavBridge/config.json
%APPDATA%/DavBridge/state.json
%APPDATA%/DavBridge/state.json.bak
%APPDATA%/DavBridge/secrets.dat
%APPDATA%/DavBridge/reconcile.json
%APPDATA%/DavBridge/reconcile.json.bak
```

WebView2 用户数据位于 `%LOCALAPPDATA%/DavBridge/WebView2`，日志、缓存和临时文件继续与 Runtime 分离。

## 构建

前端先执行：

```text
cd DavBridge/WebUi
npm install
npm run build
```

随后由 `DavBridge.csproj` 把 `WebUi/dist` 作为 EmbeddedResource 嵌入程序集。

Windows x64 使用 .NET 8 framework-dependent single EXE publish。

活动 CI：

```text
.github/workflows/p103-davbridge-ci.yml
```

v0.4.16 第一轮完整验证 run `34743274402` 同时包含扩展 Core Smoke、Vue build、视觉预览、Windows publish、Runtime boundary 和 native-host self-test。

## 当前开发断点

v0.4.18 当前只在 `p103-exp`。本轮在 About 页增加近 24 小时 operational-health strip，并增加 deterministic native self-test。

### v0.4.18 运行健康摘要

`ProductExperienceV044.BuildOperationalHealth(24)` 从既有通用活动记录统计：

- warningCount；
- networkWaitCount；
- pauseCount；
- completionCount；
- windowComplete。

`WebUiHostV040` 只把这些聚合值以及当前 verified/backlog 暴露给 Vue。没有新增真实文件名、路径、URL、凭据或 SHA。

如果 sidecar 的 40 条保留窗口不足以覆盖完整 24 小时，`windowComplete=false`，UI 明确提示活动窗口可能截断。

`Program --self-test` 新增 `operationalHealthSummary`，CI 会强制验证。

最后完整验证代码 head：`2c70a847c870133ae8e7f681929ff029ac35bcd8`。Windows candidate Artifact ID `10316611787`，EXE SHA256 `7a5d10b2caa99d30495d8f1754e2f72c4d9b9a9448ce6b5d0a2c588ac031d884`。后续若只有文档提交，仍以该代码 head 作为 v0.4.18 构建事实源。

未经用户明确授权，不提升 stable/main，不创建 tag 或 Release。
