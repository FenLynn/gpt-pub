# DavBridge 源码入口

本目录是 P103 DavBridge 的完整可恢复源码入口。任何新对话、开发机或 CI 都应从这里恢复工程，不依赖聊天记录或本地临时文件。

## 当前版本

当前正式版本：**v0.4.0**。

当前 `p103-exp` 候选：**v0.4.3**。

最后完成完整 CI 的代码 head：

```text
0fcdde9fd7167a128d8104e644fe14fa29728ae9
```

CI run：`34470894206`，结果 `success`。

候选 Artifact：`DavBridge-v0.4.3-win-x64`。

EXE SHA256：`03325839fb6bfe9090c14800ebd777375e9b98abe9578a01e2ca2d1e97ffef1c`。

Artifact ZIP SHA256：`8fde4e1c398d420546e02856c21d37de93332397401b7cd3fdd822c5ce12a883`。

如果该 head 之后只有文档提交，仍以 `0fcdde9...` 作为最后经过完整构建验证的代码 head。

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

v0.4.3 UI 精修没有修改 `DavBridge.Core`。

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
- Data 兼容。

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

最后已验证 run `34470894206` 同时包含 Core Smoke、Vue build、视觉预览、Windows publish、Runtime boundary 和 native-host self-test。

## 当前开发断点

v0.4.3 目前只等待用户 Windows 实机 UI 与交互验收。未经明确验收，不提升 stable/main，不扩展功能，不重构 Core。