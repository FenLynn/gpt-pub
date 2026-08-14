# DavBridge 对话接续入口

本文件用于在更换 ChatGPT 对话后恢复 P103 DavBridge 项目上下文。

## 当前事实

仓库：`FenLynn/gpt-pub`

项目编号：`P103`

项目路径：`projects/1-桌面软件/103-DavBridge/`

日常开发分支：`p103-exp`

稳定基线分支：`p103-stable`

正式主线：`main`

正式稳定回滚基线：**v0.1.7**

当前实验候选：**v0.2.21**

v0.2.21 已完成完整 CI 的准确代码 head：`cbf98ea410a642fc04016919a551fac6f2645cec`

P103 CI run：`31804480320`

Artifact：`DavBridge-v0.2.21-win-x64`

Artifact ZIP SHA256：`38763a711a26f2d4e03dab8144fdffbdf90f4ef7c517c6ed1d1fa7ef2e44be67`

EXE SHA256：`f40bc2bbc71a63e43ec8a1e67117ec47f74fc686c767feadd8f1738712b44e1e`

当前阶段：Zotero 长周期迁移的无人值守维护、额度等待期既有副本只读接管、源版本漂移处理和最终一致性门控实机验证。

`main` 与 `p103-stable` 继续保持 v0.1.7。v0.2.21 未经用户实机确认，不得提升到 stable 或 main。

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

接续后必须重新核对 `main`、`p103-stable`、`p103-exp`、最新 P103 CI 和 Artifact。若 HANDOFF 后只有 `[skip ci]` 文档提交，不得把文档 head 当作已构建代码 head。

## 产品边界

DavBridge 定位为可靠、低速、可恢复、强校验的单向迁移、备份和镜像工具。

当前用户层只收口现有 Zotero 固定任务，近期不开放普通 WebDAV 新任务。

明确不做双向同步、删除传播、双向冲突合并、rename detection、WebDAV LOCK、客户端加密备份、高流量 Integrity Scrub、定期全量目标 GET 加 SHA256。

用户要求默认无人值守，但必须能知道软件当前正在做什么。后台维护动作必须通过当前文件、阶段和底部消息栏明确展示，不要求日常人工点击维护工具。

## Data 兼容硬规则

核心用户 Data：

`%APPDATA%/DavBridge/config.json`

`%APPDATA%/DavBridge/state.json`

`%APPDATA%/DavBridge/state.json.bak`

`%APPDATA%/DavBridge/secrets.dat`

v0.2.21 不迁移这些文件，`MigrationState.SchemaVersion` 仍为 1。密码继续使用 Windows DPAPI CurrentUser。

`TransferStatus.WriteUnknown` 仍是追加枚举值，不改变既有状态编号。

未来若真正改变持久化格式，必须先完成备份、迁移、等价性校验和回滚路径，不得要求用户手工改 JSON。

## 必须保持的迁移安全语义

1. 源端只读。
2. zip 与 prop 按 Zotero 逻辑组处理。
3. 已有目标副本只有在目标 GET 和 SHA256 与当前源文件完全一致后才安全接管。
4. 新目标采用条件 PUT，避免竞争覆盖。
5. PUT 响应未知时进入 WriteUnknown，再 Reconcile，不立即重复上传。
6. 412 进入协调流程，不盲目覆盖。
7. 上传成功后目标重新 GET 并做 SHA256 强校验，完成后才记 StrongVerified。
8. 源端在传输期间变化时标记 SourceChanged，不接受旧结果为当前版本。
9. HTTPS only，禁止自动跨 authority 重定向。
10. Conflict、WriteUnknown、SourceChanged 不允许被额度等待期维护自动覆盖。

## v0.2.20 实机发现的真实缺陷

用户在实际 WaitQuota 场景截图确认：总体进度 `1526 / 6929`，上传约 `0.95 G / 1 G`，下载约 `2.09 G / 3 G`，界面一直显示等待下一周期，看不到既有副本下载校验。

复核后确认不是单纯 UI 隐藏，而是两个真实问题叠加。

第一，v0.2.20 的自动 NO-WRITE 候选发现先调用坚果云目标目录 LIST，再只从该次可见结果中找未验证 zip 和 prop。真实服务单次目录响应约有 750 项可见窗口。当这些可见项恰好已经 StrongVerified 时，程序不会发现窗口之外的 GoodSync 既有副本，因此不会进入真正的文件 GET 和 SHA256 校验。

第二，`UiLiveProgress.UpdateCurrentActivity()` 只在 `EngineState.Running` 时显示当前文件活动。额度等待期维护属于 `WaitQuota`，所以即使维护发生，当前文件区域也会保持等待下一周期。

因此 v0.2.20 不应再被视为已解决大库额度等待期自动接管问题。

## v0.2.21 直接路径维护

### 1. 不再依赖坚果云目录 LIST 发现候选

新增 `DavBridge.Core/WaitQuotaReplicaMaintenance.cs`。

额度不足时，从 InfiniCLOUD 当前源清单筛选尚未达到当前版本 StrongVerified 的完整 Zotero zip 和 prop 组，然后直接对目标精确路径执行 `GetMetadataAsync`。

目标目录 `ListDirectoryAsync` 不再是该维护路径的候选发现前提，因此可以越过单次约 750 项的可见窗口。

### 2. 仍然严格 NO-WRITE

找到目标完整 zip 和 prop 后执行：

源文件读取并计算 SHA256，目标已有文件读取并计算 SHA256，完全一致后记录 StrongVerified。

