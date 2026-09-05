# DavBridge 对话接续入口

本文件用于恢复 P103 DavBridge 当前事实与准确断点。

## 当前事实

仓库：`FenLynn/gpt-pub`

项目：`projects/1-桌面软件/103-DavBridge/`

长期 P103 分支只保留：

- `p103-exp`
- `p103-stable`

跨项目正式主线：`main`。

当前正式版本：**v0.4.0**。

正式标签：`p103-v0.4.0`。

正式 Release 名：`DavBridge v0.4.0`。

v0.4.0 在进入正式 Release 前已经完成用户真实 Windows 验收：Vue + WebView2 主界面正常加载，中文、路由、阶段、卡片和上传下载额度条实际显示明显优于旧 WinForms 业务 UI。

v0.4.0 UI 迁移的准确已验证代码 head：

```text
0c502b45077d0dfd4482a05ad3ba288f364e1135
```

对应 P103 CI：

```text
run 32085930510
scope          success
core-smoke     success
frontend       success
windows-build  success
report-status  success
```

该代码已经进入 `main`。后续主线又包含其他项目的大量提交，因此不得把旧 `p103-exp` 反向合并到当前 `main`。正式 v0.4.0 Release 必须直接从当前 `main` 重新构建。

## 正式发布流程

P103 正式发布工作流：

```text
.github/workflows/p103-davbridge-v040-release.yml
```

它只在 `main` 上构建并执行：

```text
版本核对
→ 冻结 Core Smoke
→ Vue production build
→ Windows x64 single EXE publish
→ Runtime 私人数据边界检查
→ 隔离 native-host self-test
→ 生成 EXE / ZIP / SHA256
→ 建立 p103-v0.4.0 tag
→ 建立 DavBridge v0.4.0 GitHub Release
→ 同步 p103-stable / p103-exp 到已发布 main
→ 清理 P103 旧临时分支
```

Release 资产固定为：

```text
DavBridge-v0.4.0.exe
DavBridge-v0.4.0-win-x64.zip
DavBridge-v0.4.0-SHA256.txt
```

旧实验 Artifact 的 SHA 只作为历史证据，不冒充正式 Release 构建。正式 Release SHA 以 GitHub Release 中重新构建的资产为准。

## 分支治理

正常长期只保留：

```text
p103-exp
p103-stable
```

正式 Release 后两者都快进到已发布的 `main` 提交，避免长期分支再次落后主线几百或上千提交。

已废弃的 P103 分支在正式发布阶段统一清理。旧 `p103-localsub-exp` 曾包含 LocalSub 编号错误时期的独有历史，因此删除分支前先转存为 archive tag，再移除错误的 P103 branch ref。

以后不启用仓库级 `Automatically delete head branches`，因为这是多项目 monorepo，其他项目有长期 `exp/stable` 分支。P103 自己使用：

```text
.github/workflows/p103-davbridge-branch-hygiene.yml
```

治理规则：

- 合并完成的临时 `p103-*` PR head 自动删除；
- `p103-exp` 与 `p103-stable` 永不自动删除；
- 每周只清理已经完整包含于 `main` 的 P103 临时分支；
- 有独有提交的分支不会被周任务自动删除，必须先人工确认或归档。

## 固定读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `/INTEGRATION_PLAYBOOK.md`
4. `projects/1-桌面软件/开发约束.md`
5. 本项目 `开发约束.md`
6. 本项目 `开发约束-v0.4-补充.md`
7. 本 HANDOFF
8. `UI架构-v0.4.md`
9. `README.md`
10. `用户手册.md`
11. `数据兼容与升级.md`
12. 涉及代码时从 `代码/DavBridge.sln` 与 `代码/DavBridge/WebUi/` 恢复

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

架构迁移前后 Git diff 已复核。v0.4 UI 迁移没有修改 `DavBridge.Core`、既有 WebDAV 核心、状态模型或核心安全语义。

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

## Data

核心 Data 继续保持原路径与兼容格式：

```text
%APPDATA%\DavBridge\config.json
%APPDATA%\DavBridge\state.json
%APPDATA%\DavBridge\state.json.bak
%APPDATA%\DavBridge\secrets.dat
%APPDATA%\DavBridge\reconcile.json
%APPDATA%\DavBridge\reconcile.json.bak
```

Release、Artifact、源码和 CI 不得包含私人凭据、私人 Zotero 文件清单、用户日志或其他私人 Data。

## 当前断点

正式 Release 完成后，下一个开发周期从已经与 `main` 对齐的 `p103-exp` 开始。不得从历史垃圾分支恢复开发，也不得为了 UI 优化重写核心迁移逻辑。

真实 DELETE 仍需等待未来合法跨周期候选自然出现后再实机验证。

## 事实源

- 实现事实：源码；
- 安全逻辑事实：Core Smoke 与既有 C# 测试；
- 构建事实：准确 CI / Release workflow；
- 正式发布事实：`main` + `p103-v0.4.0` + GitHub Release；
- 日常开发：`p103-exp`；
- 稳定候选：`p103-stable`；
- WebDAV 行为和最终 UI：用户真实 Windows。
