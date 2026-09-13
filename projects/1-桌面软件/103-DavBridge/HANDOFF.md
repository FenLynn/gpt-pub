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

当前稳定主线基线为 **v0.4.16**。它已经通过两级 PR 准入并进入 `p103-stable` 与 `main`，但没有创建 tag 或 GitHub Release，因此正式 Release 仍是 v0.4.0。

当前实验候选为 **v0.4.19**，只位于 `p103-exp`。

## 3. 最新完整验证代码基线

当前稳定主线 v0.4.16：

```text
main = p103-stable = 73aefcf04570180bb9526a43cf805aff1e7673b3
```

当前实验版本：**v0.4.19**。

最后完成完整 P103 CI 的代码 head：

```text
723c77948e4a04cbb533b14d1236f99e9a37c801
```

对应 CI：

```text
run 34753217596
scope          success
core-smoke     success
frontend       success
windows-build  success
report-status  success
```

Windows candidate：`DavBridge-v0.4.19-win-x64`

Artifact ID：`10316692654`

Web UI preview Artifact ID：`10316672736`

EXE：

```text
2463325 bytes
SHA256 939c3d602a5f1778336e0da1a4f1404d1a8201bf29b464d00e24171624e51efb
```

Artifact ZIP SHA256：

```text
f6d6efb654cd53cbf82b0ad0e5d0e8a6fb4a33f565e27511144c82e09cd5a3f7
```

该 run 同时验证：
- v0.4.19 event-level operational health ledger；
- v0.4.19 旧 product-experience schema 1 → schema 2 升级、保存、重载与不重复计数；
- About 1100×825 浏览器预览；
- 原 19 项 Core Smoke；
- Windows single EXE；
- Runtime 私人数据边界；
- 既有 native-host self-test。

本段之后若只有文档提交，仍以 `723c77948e4a04cbb533b14d1236f99e9a37c801` 作为最后完整构建验证的 v0.4.19 代码基线。

## 4. 当前分支快照

当前稳定分支关系：

```text
main         73aefcf04570180bb9526a43cf805aff1e7673b3
p103-stable  73aefcf04570180bb9526a43cf805aff1e7673b3
```

`p103-exp` 已在 stable/main 之上进入 v0.4.18 开发。由于本文件本身也是最后 CI 触发提交的一部分，新对话必须实时查询 `p103-exp` head、ahead/behind 与最新成功 CI，不得把文档中的旧 exp SHA 当作永久事实。

v0.4.18 当前未获得 stable/main 提升授权。

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

v0.4 系列以显示与交互层改造为主。v0.4.13 仅为修复人工暂停语义，对 AppHost 与 MigrationEngine 增加了窄范围的安全暂停协调：不改 WebDAV PUT / GET 算法、不改 StrongVerified 判定、不改 quota、Cycle、Reconciliation 或 DELETE 安全链。不引入 Rust，不使用 Tauri sidecar，不把 WebDAV、凭据、DPAPI、原始 state 或 reconcile 数据搬进 JavaScript。

Web UI bridge 白名单仍只有：

```text
app.getSnapshot
app.openSettings
app.closeSettings
migration.pause
migration.resume
migration.retry
quota.calibrate
recycle.defer
recycle.delete
```

## 6. 最新总览 UI 状态

用户已确认总览页视觉质量良好。`f10ca58b...` 在 UI 与交互冻结轮基础上继续压缩内嵌设置页：四个分类的说明直接挂在顶部分类标签悬浮，不再单独占一整行；安全与维护各项说明直接挂在项目名称本身，取消独立 `ⓘ` 图标；移除重复的“维护工具”小标题；同时收紧顶部分类区、内容区、字段行距、输入框高度和底部按钮区，使设置页在不牺牲可读性的情况下明显减少纵向堆叠。该 head 已通过完整 P103 CI。

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

