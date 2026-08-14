# DavBridge 对话接续入口

本文件用于在更换 ChatGPT 对话后恢复 P103 DavBridge 当前事实与准确断点。

## 当前事实

仓库：`FenLynn/gpt-pub`

项目：`P103 DavBridge`

项目路径：`projects/1-桌面软件/103-DavBridge/`

长期分支：

- 日常开发：`p103-exp`
- 稳定候选：`p103-stable`
- 正式主线：`main`

正式稳定回滚基线：**v0.1.7**

当前实验候选：**v0.2.24**

v0.2.24 完成完整 CI 的准确代码 head：`e0cd875d851eec531ae9552ef0b1bf59416ec84a`

P103 CI run：`31842182807`

CI 结论：**success**

Artifact：`DavBridge-v0.2.24-win-x64`

Artifact ZIP SHA256：`539393e65bdded1bfb8cd6083254fb817212c6d1aa75482dd3b06f9c53fabd75`

EXE SHA256：`6f6aee0a4e84755812ab1bb0eced53ae850d7d23c3af5b3ff919540d24fc18ac`

本 HANDOFF 之后可能存在 `[skip ci]` 纯文档提交。不得把文档 head 当成已构建代码 head。

`main` 与 `p103-stable` 继续保持 v0.1.7。v0.2.24 未经用户实机确认，不得提升到 stable 或 main。

## 固定读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. 本项目 `开发约束.md`
5. 本 HANDOFF
6. 本项目 `README.md`
7. 本项目 `阶段记录.md`
8. 本项目 `工作记录.md`
9. 涉及架构时读取 `通用任务架构.md`
10. 涉及本地 Data 与回滚时读取 `数据兼容与升级.md`
11. 涉及重大历史取舍时读取 `设计与演进.md`
12. 涉及代码时读取 `代码/README.md`，以 `代码/DavBridge.sln` 为源码入口

接续后必须重新核对 `main`、`p103-stable`、`p103-exp`、最新 P103 CI 和 Artifact。

## 产品边界

DavBridge 当前定位为可靠、低速、可恢复、强校验的单向迁移、备份和镜像任务管理器。

当前用户层只收口 Zotero 固定任务。近期不开放普通 WebDAV 新任务，不进入双向同步，不传播删除，不自动合并双向冲突，不做高流量 Integrity Scrub。

正常长期迁移要求无人值守。上传额度等待期额外利用剩余下载额度检查 GoodSync 等历史副本时，必须由用户主动启动。

## 核心 Data 与安全语义

核心用户 Data 保持：

- `%APPDATA%/DavBridge/config.json`
- `%APPDATA%/DavBridge/state.json`
- `%APPDATA%/DavBridge/state.json.bak`
- `%APPDATA%/DavBridge/secrets.dat`

v0.2.24 不迁移这些文件，`MigrationState.SchemaVersion` 仍为 1。密码继续使用 Windows DPAPI CurrentUser。

必须保持：

1. InfiniCLOUD 源端只读。
2. `.zip + .prop` 按 Zotero 逻辑组处理。
3. 既有目标只有在目标 GET 和 SHA256 与当前源文件完全一致后才允许安全接管。
4. 新目标采用条件 PUT。
5. PUT 响应未知进入 `WriteUnknown` 后 Reconcile，不立即重复上传。
6. 412 进入协调流程，不盲目覆盖。
7. 上传后重新 GET 目标并计算 SHA256，通过后才记 `StrongVerified`。
8. 源端传输期间变化时进入 `SourceChanged`。
9. HTTPS only，禁止自动跨 authority 重定向。
10. `Conflict`、`WriteUnknown`、`SourceChanged` 不允许被历史副本校核流程自动覆盖。

## WaitQuota 手动既有副本校核

v0.2.22 起，额外全库既有副本检查改成用户主动启动的 NO-WRITE 任务。

手动校核：

- 从当前未验证完整 Zotero 组出发；
- 对坚果云准确目标路径做 metadata 探测，不依赖约 750 项目录列举窗口；
- 不再受原 24 或 48 组单轮上限约束；
- 只受安全下载额度和下载预留约束；
- 只有找到完整 `zip + prop` 既有副本后才读取内容并做 SHA256；
- 主动上传始终为 0 B；
- 完成的 `StrongVerified` 与下载记账即时保存。

安全链：

`InfiniCLOUD 当前源 SHA256 → 坚果云已有副本 SHA256 → 完全一致 → StrongVerified`

手动校核运行时会临时阻止正常后台迁移循环并发进入另一轮 WebDAV pass，结束后恢复原 AutoResume 内存值。

## v0.2.23 实机结论

v0.2.23 已在用户真实 WaitQuota 环境运行。用户确认：

- `转移 | 校核` 双视图结构成立；
- 校核进度稳定显示，例如 `382 / 2703`；
- v0.2.22 中“等待下一周期”与校核进度争抢同一进度条的闪烁问题已经解决；
- 功能逻辑继续正常运行。

用户随后要求全面精修 UI，尤其认为颜色仍不够协调，并要求转移页同步调整，同时检查是否存在值得补齐的日常功能。

## v0.2.24 UI 全面精修

v0.2.24 重点是视觉收口和信息补全，不改变迁移核心状态机。

### 1. 减少叠层绘制

