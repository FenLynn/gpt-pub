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

当前实验候选：**v0.2.23**

v0.2.23 已完成完整 CI 的准确代码 head：`a2570dcb0ba6485b6450e99cd24b62183ef88b90`

P103 CI run：`31817921600`

Artifact：`DavBridge-v0.2.23-win-x64`

Artifact ZIP SHA256：`be5ba3a97dbd01a1630de4913e4de55c781a9961cef6714f8ba6ef756f19c50a`

EXE SHA256：`ab5cb764d6401d0b5bb359230d043c392b51027a14fbb0513a42b308cf80cb10`

当前阶段：Zotero 长周期真实迁移继续运行。上传额度等待期的既有副本校核保持用户主动启动，v0.2.23 重点解决 v0.2.22 实机出现的“等待下一周期”和校核进度争抢同一进度条而闪烁的问题。

`main` 与 `p103-stable` 继续保持 v0.1.7。v0.2.23 未经用户实机确认，不得提升到 stable 或 main。

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

接续后必须重新核对 `main`、`p103-stable`、`p103-exp`、最新 P103 CI 和 Artifact。HANDOFF 后若只有 `[skip ci]` 文档提交，不得把文档 head 当作已构建代码 head。

## 产品边界

DavBridge 定位为可靠、低速、可恢复、强校验的单向迁移、备份和镜像工具。

当前用户层只收口 Zotero 固定任务，近期不开放普通 WebDAV 新任务。

明确不做双向同步、删除传播、双向冲突合并、rename detection、WebDAV LOCK、客户端加密备份、高流量 Integrity Scrub、定期全量目标 GET 加 SHA256、HTTP/2 或 HTTP/3 性能追逐。

正常长期迁移要求无人值守，但重要动作必须可见。额外大量使用剩余下载额度进行历史副本接管，由用户主动启动，以避免额度等待期未经用户意图持续消耗目标下载额度。

## Data 兼容硬规则

核心用户 Data：

`%APPDATA%/DavBridge/config.json`

`%APPDATA%/DavBridge/state.json`

`%APPDATA%/DavBridge/state.json.bak`

`%APPDATA%/DavBridge/secrets.dat`

v0.2.23 不迁移这些文件，`MigrationState.SchemaVersion` 仍为 1。密码继续使用 Windows DPAPI CurrentUser。

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
10. Conflict、WriteUnknown、SourceChanged 不允许被历史副本接管流程自动覆盖。

## v0.2.20 至 v0.2.22 的关键实机结论

v0.2.20 的额度等待期维护依赖坚果云目录 LIST。用户实机确认目标 `/zotero` 单次可见窗口约 750 项，因此不能用目录列表覆盖大库。

v0.2.21 改为从 InfiniCLOUD 未验证完整 Zotero 组出发，对坚果云目标精确路径直接探测，不再依赖 750 项目录窗口。为了限制无人值守额外请求，当时普通周期限制 24 组，冲刺期 48 组。

v0.2.22 把额外全库既有副本校验改为用户主动启动的 NO-WRITE 任务。手动模式不再有 24 或 48 组上限，不再使用普通 100 MB 或冲刺 500 MB 单轮限制，只受 `QuotaPolicy.SafeDownloadRemainingBytes` 和下载安全预留约束。

手动校核只有找到完整目标 `zip + prop` 既有副本后才读取文件内容。路径探测主要是 metadata 请求，不为了消耗下载额度制造无意义 GET。完整既有副本的安全链保持：

`InfiniCLOUD 当前源文件 SHA256 → 坚果云已有文件 SHA256 → 完全一致 → StrongVerified`

手动校核期间 `WaitQuotaMaintenanceHostV0222` 暂时关闭内存中的 AutoResume，避免正常迁移循环与手动校核并发。任务结束后恢复原 AutoResume 值，不写入配置文件。

## v0.2.22 实机发现的问题

用户在真实 WaitQuota 状态启动手动校核后，底部消息已经显示类似：

`正在直接探测坚果云既有副本 12/2703`

说明校核任务本身已经运行。但“当前文件”区域会在校核进度和“等待下一周期”之间不停闪烁。

根因已经确认：

1. `UiDashboardV027` 每 250 ms 按正常迁移的 WaitQuota 状态刷新原 `_currentBar` 和原主按钮。
2. `UiWaitQuotaMaintenanceActionV0222` 每 80 ms 又写同一 `_currentBar` 和同一主按钮，显示校核进度。
3. 两套 UI 刷新器同时写同一组控件，产生竞态式视觉闪烁。