最新视觉修正进一步解决阶段行的真实布局冲突。旧 `styles.css` 中 `.phase strong { align-self:end; }` 在新 flex 阶段布局中仍然生效，导致“源端对账 / 变化修复 / 等待周期”文字整体落在圆形图标下方。`f10ca58b...` 明确覆盖为垂直居中，并移除此前 1 px translate 补偿。CI 的 1100×620 预览测量中，三组圆形图标中心均为 y=166.5 px，三组文字像素中心也均为 y=166.5 px。

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

### v0.4.7 流量校准与 16:12 默认窗口

第一，流量校准功能从未删除，`MainForm.CalibrateAsync`、`AppHost.CalibrateAsync`、CalibrationAt、上传/下载人工基线和 NextResetAt 始终存在。此前问题是入口被放在“安全与维护”，而“流量与限速”页的悬浮说明还明确让用户去另一个分类寻找，导致功能在产品层面近似不可发现。

第二，v0.4.7 将“本周期流量校准”正式移动到“设置 → 流量与限速”，显示是否已经校准；已经校准时按钮显示“重新校准”。“安全与维护”不再重复放置该入口。

第三，总览“流量预算”的重置日期后新增轻量“校准”按钮。新增 Web UI 白名单命令 `quota.calibrate`，它只能调用原生 `MainForm.CalibrateAsync`，不会把额度写入逻辑搬到 JavaScript。

第四，人工校准现在恢复安全暂停门。如果迁移仍启用或正在执行，先要求用户确认，随后调用原生 PauseAsync 并等待安全停止，只有确认 `IsRunning=false` 后才打开校准窗口。取消或 10 秒内仍未安全停止时，不修改流量账本。

第五，CalibrationDialog 改为与设置页一致的浅色、圆角、紧凑视觉，继续录入“官方上传已用 MB / 官方下载已用 MB / 下次流量重置日期”。重置日 09:00 后真实上传探测的既有语义不变。

第六，v0.4.7 曾把主窗口默认外框尺寸改为 `1100×825`，但其旧窗口迁移条件过窄，只能命中恰好 1100×620 的历史记录。该实现已被 v0.4.8 的 schema v2 一次性 4:3 迁移规则取代。

第七，Web UI 的默认视觉验收基线由 1100×620 改为 `1100×825`。首页使用额外高度重新分配 route 与三条 dashboard 行，转移页也针对高窗口增加队列行、当前执行区与覆盖率区的纵向节奏。旧 870×525、900×620 和 1200×760 预览继续用于响应式回归。

第八，本轮没有修改 DavBridge.Core。额度算法、Cycle、StrongVerified、Reconciliation、回收站与 DELETE 安全门保持不变。

### v0.4.8 4:3 迁移纠正与紧凑布局

v0.4.7 的实现存在两个明确问题，已在 v0.4.8 纠正。

第一，v0.4.7 虽把默认尺寸写成 1100×825，但旧 `window.json` 只有在尺寸恰好等于 1100×620 时才迁移。真实 WinForms 历史 Bounds 可能包含窗口边框差异，用户也可能曾轻微拖动窗口，因此旧扁窗口会绕过迁移，实机继续呈现近似 16:9。v0.4.8 为 `window.json` 引入 `SchemaVersion=2`。所有没有新 schema 的非最大化旧窗口都会一次性按“保持原宽度、`height = width × 3/4`”迁移到 16:12 / 4:3；显示器空间不足时才按 4:3 等比例缩小。迁移完成即写回 schema v2，之后用户主动调整的新尺寸不再被强制覆盖。

第二，v0.4.7 的高窗口 CSS 错误使用可伸缩 `fr` 行并把 quota 区纵向居中，额外高度被灌进“流量预算”模块内部，导致上传/下载上方出现明显无意义空白。v0.4.8 取消这种拉伸方式：首页高窗模式使用紧凑固定节奏，quota 标题与上传/下载数据之间的 grid gap 收紧为 0，quota 顶部 padding 收紧；额外高度只保留为模块外部呼吸空间，不再拉长模块内部。

