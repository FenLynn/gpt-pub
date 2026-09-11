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

当前实验候选的产品版本为 v0.4.6，位于 `p103-exp`。它尚未提升到 `p103-stable` 或 `main`，也不是正式 Release。

## 3. 最新完整验证代码基线

最新完成完整 P103 CI 的代码 head：

```text
f74d54363497ca87249918f0662e87601a9e8904
```

对应 P103 CI：

```text
run 34620259308
scope          success
core-smoke     success
frontend       success
windows-build  success
report-status  success
```

Windows candidate：`DavBridge-v0.4.6-win-x64`

Artifact ID：`10272510778`

EXE：

```text
2369115 bytes
SHA256 52576a0b9492b537a02da2debd25cefbf5d645065659e54714abef9ccef09b2a
```

Artifact ZIP SHA256：

```text
90ad27af5111662b2518ffb588f7cd1d6c1539412ccfbb0f00c23d77ebd35337
```

CI 已再次通过 Vue typecheck、production build、浏览器视觉预览、Core Smoke、Windows x64 framework dependent single EXE、Runtime 私人数据边界、native host self test 和 Artifact 生成。

本 HANDOFF 更新发生在该代码 head 之后，因此新对话必须把 `f74d5436...` 识别为最后完整验证的代码基线，而不是把后续纯文档提交误当成新的代码候选。

## 4. 当前分支快照

本轮代码验证时：

