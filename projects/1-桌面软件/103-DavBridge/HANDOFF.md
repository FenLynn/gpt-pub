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

当前实验候选：**v0.2.20**

v0.2.20 已完成完整 CI 的准确代码 head：`09a7291ce9400b0e324c177aa678e494e59765b3`

P103 CI run：`31783815480`

Artifact：`DavBridge-v0.2.20-win-x64`

Artifact ZIP SHA256：`1149689116698cab890195dd47e0ea540c477bc8acdb0f44a2f03343b2abf234`

EXE SHA256：`6d78135e5f3c22a648dd67b651c0239cc3a03214c5495929bf5d306dfa645ac6`

当前阶段：Zotero 长周期迁移的无人值守维护、源版本漂移处理、额度利用和最终一致性门控实机验证。

`main` 与 `p103-stable` 继续保持 v0.1.7。v0.2.20 未经用户实机确认，不得提升到 stable/main。

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

明确不做双向同步、删除传播、双向冲突合并、rename detection、WebDAV LOCK、客户端加密备份、HTTP/2 或 HTTP/3 性能追逐、高流量 Integrity Scrub、定期全量目标 GET 加 SHA256。

用户要求默认无人值守，但必须能知道软件当前正在做什么。后台维护动作通过当前状态、当前文件和底部消息栏明确展示，不要求日常人工点击维护工具。

## Data 兼容硬规则

核心用户 Data：

`%APPDATA%/DavBridge/config.json`

`%APPDATA%/DavBridge/state.json`

`%APPDATA%/DavBridge/state.json.bak`

`%APPDATA%/DavBridge/secrets.dat`

v0.2.20 不迁移这些文件，`MigrationState.SchemaVersion` 仍为 1。密码继续使用 Windows DPAPI CurrentUser。

`TransferStatus.WriteUnknown` 仍是追加枚举值，不改变既有状态编号。

未来若真正改变持久化格式，必须先完成备份、迁移、等价性校验和回滚路径，不得要求用户手工改 JSON。

## 必须保持的迁移安全语义

1. 源端只读。
2. zip 与 prop 按 Zotero 逻辑组处理。
3. 已有目标副本先 GET 加 SHA256，比对一致才安全接管。
4. 新目标采用条件 PUT，避免竞争覆盖。
5. PUT 响应未知时进入 WriteUnknown，再 Reconcile，不立即重复上传。
6. 412 进入协调流程，不盲目覆盖。
7. 上传成功后目标重新 GET 并做 SHA256 强校验，完成后才记 StrongVerified。
8. 源端在传输期间变化时标记 SourceChanged，不接受旧结果为当前版本。
9. HTTPS only，禁止自动跨 authority 重定向。
10. 高流量 Integrity Scrub 不进入当前路线。

## v0.2.20 无人值守维护事实

### 1. StrongVerified 变为“当前源版本已验证”语义

每次正常后台 pass 都会重新读取低流量源 Manifest。已经 StrongVerified 的记录会比较当前源端 size、ETag、LastModified 与上次强校验时保存的版本信息。

若源版本发生变化：

- 记录自动标记为 `SourceChanged`；
- 该逻辑组优先于普通 Pending 组处理；
- 若当前上传额度不足，则保留等待下一可用上传周期；
- 不把旧 StrongVerified 永久当成完成。

源端候选真正进入处理时仍会重新读取和计算 SHA256，因此元数据变化不等于盲目上传。

### 2. WaitQuota 自动利用剩余下载额度接管既有副本

上传安全预算不足时，DavBridge 会自动尝试 NO-WRITE 既有副本接管。

只处理：

- 完整 zip + prop Zotero 逻辑组；
- 目标当前可见且两个成员都存在；
- 尚未达到当前源版本 StrongVerified；
- 不属于 SourceChanged、Conflict、WriteUnknown。

流程：

源端读取并计算 SHA256 → 目标端 GET 并计算 SHA256 → 完全一致 → StrongVerified。