第三，默认视觉验收仍使用 1100×825 浏览器预览，但 Windows native self-test 额外验证窗口迁移规则。最终 run 34683412041 中 `windowFourThreeMigration=true`。纯迁移测试明确得到：旧 1100×620 → 1100×825，旧 1000×610 → 1000×750。CI runner 自身桌面较小，因此实际测试 Form 被 Windows 限制到 1044×788；测试允许显示器工作区约束，但不允许迁移数学偏离 4:3。

第四，总览中的流量校准入口继续保留：`quota.calibrate` 仅桥接到原生 `MainForm.CalibrateAsync`。迁移运行时必须先原生安全暂停，确认停止后才打开 CalibrationDialog。设置页的正式入口仍位于“流量与限速”，安全与维护不重复放置。

第五，本轮没有修改 DavBridge.Core。额度算法、Cycle、StrongVerified、Reconciliation、回收站、DELETE 与源端只读语义保持冻结。


### v0.4.9 UI 收束与可读性修正

第一，总览流量预算改为真正的垂直居中组合。标题行与上传下载数据整体在模块内居中，上下留白对称，不再用单侧 padding 补视觉位置。

第二，上传与下载进度条增加轻量渐变。上传在安全区使用绿色渐变，下载使用蓝色渐变，警告与危险状态仍分别切换为黄色和红色语义，不改变额度算法。

第三，转移页从长条说明结构重构为简洁决策页。顶部只显示当前队列结论和当前状态，中部使用三块并列概览表示变化修复、普通迁移、人工审查，底部只保留“当前动作或恢复后动作”和总体覆盖率。旧的圆环式“当前执行”图标已删除。

第四，回收站页整体放大正文、表头、状态标签和操作按钮字号，保留原有人工选择与 C# 最终删除安全门，未修改任何删除逻辑。

第五，文档页移除独立左侧目录，改为单列正文阅读布局。正文和标题字号重新配比，页面滚动条默认隐藏，仍可正常滚动。

第六，设置页 InfiniCLOUD 账户字段由冗长的 “Connection ID / User ID” 收敛为 “User ID”，文本输入框统一扩大到 430 px，标签列同步调整，避免在宽窗口内仍出现无意义换行和大片空白。

第七，左下角运行状态块不再重复两次相同状态。现在使用状态图标加主状态文字，第二行只显示不同的路线状态，若路线状态与主状态相同则显示 Cycle。最近活动抽屉同步放大标题、时间、正文和说明字号。

第八，CI 的 1100×825 总览和转移预览已人工检查。总览流量区上下节奏已对称，转移页已收敛为三块概览与一条动作摘要。最终字体渲染和 Windows 原生设置布局仍以用户实机为准。

第九，本轮修改仅涉及 Web UI、SettingsDialog 展示布局和版本号，没有修改 DavBridge.Core、WebDAV、StrongVerified、quota/Cycle、Reconciliation 或 DELETE 安全链。


### v0.4.10 二次 UI 收束

第一，首页蓝色迁移路线继续向目标端延伸，箭头头部与坚果云视觉上连成完整连续路线。三阶段布局改为统一 flex 节奏，阶段内容与连接线使用同一间距规则，普通迁移不再出现与前两项不同的左侧空白。

第二，镜像覆盖模块重新绘制左侧统计图标，并强化蓝色渐变进度条。流量预算左侧紫色上下行箭头改为正式 SVG，线宽加粗；标题与上传下载数据的垂直间距进一步收紧。

第三，设置入口使用更明确的齿轮 SVG。左下角运行状态不再使用字符符号，暂停、运行、等待、网络、审查和完成均改为正式 SVG；暂停状态是纯双竖线，不再出现上下横线。

第四，转移页再次按首页语言重构。三个队列改为无边框分隔行，只常驻图标、标题和数量，解释进入 info tooltip；底部只保留当前动作与总体镜像覆盖，删除大段常驻说明和卡片化结构。