```text
main         042329ede97b09cd375ebcf7c55d7245fc56b933
p103-stable  d8d5aed844ca2944c8511c85c0a892dbbd411fc5
validated p103-exp code head
f74d54363497ca87249918f0662e87601a9e8904
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

用户已确认总览页视觉质量良好。`f74d5436...` 在 UI 与交互冻结轮基础上继续压缩内嵌设置页：四个分类的说明直接挂在顶部分类标签悬浮，不再单独占一整行；安全与维护各项说明直接挂在项目名称本身，取消独立 `ⓘ` 图标；移除重复的“维护工具”小标题；同时收紧顶部分类区、内容区、字段行距、输入框高度和底部按钮区，使设置页在不牺牲可读性的情况下明显减少纵向堆叠。该 head 已通过完整 P103 CI。

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
### v0.4.4 产品化补充

最新候选新增启动环境自检、最近活动、脱敏诊断导出、首次初始化状态条、构建身份显示和更明确的转移队列语义。

最新视觉修正进一步解决阶段行的真实布局冲突。旧 `styles.css` 中 `.phase strong { align-self:end; }` 在新 flex 阶段布局中仍然生效，导致“源端对账 / 变化修复 / 等待周期”文字整体落在圆形图标下方。`f74d5436...` 明确覆盖为垂直居中，并移除此前 1 px translate 补偿。CI 的 1100×620 预览测量中，三组圆形图标中心均为 y=166.5 px，三组文字像素中心也均为 y=166.5 px。

总览已经在 CI 的 1100×620 精确预览上做像素测量。InfiniCLOUD 云图形中心约 y=85.5 px，文字视觉中心约 y=85.0 px；目标坚果主体约 y=86.0 px，目标文字约 y=87.0 px。端点图标和文字的光学偏差控制在约 0.5 至 1 px，中央路线与阶段文字也做了对应校正。

转移页不再是两个缺少上下文的大数字卡片，而是固定显示“变化修复 / 普通迁移 / 人工审查”三类队列，先给出当前调度结论，再显示各队列数量、优先级、当前执行项和总体镜像覆盖。

新增 `%LOCALAPPDATA%\DavBridge\product-experience.json` 与 `.bak`。它仅保存 UI 辅助初始化状态、最近 Cycle/EngineState 和通用活动事件，不保存密码、真实 Zotero 文件名、远端目录、TransferRecord、StrongVerified SHA 或核心迁移账本。

“设置 → 安全与维护”新增运行环境自检和脱敏诊断导出。诊断 ZIP 只包含版本、短 commit、构建时间、Windows/.NET/WebView2、EngineState、Cycle、额度、自检、备份存在性、初始化步骤和通用活动，不包含凭据、真实文件名、私人目录或本机私人路径。

About 页新增 v0.4.4、构建短 SHA、构建时间、运行环境摘要和初始化完成度。CI 额外生成 `overview-1100x620.png` 与 `transfer-1100x620.png` 用于默认窗口精确视觉检查。

### v0.4.5 稳定性硬化

第一，后台循环新增可合并的 wake signal。原有定时轮询仍是基础机制，但系统恢复事件可以提前唤醒既有 `RunOnceAsync`。唤醒只改变重新检查的时间，不跳过 quota、Cycle、Reconciliation、人工审查或 StrongVerified 安全门。

第二，新增 `RuntimeResilienceV045`。Windows 从睡眠恢复后约 4 秒请求一次后台重新检查；如果恢复时仍有活动任务，还会安排一次延迟检查。网络恢复且当前为 `WaitNetwork` 时，约 2 秒后提前唤醒后台循环，不再必须等待原来的最长约 10 分钟轮询。

第三，`product-experience.json` 现在支持 `.bak` 回退。若主 sidecar 损坏而备份有效，会从备份恢复并修复主文件。该文件仍然只影响 UI 辅助状态，不参与迁移安全判定。

第四，`startup-error.log` 改为脱敏本地日志。URL、用户目录、APPDATA 与 LOCALAPPDATA 不再原样写入，而且该日志明确不会进入脱敏诊断 ZIP。

第五，Windows native self-test 新增四类备份恢复测试：`config.json`、`state.json`、`reconcile.json` 与 `product-experience.json`。CI 会先生成有效主文件和备份，再故意损坏主文件，确认各自可以从备份恢复。同时验证后台 wake signal 可以安全合并。

第六，Runtime 私人数据边界新增 `startup-error.log`，避免本机异常日志误进入发布 Artifact。

### v0.4.6 运行会话与异常恢复

第一，新增 `RuntimeSessionV046`。单实例门通过后建立 `%LOCALAPPDATA%\DavBridge\runtime-session.json` 活动会话 marker，记录会话 ID、启动时间、最后心跳、版本、构建短 SHA 和通用 EngineState，不记录文件名、路径、URL 或凭据。正常退出时写入 clean exit 并删除 marker；若进程崩溃、断电或被强制终止，marker 会保留供下一次启动识别。

第二，下一次启动若发现上次活动 marker 未 clean exit，会在最近活动中记录“检测到上次异常中断”，并显示上次最后心跳和通用 EngineState。恢复仍完全依赖 `state.json`、`reconcile.json` 与既有安全链，session marker 绝不参与迁移正确性判定。

第三，运行会话每 5 分钟写一次心跳，并在 EngineState 变化时刷新。心跳写入、状态写入和清洁退出使用同一串行锁，避免程序退出时最后一个并发心跳重新写回 marker，造成下次启动误报异常退出。

第四，启动阶段在迁移引擎启动前清理 TempRoot 中由异常中断遗留的 `*.part` 和 `reset-probe-state.json`。这些临时文件本身不参与断点恢复，真实进度仍来自持久化账本。清理只发生在单实例已经确认、没有旧 DavBridge 进程、当前迁移尚未开始的时刻。

第五，About 页只新增一行“运行会话”，显示当前运行时长与上次退出状态。主总览、阶段行、转移页、回收站、设置布局均不做视觉改动。CI 的 1100×620 总览和转移预览已复核，之前冻结的视觉结构保持不变。

第六，脱敏诊断 ZIP 新增 runtimeSession 摘要，包括本次启动时间、运行秒数、上次退出状态、异常中断累计次数、最后心跳以及本次临时残留清理数量和字节数，不包含私人路径或文件名。

第七，native self-test 新增 runtime session marker 解析与中断残留清理测试。Runtime Artifact 私有数据边界新增 `runtime-session.json`，不得进入发布包。


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

v0.4.5 的 UI 辅助状态保存在 `%LOCALAPPDATA%\\DavBridge\\product-experience.json(.bak)`，只保存通用初始化/活动状态，不保存核心迁移数据或私人文件信息。

Runtime、Artifact、Release、源码和 CI 不得包含真实 WebDAV 凭据、私人 Zotero 文件清单、用户日志或其他私人 Data。

## 9. 当前准确断点

用户下一步需要在真实 Windows 上运行 `f74d5436...` 对应的 v0.4.6 candidate，重点检查：

1. 正常启动后 About 页应显示“运行会话”，运行时长正常递增，上次退出状态应合理。
2. 从托盘正常退出后重新启动，不应出现“上次异常中断”。
3. 可在没有真实迁移活动时人工结束 DavBridge 进程一次，再重新启动，最近活动应出现“检测到上次异常中断”，但核心迁移状态不应被 session marker 改写。
4. 如果上一次异常中断遗留 `.part` 临时文件，新启动应自动清理并在最近活动中给出清理数量和总大小，不显示具体私人文件名。
5. 继续测试 v0.4.5 的睡眠唤醒和 WaitNetwork 网络恢复；v0.4.6 不应造成回退。
6. 总览阶段行、InfiniCLOUD/坚果云路线、第二页队列、设置紧凑布局、单实例提示和无桌面 BalloonTip 行为继续保持冻结。

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
