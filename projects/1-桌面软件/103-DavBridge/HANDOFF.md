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

当前实验候选：**v0.2.22**

v0.2.22 已完成完整 CI 的准确代码 head：`fc182c2dc3f75bbab0c1ff578be313807f5fbbad`

P103 CI run：`31814659352`

Artifact：`DavBridge-v0.2.22-win-x64`

Artifact ZIP SHA256：`d2aba37ab2b83665b942131a99d08e84e553e1d83d8ad6d719d3b2d900e53784`

EXE SHA256：`b8d0a3f72febcb332db4a46556ae968a85c31b99270c2d205cee34234424df29`

当前阶段：Zotero 长周期迁移实机运行，上传额度等待期的既有副本校验改为用户主动启动，继续验证 UI、流量记账和无人值守稳定性。

`main` 与 `p103-stable` 继续保持 v0.1.7。v0.2.22 未经用户实机确认，不得提升到 stable 或 main。

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

正常长期迁移要求无人值守，但重要动作必须可见。额外大量使用剩余下载额度进行历史副本接管，则由用户主动启动，以避免软件在额度等待期未经用户意图持续消耗目标下载额度。

## Data 兼容硬规则

核心用户 Data：

`%APPDATA%/DavBridge/config.json`

`%APPDATA%/DavBridge/state.json`

`%APPDATA%/DavBridge/state.json.bak`

`%APPDATA%/DavBridge/secrets.dat`

v0.2.22 不迁移这些文件，`MigrationState.SchemaVersion` 仍为 1。密码继续使用 Windows DPAPI CurrentUser。

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

## v0.2.20 与 v0.2.21 的实机结论

v0.2.20 首次加入额度等待期 NO-WRITE 维护，但候选发现依赖坚果云目录 LIST。用户实机确认目标目录存在约 750 项单次可见窗口，因此该方式不能覆盖大库。

v0.2.21 改为从 InfiniCLOUD 未验证完整 Zotero 组出发，对坚果云目标精确路径直接 `GetMetadataAsync`，从而不依赖那 750 项目录窗口。

v0.2.21 为避免无人值守维护制造过多 WebDAV 请求，额外自动直探任务设置了：

- 普通周期每轮最多 24 组；
- 冲刺期每轮最多 48 组；
- 普通每轮最多约 100 MB 目标文件下载；
- 冲刺期每轮最多约 500 MB。

用户实机截图证明该任务确实运行，但本轮 24 个组均没有完整的坚果云 zip+prop 副本，因此没有发生目标文件内容 GET，下载账本也没有增加。用户据此提出：既然这是为了主动利用剩余下载额度，应由用户手动启动，而不是后台每轮固定 24 组。

## v0.2.22 手动既有副本校验

### 1. 取消额外自动 24 组直探任务

`Program.cs` 不再挂载 `WaitQuotaMaintenanceHostV0221`，改用 `WaitQuotaMaintenanceHostV0222`。

新的 Host 不会在进入 WaitQuota 后自动启动全库直接路径维护。

注意边界：正常迁移自身若正好遇到已经存在的目标文件，仍然必须按原安全语义 GET 目标并做 SHA256。这是完成该迁移对象所必需的安全验证，不属于本节所说的“额外利用剩余下载额度的全库扫描”。

### 2. WaitQuota 主按钮变成明确的手动入口

当长期迁移处于 WaitQuota 且仍有安全下载额度时，右下角主按钮应显示：

`▶ 校验已有副本`

点击后启动手动 NO-WRITE 全库候选扫描，按钮切换为：

`Ⅱ 停止校验`

再次点击可安全取消。已经完成的 StrongVerified 和下载记账保持保存。

窗口关闭到托盘不等于停止任务；真正退出应用或点击停止才取消本次手动校验。

### 3. 手动模式不再有 24 或 48 组上限

新增 `WaitQuotaReplicaMaintenance.ExecuteManualAsync()`。

手动模式：

- 扫描当前源清单中全部符合条件的未验证完整 zip+prop 组；
- 不依赖坚果云目录 LIST；
- 按目标精确路径探测；
- 不再应用普通 24 组或冲刺 48 组上限；
- 不再应用普通 100 MB 或冲刺 500 MB 单轮下载上限；
- 仍严格受 `QuotaPolicy.SafeDownloadRemainingBytes` 约束，因此不会吃掉配置的下载安全预留；
- 没有 PUT 路径。

手动扫描会在以下任一条件满足时结束：

1. 全部候选扫描完成；
2. 安全下载额度到达预留线；
3. 用户点击停止；
4. 应用退出；
5. 遇到不可继续的异常并安全停止。