第五，所有 Web UI tooltip 改为全局浮层并 Teleport 到 body，使用最高层级显示，不再依赖局部伪元素，因此不会被首页卡片、overflow 或 stacking context 裁切遮挡。

第六，设置页“账户与端点”字段不再因为已有迁移记录而直接设为 ReadOnly，用户可以正常点击、选择和编辑。安全语义仍保持：若已有迁移记录，保存阶段继续阻止 URL、目录或 User ID 改成另一套端点，应用密码仍可正常更新。也就是说，交互层不再假死，但既有端点身份保护没有降低。

第七，CI 的 1100×825 总览和转移预览已人工复核。转移页已经与首页同样采用轻量分隔行；路线、阶段间距、齿轮图标、覆盖图标和流量图标均进入新视觉。浏览器预览环境缺少完整中文字体，但不影响几何和布局检查，最终字体仍以 Windows 实机为准。

第八，本轮仍未修改 DavBridge.Core、WebDAV、StrongVerified、quota/Cycle、Reconciliation、回收站状态机或 DELETE 安全链。


### v0.4.11 状态与动作分离

第一，顶部迁移路线改为“长线段 + 等距留白 + 箭头 + 等距留白 + 短线段”。箭头左右空白相同，右侧短线段保留后再进入目标端，因此箭头不再贴近坚果云。InfiniCLOUD 名称改为深金色，坚果云名称改为深棕色，与各自图标的核心颜色一致。

第二，镜像覆盖和流量预算图标重新做光学居中。镜像覆盖去掉偏右的额外勾形，只保留居中的三柱统计结构；流量预算上下箭头重新按左右对称轴绘制。

第三，当前任务区重新分为三层。左侧只保留“当前任务”和当前对象名称，对象名称使用普通字重和较低视觉权重；中央独立显示真实持续状态、次级状态以及任务进度；右侧按钮只表达可执行动作。

第四，运行状态和动作彻底分离。按钮始终显示“暂停 / 继续 / 重试 / 前往审查 / 完成设置”等动作词，不再显示“处理中”。用户点击暂停、继续或重试后，中央状态会立即先切换为“正在暂停 / 正在继续 / 正在重试”，待 C# 返回真实 snapshot 后再显示最终 EngineState。

第五，中央任务状态使用和左下角一致的图标语义。运行、暂停、网络、等待、审查、完成沿用同一套 SVG 视觉和状态颜色，避免同一状态在不同位置出现不同表达。

第六，CI 的 1100×825 运行态预览已专门改为“运行中 + 普通迁移 + 63% + 暂停动作”进行检查，确认状态、进度和动作已经分开。转移页预览同时复核，没有出现结构回归。

第七，本轮仍未修改 DavBridge.Core、WebDAV、StrongVerified、quota/Cycle、Reconciliation、回收站状态机或 DELETE 安全链。


### v0.4.12 路线、阶段与流量语义收束

第一，顶部路线改为一个整体 SVG 箭头。左侧直线与箭头头部直接连接，使用圆角端点、圆角连接和浅青到主蓝的柔和渐变，整体更接近 Apple 风格；箭头在路线容器内保留对称的左右呼吸空间，不再由多个独立线段拼接。

第二，三阶段状态图标重新定义。完成状态去掉所有白色或灰色底圆，只显示更粗的绿色对勾；active 状态改为绿色呼吸灯；waiting 使用低对比度小灰点；warning 使用小黄点。普通迁移正在执行时直接显示绿色呼吸灯。

第三，镜像覆盖和流量预算图标修复了旧 grid-template 遗留导致的偏左问题。两个图标容器都强制为单格居中布局，SVG 在水平与垂直方向真正居中。

