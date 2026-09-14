# DavBridge 源码入口

本目录是 P103 DavBridge 的完整可恢复源码入口。任何新对话、开发机或 CI 都应从这里恢复工程，不依赖聊天记录或本地临时文件。

## 当前版本

当前正式 GitHub Release：**v0.4.0**。

当前 stable/main 源码基线：**v0.4.26**。

当前实验候选：**v0.5.2**，仅位于 `p103-exp`，尚未授权提升 stable/main。

v0.5.2 代码验证 head：

```text
787b15f346cdddf4588239122603dfb3605ece9b
```

完整 P103 CI run：`34845319350`，五项全绿，Core Smoke 20/20。

Windows candidate：

```text
DavBridge-v0.5.2-win-x64
Artifact ID 10348157125
Artifact ZIP SHA256 fcfc979cf4d590a37808a2e1dbd3467a8e7fbcf3ec921df0ac333a618e8957fa
EXE bytes 2520667
EXE SHA256 d84d1b8a58cdd06634c422f1c8c73d704f833a2ef8dc8a8d8366dd4067f410ef
```

Web UI preview Artifact ID：`10347747961`。

Windows native-host self-test 已通过 `dataPortabilityV050=true`，原有 config/state/reconcile/product sidecar 恢复、runtime session、4:3 窗口迁移、background wake 和健康账本测试继续通过。

v0.4.26 stable/main head 当前为 `9579bf0207862f5b6da81b5a3edf87026c156b11`。v0.5.2 没有 stable/main 提升授权，也没有正式 tag 或 GitHub Release 授权。

## v0.4.25 surface 色阶收束

v0.4.25 在 v0.4.24 收束候选基础上只做 surface 色阶修正。普通文字区从纯白或高透明度白色回到淡蓝灰 quiet / soft / panel 层，About 保持透明，真正抬升的 tooltip、选中 tab 和交互面保留更亮 surface。

页面结构、About 三级信息层次、生产 UI 所有权门、九张视觉预览、Core Smoke 20 项以及旧 WinForms UI 隔离规则均保持不变。

## v0.4.26 左上版本号

左上品牌区现在在 `DavBridge` 标题下直接显示 `v{{ snapshot.version }}`。该版本号来自现有安全 snapshot，不新增 bridge 命令。

版本号使用小号浅灰文本，并针对窄窗口缩小。原“Zotero 镜像”副标题从品牌区移除。

## v0.5.0 数据可发现与迁移中心

v0.5.0 新增 `DataManagementV050.cs`，负责 DataRoot bootstrap、文件清单聚合、数据目录迁移、备份 ZIP、manifest、SHA-256 校验、恢复 staging、恢复前安全快照和 DPAPI 凭据兼容处理。

持久 DataRoot 默认仍为 `%APPDATA%\DavBridge`，但可以迁移到新的空目录。固定 `%LOCALAPPDATA%\DavBridge\bootstrap.json(.bak)` 只保存当前 DataRoot 指针。

About 和设置都显示“数据与迁移”。Web UI 只接收安全 DataOverview，不读取 state/reconcile/secrets 内容。所有目录选择、备份和恢复实际操作仍由 C# 原生宿主执行。

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

`DataManagementV050.cs`

- 当前 DataRoot 的 bootstrap 解析和安全迁移；
- 持久文件与本机运行文件的清单聚合；
- 带 manifest 和 SHA-256 的备份 ZIP；
- 恢复前安全快照、staging 和原子替换；
- DPAPI CurrentUser 凭据无法解密时安全跳过。

`ReconciliationRuntimeV030.cs`

- 当前 DataRoot 下的 `reconcile.json` sidecar；
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

v0.5.0 将数据分为“持久 DataRoot”和“固定本机 LocalRoot”。

默认持久 DataRoot：

```text
%APPDATA%\DavBridge
```

当前 DataRoot 内包含：

```text
config.json(.bak)
state.json(.bak)
reconcile.json(.bak)
v2-compat.json(.bak)
secrets.dat
Backups\
```

固定入口：

```text
%LOCALAPPDATA%\DavBridge\bootstrap.json
%LOCALAPPDATA%\DavBridge\bootstrap.json.bak
```

固定本机 LocalRoot 还包含 `product-experience.json(.bak)`、`window.json`、`runtime-session.json`、`backup-status.json`、`startup-error.log`、`Temp\`、`WebView2\` 和 `WebUi\`。

WebView2 用户数据、日志、缓存和临时文件继续与 Runtime 发布包分离。匿名 operational health 仍只保存时间与类别，不保存真实文件名、路径、URL、凭据或 SHA，不参与迁移安全判断。

回退 v0.4.26 时必须注意：旧版不认识 bootstrap。若 v0.5.0 已使用自定义 DataRoot，需要先把当前持久数据安全复制回 `%APPDATA%\DavBridge`，再启动旧版。

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

v0.4.26 已完成 stable/main 两级准入。

v0.5.0 数据可发现与迁移主题已经完成代码实现和自动化验证，当前仅存在于 `p103-exp`，等待用户真实 Windows 验收。

优先实机检查：

1. About 的“数据与迁移”与文件清单；
2. 设置中的同名分类；
3. 打开持久 DataRoot 和本机 LocalRoot；
4. 手动创建一份备份；
5. 使用非生产测试目录验证 DataRoot 迁移和恢复。

未获得用户明确授权前，不提升 stable/main，也不创建正式 Release。


## v0.5.1 About 与数据管理分层

v0.5.1 只调整 v0.5 数据中心的信息架构。

About 恢复轻量摘要，只保留持久数据、最近备份和数据管理入口。完整文件与目录清单进入独立 `data` 二级页。

二级页顶部明确区分：

```text
持久数据目录  可修改
本机运行目录  固定
```

随后单独显示备份与恢复、关键持久数据、本机运行数据。CI 新增 `data-1100x825.png` 视觉预览。


## v0.5.2 About 与数据设置归位

v0.5.2 删除 Web UI 内独立数据管理页。数据管理最终固定在原生 `设置 → 数据与迁移`。

About 只保留两个 Tab：`关于` 和 `运行状态`。默认 About 不再显示数据路径、备份按钮、完整文件清单或技术栈。

原生数据设置页使用更大字号的目录卡片：

```text
持久数据目录  可修改
本机运行目录  固定
```

备份恢复独立成块，完整受管理文件清单通过 `DataInventoryDialogV052` 按需打开。

这保持了“所有数据都能从软件内查到”，同时避免 About 和主导航被低频维护信息占满。
