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
fc9b2e6e5bca0a0bce402b273b210370d01647db
```

对应 P103 CI：

```text
run 34563940712
scope          success
core-smoke     success
frontend       success
windows-build  success
report-status  success
```

Windows candidate：`DavBridge-v0.4.3-win-x64`

Artifact ID：`10185357260`

EXE：

```text
2246235 bytes
SHA256 bef8cfd1dff817789b3c07842e5532120a1dbaab81d6223512275103575b678d
```

Artifact ZIP SHA256：

```text
c07e5ef375c9baaab1e7fd7def4c0d9b6a6726e2f19ea19de8d9f22e37686d7c
```

CI 已再次通过 Vue typecheck、production build、浏览器视觉预览、Core Smoke、Windows x64 framework dependent single EXE、Runtime 私人数据边界、native host self test 和 Artifact 生成。

本 HANDOFF 更新发生在该代码 head 之后，因此新对话必须把 `fc9b2e6e...` 识别为最后完整验证的代码基线，而不是把后续纯文档提交误当成新的代码候选。

## 4. 当前分支快照

本轮代码验证时：

```text
main         042329ede97b09cd375ebcf7c55d7245fc56b933
p103-stable  d8d5aed844ca2944c8511c85c0a892dbbd411fc5
validated p103-exp code head
fc9b2e6e5bca0a0bce402b273b210370d01647db
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

用户已经确认新的 Apple / Google 风格总览设计稿，`fc9b2e6e...` 已按该设计稿落地并通过完整 P103 CI。

第一，悬浮提示统一改为白色底纹、深色文字、浅边框和柔和阴影，并提高层级，Overview 相关容器允许 tooltip 正常溢出显示。

第二，迁移路径不再使用中间圆形箭头。现在是一条连续横向路径线，箭头头部位于右端，指向坚果云。

第三，迁移阶段位于路径下方并改成轻量 stage rail。`源端对账` 与 `变化修复` 在 done 状态时都显示淡灰圆底内的绿色 `✓`；未完成阶段显示淡灰空心圆，不再显示数字；阶段之间使用细灰连接线。

第四，三行顺序已经固定为 `镜像覆盖 → 流量预算 → 当前任务`，整体直接融入 workspace 背景，只保留轻量水平分隔线。每行左侧使用柔和功能图标块；覆盖率百分比移动到最右侧，覆盖计数直接使用无千位分隔符的 `verified / total 已校准`。流量预算的上传和下载数值统一显示 1 位小数，百分数放大，重置日期与时间移动到流量预算标题后。当前任务放在最下方，任务详情不再常驻显示，只通过更淡的 info 圆圈悬浮提示。

第五，源端与目标端图标按已确认设计稿重新绘制：InfiniCLOUD 使用蓝色卡通云图标，坚果云使用卡通坚果图标，不再显示源端或目标端括号说明。左上角 DavBridge 下方的 `Zotero 镜像` 继续隐藏，总览页顶部 `你好，DavBridge` 不恢复。

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

用户下一步需要在真实 Windows 上运行 `fc9b2e6e...` 对应的 candidate，重点检查：

1. 总览是否与已确认设计稿一致，尤其是三行顺序、对齐、留白和整体轻量感。
2. InfiniCLOUD 蓝色云图标与坚果云卡通坚果图标在真实 WebView2 中是否自然。
3. `源端对账` 与 `变化修复` 的淡灰圆底绿色 `✓` 是否清晰但不抢视觉。
4. 镜像覆盖的 `verified / total` 无千位分隔符、最右侧大百分数和进度条是否协调。
5. 流量预算是否稳定显示 1 位小数，重置日期时间是否位于标题后，上传和下载的大百分数是否合适。
6. 当前任务详情是否只通过淡色 info 圆圈悬浮出现，底部不再常驻说明句；操作按钮仍可正常点击。
7. 桌面右下角继续不出现额度不足或其他 BalloonTip。

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