第四，流量预算颜色语义统一。上传和下载方向箭头都使用蓝色，只表达方向；进度条和百分比数字共同表达风险等级。0 到 59% 为绿色，60 到 79% 为黄色，80% 及以上为红色。分类使用与显示百分比相同的四舍五入值，避免显示 80% 但仍呈黄色。

第五，正常运行状态改用绿色正向语义。左下角运行状态的图标和主状态文字使用绿色；当前任务中央运行状态同样使用绿色。“继续”作为正向动作改为绿色按钮，“暂停”保持中性蓝灰色。

第六，本轮没有修改真实任务进度计算。CurrentProgress 仍来自 WebDAV I/O 的 BytesProcessed / TotalBytes，Web UI 每 500 ms 接收一次 snapshot。小文件可能在两个刷新周期之间就完成，因此常直接看到 100%；较大的文件更容易看到逐步增长，这是正常现象，不按文件名或人为估算进度。

第七，CI 的 1100×825 运行态预览使用 82% 上传、26% 下载、普通迁移 active、63% 当前任务进度进行检查，确认红绿阈值、蓝色方向箭头、呼吸灯、整体箭头和图标居中均生效。

第八，本轮仍未修改 DavBridge.Core、WebDAV 传输算法、StrongVerified、quota/Cycle、Reconciliation、回收站状态机或 DELETE 安全链。


### v0.4.13 安全暂停修正

第一，修复首页“暂停”按钮缺少动作感的问题。可点击时鼠标指针明确变为手型，按下时有轻微按压反馈；命令已发出但正在等待安全停止时使用 progress 指针。

第二，人工暂停从“硬取消当前 run 并立刻宣告 Paused”改为两阶段安全暂停。点击瞬间 Vue 会立即显示“正在暂停”，左下角同步显示“当前文件安全收尾后停止”；按钮不再让用户误以为没有响应。

第三，暂停的真正生效点移动到安全边界。若当前正在处理一个文件，DavBridge 允许该文件完成必要的源端读取、目标上传、目标确认与 StrongVerified 强校验，然后在下一个文件开始前停止。这样不会为了追求瞬时停止而在 PUT 中途制造未知远端写入状态。

第四，AppHost 不再因为人工 Pause 直接取消活动 run token。应用退出、进程取消等生命周期仍可使用 linked CancellationToken 进行硬取消；人工暂停只设置 MigrationEnabled=false / manual pause request，由 MigrationEngine 在安全成员边界检查并落到 EngineState.Paused。

第五，新增 Core Smoke：`safe pause stops before next member`。测试在第一个文件 PUT 后提出暂停请求，要求第一个文件必须最终 StrongVerified，同时第二个文件不得开始 PUT，最终 EngineState 必须为 Paused。该测试已随 run 34707132029 通过。

第六，设置页和需要独占状态的原生操作若触发暂停，会等待 host 真正进入 idle 后再继续，避免“界面写已暂停但后台文件仍在收尾”的竞态。

第七，本轮虽然修改了 `DavBridge.Core/MigrationEngine.cs`，但修改范围只限安全暂停边界判断，不改变 WebDAV 传输、条件 PUT、WriteUnknown reconciliation、StrongVerified、源端只读、quota/Cycle 或删除安全语义。



### v0.4.14 暂停优先级与固定操作槽位

第一，定位并修复“第一次暂停正常，继续后第二次暂停点不动”的真实根因。此前 `MainForm.ResumeNowAsync()` 在恢复后继续 `await _host.RunOnceAsync(...)`，导致 Web UI 的 resume 命令直到整轮迁移结束才返回，Vue 的全局 `busy` 因此长期保持 true。界面虽然通过 snapshot 推送已经显示新的“暂停”，按钮实际上仍处于 disabled。

第二，手动“继续”现在只负责恢复调度并立即返回 UI。真正的 `RunOnceAsync` 由 `RunManualPassAsync` 在后台等待。这样恢复后的 UI 命令不会占住交互锁，后续暂停可以随时提交。

