# DavBridge 对话接续入口

本文件是 P103 DavBridge 唯一动态交接状态。README 只保留长期稳定入口。新对话必须先按本文件恢复事实，再重新查询仓库实时状态，不得只凭聊天记忆继续。

## 1. 项目身份

仓库：`FenLynn/gpt-pub`

项目：`projects/1-桌面软件/103-DavBridge/`

正式主线：`main`

日常开发：`p103-exp`

稳定候选：`p103-stable`

规则优先级：仓库根 `GPT_RULES.md` 高于分类 `projects/1-桌面软件/开发约束.md`，分类约束高于本项目 `开发约束.md` 与 `开发约束-v0.4-补充.md`。

## 2. 当前版本与正式发布事实

当前正式 Release 仍为 DavBridge v0.4.0。

正式标签：`p103-v0.4.0`

正式 Release commit：`94aa30fe488235b1a15065d54e6cf3b8c94fef47`

当前实验候选的产品版本为 v0.4.3，位于 `p103-exp`。它尚未提升到 `p103-stable` 或 `main`，也不是正式 Release。

## 3. 最新完整验证代码基线

最新完成完整 P103 CI 的代码 head：

```text
adde1adaab6d3f4c9e9d0600b674d7e613c26408
```

对应 P103 CI：

```text
run 34547772628
scope          success
core-smoke     success
frontend       success
windows-build  success
report-status  success
```

Windows candidate：`DavBridge-v0.4.3-win-x64`

Artifact ID：`10179717875`

EXE：

```text
2246235 bytes
SHA256 27363e5546b4b757832090aa5703d410b4d00e4be07a6b4c16178ba34c1c98a0
```

Artifact ZIP SHA256：

```text
a1db20e24c5706d3bc4c846b4998d299754fe89d2d20427213f27205fc2df09a
```

CI 已再次通过 Vue typecheck、production build、浏览器视觉预览、Core Smoke、Windows x64 framework dependent single EXE、Runtime 私人数据边界、native host self test 和 Artifact 生成。

本 HANDOFF 更新发生在该代码 head 之后，因此新对话必须把 `daa2f105...` 识别为最后完整验证的代码基线，而不是把纯文档提交误当成新的代码候选。

## 4. 当前分支快照

本轮代码验证时：

```text
main         042329ede97b09cd375ebcf7c55d7245fc56b933
p103-stable  d8d5aed844ca2944c8511c85c0a892dbbd411fc5
validated p103-exp code head
adde1adaab6d3f4c9e9d0600b674d7e613c26408
```

本轮继续保持 `p103-exp` 在当前 `main` 之上开发。新对话仍必须重新查询实时 ahead、behind 与 merge base，不得依赖本快照推断祖先关系。

新对话必须重新查询三条分支实时 head 和祖先关系，不得把上述快照视为永久事实。

## 5. 当前架构

运行结构：

```text
Vue 3 + TypeScript + Vite
        ↓ typed JSON bridge
Microsoft WebView2
        ↓
C# / .NET 8 Windows native host
        ↓
DavBridge.Core 与既有 C# 安全链
```

v0.4 系列只替换显示与交互层，不重写已经验证的迁移逻辑。不引入 Rust，不使用 Tauri sidecar，不把 WebDAV、凭据、DPAPI、原始 state 或 reconcile 数据搬进 JavaScript。

Web UI bridge 白名单仍只有：

```text
app.getSnapshot
app.openSettings
migration.pause
migration.resume
recycle.defer
recycle.delete
```

## 6. 最新总览 UI 状态

用户已经确认整体方向基本可接受，最新一轮继续做轻量化收敛。`adde1ada...` 已完成并通过完整 P103 CI。

第一，悬浮提示统一改为白色底纹、深色文字、浅边框和柔和阴影，并提高层级，Overview 相关容器允许 tooltip 正常溢出显示。

第二，迁移路径不再使用中间圆形箭头。现在是一条连续横向路径线，箭头头部位于右端，指向坚果云。

第三，迁移阶段仍位于路径卡下方，但状态标记进一步弱化。已完成阶段只显示普通绿色 `✓`，不再使用绿色圆形图标。未完成阶段不再显示圆形数字。

