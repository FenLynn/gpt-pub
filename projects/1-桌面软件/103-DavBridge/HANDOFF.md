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

当前实验候选：**v0.2.25**

v0.2.25 完成完整 CI 的准确代码 head：`ec4ba2fb650be9cc46a431b2f38abb4347d5b467`

P103 CI run：`31853244339`

CI 结论：**success**

Artifact：`DavBridge-v0.2.25-win-x64`

Artifact ZIP SHA256：`476c34a34e7ed796962e2484e513c12cd348088f7ab47275f326ad07dd4a9291`

EXE SHA256：`9330b87881ab2c94e4c89b4b8e8e77db71f48893c8bcd883622944b4d9b9e6f9`

本 HANDOFF 之后可能存在 `[skip ci]` 纯文档提交。不得把文档 head 当成已构建代码 head。

`main` 与 `p103-stable` 继续保持 v0.1.7。v0.2.25 未经用户实机确认，不得提升到 stable 或 main。

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

v0.2.25 不迁移这些文件，`MigrationState.SchemaVersion` 仍为 1。密码继续使用 Windows DPAPI CurrentUser。

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

### 校核流量的准确语义

路径探测阶段主要执行 metadata 请求，因此不会按文件大小增加 DavBridge 的坚果云下载账本。

只有找到完整目标 `zip + prop` 组并实际读取坚果云文件内容做 SHA256 时，才把该目标文件实际下载字节加入 `VerifiedDownloadBytesSinceCalibration`。InfiniCLOUD 源文件读取不计入坚果云下载额度。

v0.2.24 实机发现周期下载 bar 在手动校核期间可能不变化。根因不是校核没有记账，而是 `UiDashboardV027.UpdateQuota()` 优先使用 `_lastProgress.Quota`，该快照可能停留在正常迁移进入 WaitQuota 时的旧值。v0.2.25 用 `UiRouteQuotaPatchV0225` 在不改变账本语义的前提下，把该缓存 quota 同步为当前 `Config + State` 的实时 `QuotaPolicy` 快照。目标文件下载并完成记账后，周期下载 bar 应自动更新。

## 重置日与周期 bar

不得把“到达重置日期”直接等同于“服务端额度已经重置”。坚果云只提供重置日期，没有可靠的精确重置时刻。

当前安全流程保持：

1. 到达 `NextResetAt` 日期后先保留旧周期账本，不在 00:00 盲目清零。
2. 当天 09:00 之后执行真实新周期上传探测。
3. 探测失败时保留旧账本，约 1 小时后继续重试。
4. 只有真实探测确认新周期后，才把旧周期 calibration 基线和旧周期计数清零，并推进 `NextResetAt`。
5. 成功探测本身产生的 `probe.UploadBytes` 与 `probe.DownloadBytes` 立即计入新周期，因此 UI 通常回到接近 0 的新周期值，但不承诺数学意义上的绝对 0 B。

这套逻辑避免服务端实际重置时刻晚于本地日期判断时错误恢复大额上传。

## v0.2.23 实机结论

v0.2.23 已在用户真实 WaitQuota 环境运行。用户确认：

- `转移 | 校核` 双视图结构成立；
- 校核进度稳定显示，例如 `382 / 2703`；
- v0.2.22 中“等待下一周期”与校核进度争抢同一进度条的闪烁问题已经解决；
- 功能逻辑继续正常运行。

用户随后要求全面精修 UI，尤其认为颜色仍不够协调，并要求转移页同步调整，同时检查是否存在值得补齐的日常功能。

## v0.2.24 UI 全面精修

v0.2.24 重点是视觉收口和信息补全，不改变迁移核心状态机。

运行时使用 `UiRefinementV0224` 统一路由、阶段条、总体进度、当前进度和周期流量条，减少旧绘制层重复覆盖。

颜色体系统一为低饱和 steel blue、muted teal、sage、amber、coral 与 neutral gray。转移阶段改为连续节点流程，校核页使用独立阶段和进度，路径扫描显示 `x / N · %`，并保留本轮校核摘要和不可启动原因。

手动校核扫描游标仍不持久化，不加入高流量全库 Integrity Scrub，不开放普通 WebDAV 多任务。

## v0.2.25 路由与流量显示修正

用户实机评审 v0.2.24 后提出两点：顶部路由更偏好之前的双右箭头视觉，同时发现手动校核时周期下载 bar 看起来没有变化。

v0.2.25 新增 `UiRouteQuotaPatchV0225`，只处理这两个收口问题：

1. 顶部 InfiniCLOUD 到坚果云的方向图形改回双右箭头语义，继续沿用 v0.2.24 的低饱和颜色，不恢复高饱和旧配色。
2. 周期流量 UI 不再长期停留在旧 `EngineProgress.Quota`。当校核完成一个真实坚果云目标文件读取并已写入 state 后，bar 使用当前账本快照更新。

没有修改 `WaitQuotaReplicaMaintenance`、`QuotaPolicy`、`ResetCycleProbeRunner`、WebDAV 安全链或持久化结构。

## v0.2.25 自动验证

准确代码 head：`ec4ba2fb650be9cc46a431b2f38abb4347d5b467`

P103 CI run：`31853244339`

CI 结论：**success**。

通过：

- P103 Core Smoke；
- WaitQuota 手动全扫描和 PUT 0 回归；
- 条件 PUT、WriteUnknown、412 reconciliation；
- HTTPS only 与最终 Manifest 门；
- Windows x64 framework-dependent single EXE publish；
- Runtime boundary；
- Windows 隔离 self-test；
- 现有多窗口与 DPI UI self-test；
- Artifact 与 SHA256 生成。

Artifact：`DavBridge-v0.2.25-win-x64`

Artifact ZIP SHA256：`476c34a34e7ed796962e2484e513c12cd348088f7ab47275f326ad07dd4a9291`

EXE SHA256：`9330b87881ab2c94e4c89b4b8e8e77db71f48893c8bcd883622944b4d9b9e6f9`

## 下一准确断点

首先实机验证 v0.2.25，不扩核心功能。

重点检查：

1. 顶部双右箭头是否比 v0.2.24 的单一长箭头更自然。
2. 在校核仅做路径探测时，周期下载 bar 可保持不变。
3. 一旦找到完整目标组并实际执行坚果云目标文件 SHA256 读取，目标文件完成后周期下载用量应自动增加。
4. 手动校核上传账本继续保持不因校核而增加。
5. 重置日未确认新周期前旧 bar 不提前清零，真实探测确认后自动进入接近 0 的新周期值。
6. 转移、校核、托盘、退出和重新打开继续正常。

实机确认后，再决定是否清理旧 UI generation，并评估 v0.2.x 是否具备进入 `p103-stable` 的条件。

## 事实源

实现事实以源码为准。验证事实以测试与 CI 为准。正式稳定事实以 `main` 与 `p103-stable` 为准。当前实验事实以 `p103-exp` 为准。真实 WebDAV 行为仍以用户账户实测为准。