第三，补充 active-run 优先判定。恢复后在源端对账或调度准备阶段，持久 `EngineState` 可能短暂保留上一轮的 `Paused`。现在只要 `IsRunning=true`、`MigrationEnabled=true` 且不处于 pause pending，Web snapshot 就优先暴露 `pause` 动作。暂停因此覆盖整个真实运行 pass，而不只覆盖 MigrationEngine 已写入 Running 之后的阶段。

第四，主操作按钮改为固定 116 px 槽位，不再因为 `primaryAction=none` 从 DOM 消失。运行时可点击“暂停”为黄色轻立体按钮；暂停后“继续”以及“重试”为绿色轻立体按钮；安全暂停中、等待额度、等待网络、已完成等不可操作状态保留同一位置并变成灰色平面按钮。只有可点击按钮使用手型，灰色按钮使用普通或 progress 指针。

第五，安全暂停期间按钮原位显示“正在暂停”，不会引起当前任务行布局跳动。达到安全边界后同一位置切换为绿色“继续”。

第六，本轮没有修改 `DavBridge.Core`、WebDAV 传输、StrongVerified、quota/Cycle、Reconciliation 或 DELETE 安全链。v0.4.13 的 cooperative safe pause 语义保持不变。

第七，准确代码 head `378bb37707a3a5f1d685427edb77294d916acdcc` 已通过 P103 CI run `34726420112` 的 scope、frontend、core-smoke、windows-build 和 report-status。浏览器预览同时复核 1100×825 与 870×525，固定操作槽位没有破坏既有布局。


### v0.4.15 状态语义与活动记录收口

第一，当前任务进度条现在只表示“上传进度”。WebUiHost 不再把源端下载或目标端强校验下载的 I/O 进度复用到该条进度条，只记录目标端 WebDAV Upload 的 BytesProcessed / TotalBytes。上传完成后即使仍在进行目标端重新读取和 StrongVerified，100% 也只表示上传字节已经完成，不表示整个安全事务结束。

第二，任务状态和上传进度进一步分离。安全暂停时中央状态统一显示“正在安全暂停”，说明文字为“当前文件完成安全收尾后停止”；上传进度若存在则单独标记为“上传进度”。按钮文案缩短为“暂停中”，避免固定按钮槽位换行。

第三，左下角全局状态在安全暂停期间只保留“正在暂停 / 安全收尾中”，不再重复长句。暂停命令也不再额外弹出重复 Toast，状态本身即为反馈。

第四，转移页去掉暂停状态重复显示。若 currentTitle、EngineState 和 routeStatus 表达同一状态，右上角只显示 Cycle，底部也不重复同一条状态。

第五，最近活动加入展示层语义合并。短时间内完全相同的活动会去重；“迁移已继续 + 迁移运行中”合并为一条有意义的恢复事件；安全暂停完成后，“迁移已暂停”会覆盖同一轮较早的“正在安全暂停”。持久原始安全账本不受影响。

第六，最近活动滚动条改为默认透明，仅在鼠标进入活动列表时显示轻量滚动条，避免 Win32 风格粗滚动条长期占据右侧。

第七，原生流量校准等模态操作打开时，Web UI 会进入轻度降饱和和半透明遮罩状态，后台主动作不再在视觉上像仍可点击。原生 DateTimePicker / MonthCalendar 仍保留 Windows 原生行为，不改变校准数据语义。

第八，本轮没有修改 DavBridge.Core、WebDAV 传输、StrongVerified、quota/Cycle、Reconciliation、回收站状态机或 DELETE 安全链。


### v0.4.16 可靠性封板

v0.4.16 不再调整已验收 UI，只扩展故障注入与恢复回归，目标是把当前版本冻结成 stable/main 基线。

Core Smoke 在既有 14 项基础上新增 5 项：