这不是 WebDAV、坚果云、流量账本或手动校核核心逻辑故障，而是 UI 状态通道没有隔离。

## v0.2.23 转移 / 校核双视图

v0.2.23 新增 `UiActivityTabsV0223`，主窗口右上角增加：

`转移 | 校核`

### 转移视图

继续使用 `UiDashboardV027` 原有的：

- 当前迁移阶段；
- 当前迁移文件进度；
- 正常迁移主操作；
- WaitQuota 时稳定显示“等待下一周期”。

### 校核视图

使用独立的：

- `VerificationStageTrackV0223`；
- 独立校核进度条；
- 独立校核主操作 surface。

校核阶段显示为：

`探测 | 源读取 | 目标读取 | SHA256`

路径探测存在 `done / total` 时直接显示确定性进度，例如：

`探测已有副本  12 / 2703`

不再使用迁移页面的“当前文件”控件，不再与正常 WaitQuota 状态争抢绘制。

校核运行时可以切回“转移”查看迁移状态，手动校核继续后台运行；再次切到“校核”时继续显示当前校核状态。校核 Tab 在运行时显示轻量运行标记。

`Program.cs` 已停止挂载 `UiWaitQuotaMaintenanceActionV0222`，改为挂载 `UiActivityTabsV0223`。旧类暂时保留在源码中作为历史 generation，不进入运行时。

本轮只改变 UI 组织和版本接线，没有修改 `WaitQuotaMaintenanceHostV0222`、`WaitQuotaReplicaMaintenance`、配额策略、WebDAV 安全语义或持久化格式。

## 源版本漂移和最终一致性门

继续保留：

1. 每次正常后台 pass 比较已 StrongVerified 记录与当前源 size、ETag、LastModified。
2. 当前源版本变化时标记 SourceChanged，并优先于普通 Pending 组刷新。
3. 所有当前对象都 StrongVerified 后，连续读取两次源 Manifest，中间约 2 秒。
4. 只有两次 path、size、ETag、LastModified 一致，且都对应当前 StrongVerified 版本，才允许 Complete。
5. Complete 后仍沿用约每日重新检查。

## v0.2.23 自动验证

准确代码 head：`a2570dcb0ba6485b6450e99cd24b62183ef88b90`

P103 CI run：`31817921600`

CI 结论：**success**。

已通过：

- P103 Core Smoke；
- 现有 WaitQuota 手动全扫描与 PUT=0 回归；
- 条件 PUT、WriteUnknown、412 reconciliation；
- HTTPS only 与最终 Manifest 门；
- Windows x64 framework-dependent single EXE publish；
- Runtime boundary；
- Windows 隔离 self-test；
- 5 个 UI layout / DPI 构建场景；
- Artifact 与 SHA256 生成。

Artifact：`DavBridge-v0.2.23-win-x64`

Artifact ZIP SHA256：`be5ba3a97dbd01a1630de4913e4de55c781a9961cef6714f8ba6ef756f19c50a`

EXE SHA256：`ab5cb764d6401d0b5bb359230d043c392b51027a14fbb0513a42b308cf80cb10`

## 当前待实机验证

下一轮首先验证 v0.2.23，不扩新功能。

1. 从 v0.2.22 退出后启动 v0.2.23，原 state、流量账本、StrongVerified 和密码配置必须保持原样。
2. 主窗口右上角应出现 `转移 | 校核` 两个 Tab。
3. “转移”页在 WaitQuota 时应稳定显示“等待下一周期”，不再与校核进度交替闪烁。
4. 切到“校核”页，应看到独立校核阶段和进度，不再出现迁移页面内容抢写。
5. WaitQuota 且有安全下载额度时，“校核”页按钮应为“开始校核”；运行后变成“停止校核”。
6. 路径扫描应显示完整候选总数，例如 `12 / 2703`，且进度应稳定前进。
7. 校核运行时切回“转移”页不应停止校核，再切回“校核”应继续显示当前状态。
8. 找到完整目标组后应显示具体 zip 或 prop 文件和实际 I/O 百分比。
9. 真正读取坚果云文件内容时，下载账本增加；手动校核上传账本必须保持不变。
10. 点击停止后应安全停下，已经完成的 StrongVerified 不回退。
11. 目标内容不同必须 Conflict，不得覆盖。
12. 托盘、退出、重新打开和正常长期迁移仍无异常。

用户实机确认后，再决定是否清理旧 UI generation，以及是否进入 stable 固化。不得提前提升 stable 或 main。

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