运行时不再挂载旧 `UiVisualPolishV029`、`UiMeterPolishV0219` 和旧 `UiRouteOverallV0215` 绘制层。

新增 `UiRefinementV0224` 作为最终视觉所有者，统一路由、阶段条、总体进度、当前进度和周期流量条，减少多个 Timer 对同一视觉区域重复绘制。

### 2. 统一颜色体系

移除总体进度原先偏紫、当前进度偏亮蓝、周期条高饱和红黄绿的混杂效果。

新体系使用低饱和的：

- steel blue，负责结构和普通进度；
- muted teal，负责当前处理；
- sage，负责安全与低用量；
- amber，负责额度提醒；
- coral，负责接近额度上限；
- neutral gray，负责底色、预留区和次要文本。

顶部路由状态也同步改成柔和浅色底加深色文字，不再使用大面积高饱和色块配白字。

### 3. 转移页同步重做

转移阶段 `预核验 / 拉取 / 核验 / 上传 / 回读` 改为水平引导线加节点的连续流程。

总体、当前文件和周期流量条使用统一圆角、边界和渐变逻辑。WaitQuota 的“等待下一周期”保持静态，不制造无意义动画。

左栏宽度、任务卡识别线、标题、区块间距和底部主按钮均进一步收紧和降权。

### 4. 校核页精修与信息补全

`UiActivityTabsV0224` 使用真正的分段控件，不再使用两个临时按钮外观。校核运行时仅显示一个小型运行圆点。

校核阶段改为：

`探测 → 源读取 → 目标读取 → SHA256`

路径扫描显示确定性百分比，例如：

`探测已有副本 382 / 2703 · 14.1%`

校核结束后不再只显示模糊的“本轮结束”，而是在当前应用会话保留紧凑摘要，例如：

`本轮完成 · 探测 x/y · 完整副本 n 组 · 接管 m 组 · 下载 z`

没有可接管副本、手动停止或异常停止时也显示对应的明确结果。

校核不可启动时，界面明确区分：

- 尚未进入上传额度等待期；
- 下载安全额度不足；
- 当前可开始只读校核。

### 5. 主操作与普通按钮

继续、暂停、开始校核、停止校核统一为低饱和圆角主操作风格。

`校准`、`保存`、`取消`、`重新验证` 等普通按钮同步改成中性轻量风格。

## 功能补全复核结论

本轮没有发现需要立即改变迁移核心的功能缺口。

已经补入 UI 的高价值信息是：

- 校核扫描百分比；
- 校核结果摘要；
- 校核不可用原因；
- 校核运行标识；
- 转移与校核双页都进入 UI self-test。

暂不加入：

1. 手动校核扫描游标持久化。目标端可能被其他客户端继续修改，缓存历史“未命中”会增加陈旧判断风险，当前每次从实时合格候选重新探测更稳妥。
2. 跨应用重启保存“上一次校核摘要”。`StrongVerified` 与流量账本本身已经持久化，摘要只是展示信息，可以后续作为低优先级 UI 能力。
3. 高流量全库 Integrity Scrub。与当前产品边界不符。
4. 新建普通 WebDAV 任务或多任务持久化。当前仍以真实 Zotero 长周期迁移稳定性为先。

## v0.2.24 自动验证

准确代码 head：`e0cd875d851eec531ae9552ef0b1bf59416ec84a`

P103 CI run：`31842182807`

CI 结论：**success**。

通过：

- P103 Core Smoke；
- WaitQuota 手动全扫描和 PUT 0 回归；
- 条件 PUT、WriteUnknown、412 reconciliation；
- HTTPS only 与最终 Manifest 门；
- Windows x64 framework-dependent single EXE publish；
- Runtime boundary；
- Windows 隔离 self-test；
- 5 个窗口与 DPI 场景；
- UI self-test 主动切换并验证“转移”和“校核”两页；
- Artifact 与 SHA256 生成。

Artifact：`DavBridge-v0.2.24-win-x64`

Artifact ZIP SHA256：`539393e65bdded1bfb8cd6083254fb817212c6d1aa75482dd3b06f9c53fabd75`

EXE SHA256：`6f6aee0a4e84755812ab1bb0eced53ae850d7d23c3af5b3ff919540d24fc18ac`

## 下一准确断点

首先实机验证 v0.2.24，不扩核心功能。

重点检查：

1. 转移页与校核页颜色是否自然、低饱和、层级清楚。
2. 顶部路由、标题、Tab、主体内容是否形成统一视觉网格。
3. 转移页阶段线、总体进度、当前文件、周期上传下载和主按钮是否无错位。
4. WaitQuota 转移页继续静态显示“等待下一周期”。
5. 校核页 `x / N · %` 稳定递增，不闪烁。
6. 校核过程中切换到转移页再回来，任务继续运行。
7. 校核完成后摘要正确，StrongVerified 和下载记账不回退，上传账本不因手动校核增加。
8. 窄窗口、125% 和 150% DPI 下不遮挡。
9. 托盘、退出和重新打开保持正常。

实机确认后，再决定是否清理旧 UI generation，并评估 v0.2.x 是否具备进入 `p103-stable` 的条件。

## 事实源

实现事实以源码为准。验证事实以测试与 CI 为准。正式稳定事实以 `main` 与 `p103-stable` 为准。当前实验事实以 `p103-exp` 为准。真实 WebDAV 行为仍以用户账户实测为准。