1. `repeated pause resume remains idempotent`：连续执行两次安全暂停和两次恢复，已经 StrongVerified 的文件不得重复 PUT，第三轮只处理剩余成员并最终 Complete。
2. `network list failure recovers on retry`：源端 manifest 首次模拟网络失败必须进入 WaitNetwork，下一安全轮次自动恢复且对象只上传一次。
3. `verification network loss recovers without re-put`：目标 PUT 已成功但 StrongVerified 重新 GET 遇到网络中断时，下一轮必须安全接管已上传目标，不得重复 PUT，也不得重复计上传额度。
4. `zero byte object verifies safely`：零字节对象仍必须经过 PUT 和 StrongVerified，上传与下载账本保持 0 bytes。
5. `quota exact boundary is deterministic`：所需字节恰好等于安全剩余额度时允许启动；多 1 byte 时必须在 PUT 前进入 WaitQuota。

至此 Core Smoke 共 19 项。既有 Windows native self-test 继续覆盖 config/state/reconcile/product sidecar 的 .bak 恢复、runtime session、窗口迁移和 background wake signal。既有 smoke 继续覆盖 SourceChanged、WriteUnknown/crash recovery、既有副本安全接管、冲突保护、超大对象和大 manifest。

自动化仍不能替代真实 InfiniCLOUD / 坚果云服务、Windows 实际睡眠/唤醒和长期多日运行，因此 v0.4.16 进入 main 只表示可发布稳定基线，不自动创建正式 Release。


### v0.4.17 长期运行摘要

第一，启动本轮前重新核对仓库后确认：脱敏诊断导出其实从 v0.4.4 就已经存在于“设置 → 安全与维护”，因此 v0.4.17 不重复增加第二套诊断功能。

第二，v0.4.17 只增强“关于”页的长期后台运行可见性，不修改首页和迁移安全链。关于页在原版本、构建、运行环境、运行会话、初始化、引擎和界面信息下方增加轻量 2×2 运行摘要。

第三，摘要只使用既有安全 snapshot 数据，不新增私人数据持久化：
- 本周期：Cycle 与当前上传 / 下载已用量；
- 最近完成：最近活动中可识别的清单或迁移完成事件；
- 最近暂停：最近一次暂停事件；
- 最近异常：最近一个 warning 活动；若没有则明确显示暂无近期异常。

第四，以上摘要只来源于已有通用活动和 quota DTO，因此不包含真实 Zotero 文件名、远端路径、凭据或 SHA。活动历史只有有限窗口，摘要是“最近可见事件”，不是永久审计记录。

第五，关于页继续去仪表盘化。新增摘要使用细分隔线和紧凑文字，不加入复杂图表、大卡片或新的导航层级。

第六，P103 CI 新增 `about-1100x825.png` 浏览器预览，并保持原有 Overview / Transfer 多尺寸预览。准确代码 head `958744f8703b567c634c0296530b21623d922381` 已通过 run `34751011145` 全部 jobs。

第七，本轮没有修改 DavBridge.Core、WebDAV、StrongVerified、人工暂停、quota/Cycle、Reconciliation、回收站状态机或 DELETE 安全链。


### v0.4.18 近 24 小时运行健康

第一，本轮延续 v0.4.17 的 About 页长期运行方向，但不新增图表，也不新增高频持久化采样。统计直接使用既有 `product-experience.json` 通用活动记录和当前安全 snapshot。

第二，ProductExperience 新增 `OperationalHealthV048`，默认统计近 24 小时：
- warning 活动数量；
- 实际进入“等待网络”的次数；
- 真正完成“迁移已暂停”的次数；
- “当前清单完成”的次数。

第三，About 页新增一条紧凑健康状态条，显示“完成 / 网络等待 / 警告 / 暂停”，并同时显示当前 StrongVerified 数量与当前 backlog。没有折线图、柱状图或大卡片。

第四，活动 sidecar 最多保留 40 条事件。统计会判断近 24 小时窗口是否完整：如果已保留的最早事件早于 24 小时边界，或活动总数不足上限，则可以认为 24 小时窗口完整；否则 UI 会明确写“近期活动窗口 / 活动窗口可能已截断”，避免把不完整样本误称完整 24 小时统计。