若目标内容与当前源不同，记录 Conflict，保持目标原样。

该维护路径没有 PUT。专门回归测试使用一个禁止目标目录 LIST 且任何 PUT 都直接失败的假目标，仍必须成功按精确路径接管完整组。

### 3. 限制探测和下载负载

普通周期每次维护最多直接探测 24 个逻辑组，目标文件实际下载内容上限约 100 MB。

冲刺窗口每次最多探测 48 个逻辑组，目标文件实际下载内容上限约 500 MB。

实际下载还必须满足 `QuotaPolicy.SafeDownloadRemainingBytes`，继续保留下载安全预留。

候选起点按时间轮换，不修改 `state.json` Schema，也不额外保存维护游标。

目标路径 metadata 探测本身不计入目标文件下载账本。只有真正 GET 文件内容并做 SHA256 时，才增加 `VerifiedDownloadBytesSinceCalibration`。

### 4. 与正常迁移串行

新增 `WaitQuotaMaintenanceHostV0221`。

只有在正常 `AppHost` 一轮已经结束、`host.IsRunning == false`、状态仍为 WaitQuota 时，才启动直接路径维护。

正常后台 pass 完成后约 8 秒进入维护。维护自身不使用独立高频周期，不与正常迁移并行争用 WebDAV。

下一次维护由下一轮正常 WaitQuota pass 再次触发，沿用现有 WaitQuota 调度节奏。

### 5. WaitQuota 期间用户可见

`UiLiveProgress` 现在允许显示 WaitQuota 维护活动。

应依次看到类似状态：

`后台只读维护`

`正在按目标路径探测坚果云既有副本 7/24`

找到完整目标组后，当前文件显示具体 zip 或 prop 文件名，并显示：

`正在读取 InfiniCLOUD 源文件并计算 SHA256`

随后：

`正在读取坚果云已有副本并做 SHA256 强校验`

一致后：

`源端与坚果云完全一致，已安全接管，上传 0 B`

底部消息栏直接读取 `WaitQuotaMaintenanceActivity`，不再被普通等待额度提示覆盖。

如果本轮 24 个探测组都没有完整目标副本，也必须明确显示本轮探测数量和结果，使用户能区分“维护没有运行”和“维护已运行但本批没有可下载校验对象”。

## 源版本漂移和最终一致性门

v0.2.20 引入并由 v0.2.21 保留：

1. 每次正常后台 pass 比较已 StrongVerified 记录与当前源 size、ETag、LastModified。
2. 当前源版本变化时标记 SourceChanged，并优先于普通 Pending 组刷新。
3. 所有当前对象都 StrongVerified 后，连续读取两次源 Manifest，中间约 2 秒。
4. 只有两次 path、size、ETag、LastModified 一致，且都对应当前 StrongVerified 版本，才允许 Complete。
5. Complete 后仍沿用约每日重新检查。

## v0.2.21 自动验证

准确代码 head：`cbf98ea410a642fc04016919a551fac6f2645cec`

P103 CI run：`31804480320`

最终 CI 全绿，包括：

- 原 13 项 Core Smoke；
- 条件 PUT；
- WriteUnknown reconciliation；
- 412 条件竞争安全协调；
- HTTPS only；
- SourceChanged 优先刷新；
- 两次最终 Manifest 门；
- 旧 WaitQuota NO-WRITE 回归；
- 新直接路径回归，明确输出 `PASS direct-path wait-quota maintenance bypasses target directory window with PUT=0`；
- Windows framework-dependent single EXE publish；
- Runtime boundary；
- Windows UI self-test；
- SHA256 与 Artifact 上传。

## 当前待实机验证

下一轮首先验证 v0.2.21，不扩新功能。

1. 退出 v0.2.20 后启动 v0.2.21，原 state、流量账本、StrongVerified 和密码配置保持原样。
2. 当前仍处于 WaitQuota 时，正常 pass 结束后约 8 秒，当前文件区域应出现后台只读维护或直接路径探测状态。
3. 应看到 `正在按目标路径探测坚果云既有副本 x/24` 一类提示，而不是始终停在等待下一周期。
4. 找到完整既有副本时，应显示具体 zip 或 prop 文件名，并依次显示源端 SHA256、坚果云 SHA256 阶段。
5. 真正读取坚果云文件内容时，下载账本应增加；该维护动作的上传账本必须不增加。
6. 若本轮没有找到完整既有副本，应明确给出已探测多少组，而不是无提示返回等待。
7. 目标内容不同必须 Conflict，不得覆盖。
8. 暂停、托盘退出、重新打开仍无异常。

用户实机确认后，再决定是否继续提高直接路径覆盖效率，以及是否进入历史 UI generations 清理和 stable 固化。不得提前提升 stable 或 main。

## 事实源

实现事实以源码为准。

验证事实以测试与 CI 为准。

正式稳定事实以 `main` 与 `p103-stable` 为准。

当前实验事实以 `p103-exp` 为准。

本地 Data 兼容以 `数据兼容与升级.md` 为准。

真实服务行为以用户账户实测和明确记录为准。

不得把坚果云未公开的额度耗尽响应、750 项后的分页协议细节或其他推测写成已验证能力。

## 写入规则

用户明确要求继续修改后，修改范围限于 P103 项目目录、P103 CI 和确有必要的 P103 状态入口。日常开发只进入 `p103-exp`。不直接在 `main` 或 `p103-stable` 开发功能。不为 UI 或抽象重构降低 v0.1.7 数据安全语义。提升流程固定为 `exp → stable → main`。
