# DavBridge 对话接续入口

本文件用于恢复 P103 DavBridge 当前事实与准确断点。

## 当前事实

仓库：`FenLynn/gpt-pub`

项目：`projects/1-桌面软件/103-DavBridge/`

分支：

- 日常开发：`p103-exp`
- 稳定候选：`p103-stable`
- 正式主线：`main`

正式稳定回滚基线仍是 **v0.1.7**，`main` 与 `p103-stable` 未修改。

当前实验候选：**v0.4.0**。

准确完成完整 CI 的代码 head：

```text
0c502b45077d0dfd4482a05ad3ba288f364e1135
```

P103 CI：

```text
run 32085930510
scope          success
core-smoke     success
frontend       success
windows-build  success
report-status  success
```

Windows Artifact：`DavBridge-v0.4.0-win-x64`

EXE SHA256：

```text
267251da30385ddb05bc8946e1dcaf4e8d733cb78d1c5d1b7dc51842d8e25a81
```

Artifact ZIP SHA256：

```text
0651e0c3f3323b18a679c717bb11a506b806a8a88fff1760d6fa4c4f0ad02ef2
```

后续 `[skip ci]` 文档提交不得冒充已构建代码 head。准确构建 head 始终以上述 `0c502b45...` 为准，直到出现新的完整绿色代码构建。

## 固定读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. 本项目 `开发约束.md`
5. 本项目 `开发约束-v0.4-补充.md`
6. 本 HANDOFF
7. `UI架构-v0.4.md`
8. `README.md`
9. `用户手册.md`
10. `数据兼容与升级.md`
11. 涉及代码时从 `代码/DavBridge.sln` 与 `代码/DavBridge/WebUi/` 恢复

## v0.4 架构决策

用户明确批准：保留已经验证的 C# 逻辑，只更换 UI。

当前运行架构：

```text
Vue 3 + TypeScript + Vite
        ↓ typed JSON bridge
Microsoft WebView2
        ↓
C# / .NET 8 极薄 Windows 宿主
        ↓
既有 DavBridge.Core 与既有 C# 安全链
```

不引入 Rust，不使用 Tauri sidecar，不重写 DavBridge.Core。

## 核心冻结

v0.4 UI 迁移不得改变：

- InfiniCLOUD authoritative source 与源端只读；
- Zotero `.zip + .prop` Group；
- StrongVerified 双端 SHA256；
- 历史 GoodSync 副本强校验接管；
- SourceChanged；
- WriteUnknown reconciliation；
- HTTP 412 协调；
- quota / Cycle / 09:00 真实重置探测；
- 每周期源端对账；
- 新增对象普通 backlog；
- 回收站跨周期观察；
- 人工 DELETE 门和删除前再次核验；
- DPAPI 与现有 Data 文件；
- WebDAV GET / PUT / DELETE 实现。

架构迁移前后 Git diff 已复核。准确绿色 v0.4 code head 相比迁移前没有修改 `DavBridge.Core`、`AppInfrastructure.cs`、`ReconciliationRuntimeV030.cs`、`ReconciliationRemovalV030.cs` 或 WebDAV / Data 模型。

## Web UI 权限边界

当前 C# bridge 白名单只有：

```text
app.getSnapshot
app.openSettings
migration.pause
migration.resume
recycle.defer
recycle.delete
```

Vue 只接收安全 DTO 和发送白名单意图。密码、DPAPI、WebDAV 客户端、state/reconcile 原文件和真正写入逻辑不得进入 JavaScript。

DELETE 仍保留两层人机门：Web UI 表示删除意图，随后必须经过 C# 原生最终确认，再进入原 `ReconciliationRemovalV030` 安全链。

## Windows 原生宿主职责

WinForms 不再承担业务页面布局，只保留：

- Windows 主窗口；
- 托盘；
- 单实例；
- 登录自启动；
- WebView2 生命周期；
- 原生设置窗口；
- 危险操作最终确认；
- 已有后台运行入口。

手工双击 EXE、已运行时再次双击、托盘双击或“打开 DavBridge”仍应恢复窗口并回到总览。`--background` 登录自启动仍允许后台运行。

## Web UI 页面

一级页面固定为：

```text
总览 | 转移 | 回收站 | 文档
```

总览包含：

- InfiniCLOUD → 坚果云路由；
- Cycle；
- 源端对账 / 变化修复 / 普通迁移阶段；
- StrongVerified 镜像覆盖；
- 当前任务；
- 上传 / 下载额度；
- 必要的人工提示和主操作。

上传下载进度条已经改为 CSS flex/grid 布局，不再使用 WinForms Meter、TableLayoutPanel、字体 baseline 或 DPI 手工定位。

## v0.4 构建与视觉验证

CI 前端独立执行：

```text
Vue typecheck
Vite production build
900×620 headless browser preview
1200×760 headless browser preview
```

Windows 构建执行：

```text
重新构建 WebUi
.NET 8 restore / publish
framework-dependent single EXE 验证
嵌入 WebUi 资源验证
bridge whitelist 验证
Core logic moved to JavaScript = false
```

WebView2 NuGet 的 XML API 文档在 Publish 后删除，最终交付目录重新保持单 EXE。

Linux 浏览器预览已人工查看，页面几何、路由、卡片、阶段、上传下载条和默认 900×620 无滚动布局正常。Linux runner 缺中文字体时截图可能显示 tofu 字形，因此用户真实 Windows / WebView2 仍是最终视觉事实源。

## 当前断点

下一步只做 **v0.4.0 用户真实 Windows 验收**，不得提升 stable：

1. 双击 EXE 是否直接显示总览；
2. Vue 页面是否完整加载；
3. 中文字体、Logo、四个 Tab、卡片与额度条视觉；
4. 上传 / 下载数字是否自然居中；
5. 转移 / 回收站 / 文档页面切换；
6. 设置按钮是否仍打开原安全设置窗口；
7. 暂停 / 继续是否调用原 C# 行为；
8. 不要为了 UI 验证主动制造真实 DELETE。

真实 DELETE 仍需等待未来合法跨周期候选自然出现后再实机验证。

## 事实源

- 实现事实：源码；
- 安全逻辑事实：Core Smoke 与既有 C# 测试；
- 构建事实：准确 CI run；
- 正式稳定事实：`main` / `p103-stable`；
- 实验事实：`p103-exp`；
- WebDAV 行为和最终 UI：用户真实 Windows。