第五，新增 deterministic native self-test `ValidateOperationalHealthForSelfTest()`，固定构造 24 小时内外的暂停、网络等待、warning 与完成事件，验证统计边界。P103 Windows CI 强制要求 `operationalHealthSummary=true`。

第六，统计不写入任何新的真实文件名、路径、URL、凭据或 SHA，也不参与迁移正确性判定。

第七，本轮没有修改 DavBridge.Core、WebDAV、StrongVerified、暂停控制、quota/Cycle、Reconciliation、回收站或 DELETE 安全链。

v0.4.18 功能实现 head：

```text
e76e4deda04ad0a5a9839e8a9781c0dbcce004d5
```

最终验证必须以本轮文档同步后的最新 `p103-exp` head 为准，不能只复用中间 run。


### v0.4.19 事件级健康账本

第一，v0.4.18 的近 24 小时统计直接依赖最近 40 条通用活动，因此在高频状态变化时可能只能给出截断窗口。v0.4.19 将这部分改为独立的匿名事件账本，不再依赖活动列表长度。

第二，`product-experience.json` 的 UI sidecar schema 提升到 2，并新增：
- `OperationalLedgerStartedAt`；
- `OperationalEvents`。

每个事件只保存时间戳和匿名类别。当前类别只有 `warning`、`network`、`pause`、`complete`。不保存真实 Zotero 文件名、路径、URL、用户名、凭据、SHA、TransferRecord 或配额核心账本。

第三，事件账本不是定时采样器。只有原本就会写入 product-experience 的低频状态事件发生时才一起记录，因此不会引入新的高频磁盘写入。

第四，旧 schema 1 首次由 v0.4.19 读取时会一次性升级到 schema 2。已有最近活动会尽量投影成已知健康事件，但 `OperationalLedgerStartedAt` 从升级时刻开始，因此升级后的前 24 小时明确显示“健康账本建立中”，不会把有限旧活动冒充完整 24 小时历史。账本累计满 24 小时后，近 24 小时统计不再受最近活动 40 条上限影响。

第五，匿名健康事件只保留最近 8 天，属于可再生 UI 辅助状态。删除 `product-experience.json(.bak)` 最多使健康统计重新建立，不得影响迁移安全、StrongVerified、quota、Cycle、Reconciliation 或 DELETE。

第六，native self-test 同时验证聚合边界与持久化升级。旧 schema 1 sidecar 会被加载、升级、保存、重新加载，然后再次执行升级函数，必须保证事件不重复计数。

第七，脱敏诊断 ZIP 新增聚合后的 `operationalHealth` 摘要，但不导出真实文件事件或私人数据。

第八，本轮没有修改 DavBridge.Core、WebDAV、StrongVerified、人工暂停、quota/Cycle、Reconciliation、回收站或 DELETE 安全链。

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

稳定主线继续保持 v0.4.16：

```text
main = p103-stable = 73aefcf04570180bb9526a43cf805aff1e7673b3
```

当前实验版本为 v0.4.19，只位于 `p103-exp`。

最后完整验证代码 head：

```text
723c77948e4a04cbb533b14d1236f99e9a37c801
```

完整 CI run：`34753217596`，五个 jobs 全部 success。

v0.4.19 的关键变化只有 product-experience 匿名健康账本和 About 运行健康统计可信化，不改变首页、迁移页、暂停控制或 Core。

下一步用户实机重点确认：

1. About 页视觉仍保持轻量；
2. 从 v0.4.18 升级后前 24 小时显示“健康账本建立中”是否自然；
3. 24 小时后统计应继续显示“近 24 小时”，且不再受最近活动 40 条限制；
4. 首页、暂停、迁移和流量界面不得出现任何回归。

v0.4.19 未获得 stable/main 提升授权，也没有 tag / Release 授权。

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
