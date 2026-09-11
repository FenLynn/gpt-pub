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
dd4e3cb9eb5b7064bd03b79e8857f5bec4d8be6c
```

对应 P103 CI：

```text
run 34590388651
scope          success
core-smoke     success
frontend       success
windows-build  success
report-status  success
```

Windows candidate：`DavBridge-v0.4.3-win-x64`

Artifact ID：`10195444710`

EXE：

```text
2279003 bytes
SHA256 f9472f8fca8b0e2251499f6c61e98ff22a1743abe20ecf599b1661204ae59d32
```

Artifact ZIP SHA256：

```text
7c5ee9b4d63c14aadcfbe8e25bd12f2665190ca837951a0753a75afb728037e5
```

CI 已再次通过 Vue typecheck、production build、浏览器视觉预览、Core Smoke、Windows x64 framework dependent single EXE、Runtime 私人数据边界、native host self test 和 Artifact 生成。

本 HANDOFF 更新发生在该代码 head 之后，因此新对话必须把 `dd4e3cb9...` 识别为最后完整验证的代码基线，而不是把后续纯文档提交误当成新的代码候选。

## 4. 当前分支快照

本轮代码验证时：

```text
main         042329ede97b09cd375ebcf7c55d7245fc56b933
p103-stable  d8d5aed844ca2944c8511c85c0a892dbbd411fc5
validated p103-exp code head
dd4e3cb9eb5b7064bd03b79e8857f5bec4d8be6c
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
app.closeSettings
migration.pause
migration.resume
migration.retry
recycle.defer
recycle.delete
```

## 6. 最新总览 UI 状态

用户已确认总览页视觉质量良好。`dd4e3cb9...` 在 UI 与交互冻结轮基础上继续压缩内嵌设置页：四个分类的说明直接挂在顶部分类标签悬浮，不再单独占一整行；安全与维护各项说明直接挂在项目名称本身，取消独立 `ⓘ` 图标；移除重复的“维护工具”小标题；同时收紧顶部分类区、内容区、字段行距、输入框高度和底部按钮区，使设置页在不牺牲可读性的情况下明显减少纵向堆叠。该 head 已通过完整 P103 CI。

第一，默认窗口由 880×560 调整为 1100×620，使真实 WinForms/WebView2 窗口与已确认参考图保持近似 16:9 的同一比例；原生标题改为简洁 `DavBridge`。Overview 的主要尺寸按该默认窗口逐项标定，较小窗口继续走响应式压缩。悬浮提示保持白色底纹、深色文字、浅边框和柔和阴影。

第二，迁移路径不再使用中间圆形箭头。现在是一条连续横向路径线，箭头头部位于右端，指向坚果云。

第三，迁移阶段位于路径下方并按参考图重新标定。`源端对账` 与 `变化修复` 的 done 状态明确覆盖旧 CSS，固定显示淡灰圆底内的绿色 `✓`，不再被旧规则渲染成实心绿色圆；未完成阶段为淡灰空心圆，阶段之间使用细灰连接线。

第四，三行顺序已经固定为 `镜像覆盖 → 流量预算 → 当前任务`，整体直接融入 workspace 背景，只保留轻量水平分隔线。每行左侧使用柔和功能图标块；覆盖率百分比移动到最右侧，覆盖计数直接使用无千位分隔符的 `verified / total 已校准`。流量预算的上传和下载数值统一显示 1 位小数，百分数放大，重置日期与时间移动到流量预算标题后。当前任务放在最下方，任务详情不再常驻显示，只通过更淡的 info 圆圈悬浮提示。

第五，源端与目标端图标按已确认设计稿重新绘制：InfiniCLOUD 使用黄色卡通云图标，坚果云使用卡通坚果图标，不再显示源端或目标端括号说明。左上角 DavBridge 下方的 `Zotero 镜像` 继续隐藏，总览页顶部 `你好，DavBridge` 不恢复。

第六，侧栏、品牌区、导航字号、选中态、底部状态块、主内容横向留白、功能图标尺寸、百分比字号、进度条长度、配额双列分隔和底部操作按钮均按参考图同比例重新标定。坚果云图标改为竖直对称主体，避免旧图标视觉倾斜。桌面 BalloonTip 通知继续永久关闭。

第七，转移、回收站、文档与关于页已统一到总览相同的 Apple / Google 风格。当前普通页面已取消重复的顶部标题栏；转移页两类任务解释与当前任务详情改为悬浮提示；回收站去掉传统白色表格外框，使用轻量 segmented tabs 与浮动行；文档 FAQ 折叠项与关于页继续去卡片化。文档 open-book 图标保持严格左右对称结构。

第八，首页主操作按钮按 EngineState 重新定义：Running 显示真正 SVG 双竖线“暂停”；Paused 显示“继续”；WaitRetry 显示“重试”；WaitQuota、WaitNetwork、WaitUser 与 Complete 默认不显示无意义操作；有人工审查时显示“前往审查”；未配置时显示“完成设置”。托盘菜单的继续/暂停也改为同一状态映射，Running 只允许暂停，Paused/WaitRetry 允许继续或重试，其余等待状态不再给出无意义操作。新增 `migration.retry` 白名单命令，但仍复用现有 C# 安全恢复路径。

第九，设置页已从独立 SettingsDialog 弹窗改为主窗口右侧内嵌原生设置面板。实现方式继续保留 C# 原生敏感控件与 DPAPI 边界。二级分类位于顶部横向切换；重复的“设置”和分类大标题已移除。分类级说明直接挂在顶部分类标签悬浮，不再在内容区占独立提示行；安全与维护各项说明直接挂在项目名称本身，不再显示独立 `ⓘ`。TextBox 与 NumericUpDown 使用自绘浅色圆角 field surface，字段按类型维持适中固定宽度；顶部、字段、分组与页脚垂直间距进一步压缩。新增 `app.closeSettings` 用于从设置页直接切换其他导航；密码与凭据仍不进入 JavaScript。新增 `SilentNotifyIcon.cs`，继续保留 Windows 托盘图标、双击恢复、右键菜单、暂停、继续和退出功能，但所有 `ShowBalloonTip` 调用均成为 no op。额度不足、完成、重试等待等状态不再推送 Windows 右下角桌面气泡。状态仍在 DavBridge 自身 UI 内显示。

第十，新增交互反馈总线 `UiFeedbackBusV044`。普通成功、提示与可恢复警告在主 UI 右上角显示自动消失且可手动关闭的轻量 notice；安全相关 Yes/No 确认、DELETE 最终门、异常详情和失败详情仍保留原生 MessageBox，不降低安全门。

第十一，新增 `WindowPlacementV044`，将窗口位置、尺寸与最大化状态保存在 `%LOCALAPPDATA%\\DavBridge\\window.json`。窗口关闭到托盘或正式退出时保存，下次启动恢复；若旧位置已离开当前显示器范围则自动忽略并回到默认位置。MainForm 与 SettingsDialog 启用 DPI AutoScale，用于 100%、125%、150% Windows 缩放。

第十二，单实例行为改进：交互式再次启动时仍严格禁止第二实例，并唤醒现有 DavBridge，同时明确提示“当前 EXE 未作为新实例启动”；若用户是在切换新版 EXE，会提示先从托盘退出旧实例。`--background` 的重复自启动不再唤醒现有窗口，也不弹提示。

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

窗口外观状态另外保存在 `%LOCALAPPDATA%\\DavBridge\\window.json`，仅包含窗口 X/Y、宽高和最大化状态，不包含账户、文件清单或凭据。

Runtime、Artifact、Release、源码和 CI 不得包含真实 WebDAV 凭据、私人 Zotero 文件清单、用户日志或其他私人 Data。

## 9. 当前准确断点

用户下一步需要在真实 Windows 上运行 `dd4e3cb9...` 对应的 candidate，重点检查：

1. 100%、125%、150% Windows 缩放下，总览、转移、回收站、文档、设置、关于的字号、留白与交互是否仍统一。
2. 普通成功与提示是否只在 DavBridge 内显示右上角轻量 notice，不再出现老式信息 MessageBox；高风险确认仍应保持原生确认框。
3. Running / Paused / WaitRetry / WaitQuota / WaitNetwork / WaitUser / Complete 下首页按钮与托盘继续/暂停是否一致且无无意义操作。
4. 调整窗口尺寸、位置或最大化后关闭到托盘并正式退出，再启动时是否正确恢复；更换显示器后不应恢复到屏幕外。
5. 已有实例运行时手动双击另一个 EXE，是否明确提示“当前文件没有启动为第二实例”；后台重复自启动不应唤醒窗口。
6. InfiniCLOUD 黄色云标、坚果云图标、阶段淡灰圆与绿色 `✓`、流量和镜像百分数继续保持此前确认的视觉。
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