第四，“镜像覆盖、当前任务、流量预算”继续保持三行信息结构，但已经移除右侧大白色外框、圆角底板和阴影。三行直接融入 workspace 背景，只保留轻量水平分隔线；三类左侧图标底块、流量箭头底块和重置图标底块也进一步弱化为无底色视觉。

第五，左上角 DavBridge 下方的 `Zotero 镜像` 已隐藏。总览页顶部 `你好，DavBridge` 整个 header 已移除。其他页面仍保留各自页面标题。

第六，桌面 BalloonTip 通知已经永久关闭。新增 `SilentNotifyIcon.cs`，继续保留 Windows 托盘图标、双击恢复、右键菜单、暂停、继续和退出功能，但所有 `ShowBalloonTip` 调用均成为 no op。额度不足、完成、重试等待等状态不再推送 Windows 右下角桌面气泡。状态仍在 DavBridge 自身 UI 内显示。

这轮没有修改 `DavBridge.Core`。

## 7. 核心冻结安全语义

以下语义继续冻结，不允许因为 UI 修改而降低安全门：

InfiniCLOUD 是唯一 authoritative source，正式产品对源端只读。

Zotero `.zip + .prop` 作为一个 Attachment Group。

StrongVerified 必须满足源端读取与 SHA256、目标重新 GET 与 SHA256、两端完全一致，并确认源对象在验证期间未变化。

历史 GoodSync 或人工目标副本只能经过完整强校验后 NO WRITE 接管。

保留 SourceChanged、WriteUnknown reconciliation、HTTP 412 协调、quota 与 Cycle、真实重置探测、每周期源端对账、新对象普通 backlog、回收站跨周期观察、人工 DELETE 门、删除前再次核验、DPAPI 和现有 Data 格式。

DELETE 仍为：

```text
Web UI 删除意图
→ 前端确认
→ C# 原生最终确认
→ ReconciliationRemovalV030
→ 再次检查源端、Group 和目标身份
→ 全部满足才 DELETE
```

真实 DELETE 仍等待未来合法跨周期候选自然出现后再进行真实账户验证。

## 8. Data 与隐私边界

核心 Data 继续位于：

```text
%APPDATA%\DavBridge\config.json
%APPDATA%\DavBridge\state.json
%APPDATA%\DavBridge\state.json.bak
%APPDATA%\DavBridge\secrets.dat
%APPDATA%\DavBridge\reconcile.json
%APPDATA%\DavBridge\reconcile.json.bak
```

Runtime、Artifact、Release、源码和 CI 不得包含真实 WebDAV 凭据、私人 Zotero 文件清单、用户日志或其他私人 Data。

## 9. 当前准确断点

用户下一步需要在真实 Windows 上运行 `adde1ada...` 对应的 candidate，重点检查：

1. 总览顶部被移除后，主体起始位置是否自然。
2. 白色 tooltip 是否能稳定显示且不被卡片裁切。
3. 右端箭头是否比原中间圆形箭头自然。
4. 右侧大白框移除后，三行内容是否自然融入背景，水平分隔线是否足够而不过度。
5. 三阶段普通绿色勾是否足够轻，不再抢视觉。
6. 桌面右下角不再出现额度不足或其他 BalloonTip。

用户实机确认之前，不提升 `p103-stable`，不修改 `main`，不创建正式标签或 Release。

## 10. 新对话固定读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `/INTEGRATION_PLAYBOOK.md`
4. `projects/1-桌面软件/开发约束.md`
5. 本项目 `开发约束.md`
6. 本项目 `开发约束-v0.4-补充.md`
7. 本 `HANDOFF.md`
8. `UI架构-v0.4.md`
9. `README.md`
10. `工作记录.md`
11. `阶段记录.md`
12. `用户手册.md`
13. `数据兼容与升级.md`
14. `设计与演进.md`
15. `代码/README.md`
16. 需要实现细节时再读取 `代码/DavBridge.sln`、`代码/DavBridge/`、`代码/DavBridge/WebUi/` 与 `代码/DavBridge.Core/`

## 11. 事实源

实现事实以源码为准。

安全逻辑以 `DavBridge.Core`、Core Smoke 和既有 C# 测试为准。

构建事实以准确代码 head 对应的 CI 为准。

正式发布事实以 `main` 上正式标签和 GitHub Release 为准。

最终 UI 和真实 WebDAV 行为以用户真实 Windows 为准。