该维护路径禁止 PUT。目标副本不同则标记 Conflict，并停止自动接管该组，不覆盖目标。

普通周期每次后台维护最多使用约 100 MB 目标下载预算；冲刺窗口最多约 500 MB。两者始终同时受 `QuotaPolicy.SafeDownloadRemainingBytes` 限制，因此保留既有下载安全预留。

坚果云单次列表达到约 750 项时，只把当前可见结果当作候选集合，不据此判断其余目标文件不存在。

### 3. 最终一致性门

所有当前源对象都达到 StrongVerified 后，不立即宣布 Complete。

必须：

1. 再读取第 1 次源 Manifest；
2. 确认全部仍与当前 StrongVerified 版本一致；
3. 间隔约 2 秒读取第 2 次源 Manifest；
4. 两次清单的 path、size、ETag、LastModified 都一致；
5. 第二次清单也全部属于当前 StrongVerified 版本。

任何新增或变化都会拒绝 Complete，并在下一安全 pass 继续处理。

即使进入 Complete，现有后台循环仍会定期重新运行，因此之后新增或变化的 Zotero 附件仍会被重新发现。

### 4. 用户可见但无需操作

底部消息栏会直接显示关键维护动作，包括：

- 检测到已迁移附件源版本发生变化，正在优先刷新；
- 上传额度不足，正在检查坚果云已有副本；
- 正在进行 NO-WRITE 只读接管；
- 既有副本强校验通过，未发生上传；
- 最终一致性确认第 1 次 / 第 2 次源清单；
- 最终两次源清单一致。

普通后台节奏继续沿用现有策略：正常运行约 5 分钟级复查，WaitQuota 根据重置周期调度且单次等待通常不超过约 6 小时，Complete 约每日复查一次。

## v0.2.20 回归验证

准确代码 head：`09a7291ce9400b0e324c177aa678e494e59765b3`

P103 CI run：`31783815480`

已通过：

- 原 13 项 Core Smoke；
- 条件 PUT；
- WriteUnknown reconciliation；
- 412 条件竞争安全协调；
- HTTPS-only；
- 原最终 Manifest 新对象检测；
- WaitQuota NO-WRITE 自动接管，明确断言 `PUT=0`；
- SourceChanged 组优先刷新；
- 第 2 次最终 Manifest 出现新对象时阻止 Complete；
- Windows framework-dependent single EXE publish；
- Runtime boundary；
- Windows UI self-test 与既有窗口/DPI 检查；
- SHA256 与 Artifact 上传。

## 当前待实机验证

下一轮先验证 v0.2.20，不扩新功能：

1. v0.2.19 已修的进度条文字垂直居中、浅蓝按钮背景在 v0.2.20 中保持正常。
2. 当前处于 WaitQuota 且目标下载额度仍有富余时，底部消息栏应能看到 NO-WRITE 只读接管提示。
3. NO-WRITE 接管期间下载流量账本允许上升，但上传流量账本不得因该维护动作增加。
4. 已经 StrongVerified 的源附件若后续发生变化，应显示源版本变化与优先刷新提示。
5. 不应因 750 项可见列表而把不可见对象判定为不存在。
6. Conflict、WriteUnknown、SourceChanged 不应被 NO-WRITE 维护自动覆盖。
7. 升级前后的 state、配额账本、StrongVerified 记录和密码配置必须保持原样。
8. 暂停、托盘退出、重新打开仍无异常。

用户实机确认后，下一阶段优先清理已经退出运行链的历史 UI generations，再考虑提升 `p103-stable` / `main`。不得提前提升。

## 后续代码清理原则

v0.2.20 实机确认之前，不删除 v025、v026、旧 UiPolish、UiLayoutPolishV0213、UiInteractionPolishV0211 等历史 UI 文件，以保留回退能力。

实机确认后，可以逐步删除或归档已经退出运行链的旧 UI generations，并把最终 UI 合并为少数正式类。代码清理不得改变迁移引擎、WebDAV 安全语义或本地 Data。

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