### 4. “下载额度没用完”不等于必须强行下载

目标精确路径探测主要是 metadata 请求，DavBridge 的目标下载账本只记录真正读取坚果云文件内容并做 SHA256 的字节。

如果被探测的组在坚果云并不存在完整 zip+prop 副本，就不会为了消耗额度而下载无意义的数据。

只有发现完整既有副本后才执行：

InfiniCLOUD 当前源文件 SHA256 → 坚果云已有文件 SHA256 → 完全一致 → StrongVerified。

因此手动模式的目标是“尽可能利用剩余安全下载额度取得真实强校验进度”，不是人为把下载额度数字用满。

### 5. 手动扫描期间阻止正常后台循环并发

手动校验开始时，`WaitQuotaMaintenanceHostV0222` 会暂时关闭内存中的 AutoResume 入口，使正常后台循环不会在手动扫描持有 WebDAV 连接时同时进入另一轮迁移。

手动校验结束或取消后恢复进入手动校验前的 AutoResume 值。该临时切换不写入用户配置文件。

### 6. 当前文件区显示手动扫描真实进展

新增 `UiWaitQuotaMaintenanceActionV0222`。

路径探测时，当前文件进度条显示类似：

`探测已有副本  137 / 3465`

发现完整目标组后显示具体 zip 或 prop 文件名，并根据实际 I/O 显示百分比。

阶段条中：

- 直接路径探测对应预核验；
- 读取 InfiniCLOUD 对应拉取；
- 读取坚果云已有副本并计算 SHA256 对应核验；
- 该手动流程没有上传阶段。

### 7. 底部小喇叭消息改为横向滚动

长消息不再使用 `EndEllipsis` 截断。

消息变化后先短暂停留，再平滑向左滚动；滚到消息末尾停留后重新循环。小喇叭固定在左侧。短消息宽度足够时保持静态，不滚动。

消息 setter 只有在文本真正变化时才重置滚动位置，因此上层 500 ms 状态刷新不会反复把长消息拉回开头。

## 源版本漂移和最终一致性门

继续保留：

1. 每次正常后台 pass 比较已 StrongVerified 记录与当前源 size、ETag、LastModified。
2. 当前源版本变化时标记 SourceChanged，并优先于普通 Pending 组刷新。
3. 所有当前对象都 StrongVerified 后，连续读取两次源 Manifest，中间约 2 秒。
4. 只有两次 path、size、ETag、LastModified 一致，且都对应当前 StrongVerified 版本，才允许 Complete。
5. Complete 后仍沿用约每日重新检查。

## v0.2.22 自动验证

准确代码 head：`fc182c2dc3f75bbab0c1ff578be313807f5fbbad`

P103 CI run：`31814659352`

最终 CI 全绿，包括：

- 原 13 项 Core Smoke；
- 条件 PUT；
- WriteUnknown reconciliation；
- 412 条件竞争安全协调；
- HTTPS only；
- SourceChanged 优先刷新；
- 两次最终 Manifest 门；
- WaitQuota NO-WRITE 既有测试；
- 直接路径绕过目标目录窗口测试，明确 `PUT=0`；
- 新增 30 组手动扫描回归，唯一目标副本位于第 30 组，明确输出 `PASS manual wait-quota sweep reaches beyond 24 groups with PUT=0`；
- Windows framework-dependent single EXE publish；
- Runtime boundary；
- Windows UI self-test；
- SHA256 与 Artifact 上传。

## 当前待实机验证

下一轮首先验证 v0.2.22，不扩新功能。

1. 从 v0.2.21 退出后启动 v0.2.22，原 state、流量账本、StrongVerified 和密码配置必须保持原样。
2. WaitQuota 状态下，不应再自动开始“x/24”直接路径深度扫描。
3. 右下角应出现可点击的 `▶ 校验已有副本`。
4. 点击后按钮应切换为 `Ⅱ 停止校验`，当前文件区开始显示 `探测已有副本 x / N`，其中 N 为当前全部合格候选数量，不再固定为 24。
5. 找到完整既有目标时，当前文件显示具体 zip 或 prop 和实际 I/O 百分比。
6. 真正读取坚果云文件内容时，下载账本增加；手动校验的上传账本必须保持不变。
7. 点击停止后应安全停下，已经完成的 StrongVerified 不回退。
8. 底部长消息应完整水平滚动，不再只显示省略号。
9. 目标内容不同必须 Conflict，不得覆盖。
10. 暂停、托盘、退出和重新打开仍无异常。

用户实机确认后，再决定是否清理 v0.2.21 的旧自动维护 Host 和历史 UI generations，以及是否进入 stable 固化。不得提前提升 stable 或 main。

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
