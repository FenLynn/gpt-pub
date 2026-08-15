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

当前实验候选：**v0.3.0**

v0.3.0 完成完整 CI 的准确代码 head：`22d321f9811bb047f2ddd96c5a7463225fed51f1`

P103 CI run：`31869299097`

CI 结论：**success**

Artifact：`DavBridge-v0.3.0-win-x64`

Artifact ZIP SHA256：`597232938985882583b808d86db29a473807d6ece4162ac8d1283c2f4ee175de`

EXE SHA256：`37f78cba17fd2eb5a4864b788596371f6858e8e6de42a263f5919a5515c749c3`

本 HANDOFF 之后存在 `[skip ci]` 纯文档提交时，不得把文档 head 当成已构建代码 head。

`main` 与 `p103-stable` 继续保持 v0.1.7。v0.3.0 未经用户实机确认，不得提升到 stable 或 main。

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

## v0.3 产品定位

当前正式开发目标不再是一次性搬运器，而是维护：

> `InfiniCLOUD` 作为唯一 authoritative source，坚果云保存经过 SHA256 核准的单向镜像子集。

源端始终只读。普通后台任务不得自动传播删除。

### StrongVerified 核准基线

每个 `StrongVerified` 对象已经保存：

- Source SHA256；
- Target SHA256；
- Source size / ETag / LastModified；
- Target ETag；
- VerifiedAt。

无论目标最初由 DavBridge、GoodSync 还是人工复制写入，只要已经完成双端强校验，就把这组记录作为历史可信基线。

## Cycle 规则

Cycle ID 使用启动当前坚果云额度周期的真实重置日期，格式固定为 `yyMMdd`。

例如：2026-09-07 的真实重置启动新周期，则 Cycle ID 为 `260907`。

`Config.NextResetAt` 保存下一次重置日期，因此当前 Cycle 从该日期按日历向前一个月推导。不得先转换为运行机器或 CI 的本地时区，否则可能跨午夜换日。

只有真实重置探测通过后，才推进下一重置日期并进入新 Cycle。

## 每周期自动对账

普通 backlog 前自动执行：

```text
确认真实新周期
→ 读取 InfiniCLOUD manifest
→ 与历史 StrongVerified 账本比较
→ 识别源变化、源缺失和新增对象
→ 必要时进入人工回收站门
→ 普通迁移
```

### 源 metadata 未变化

不下载文件内容。

### 源 metadata 变化

只重新 GET InfiniCLOUD 并计算 SHA256。

- SHA 与历史 Source SHA256 相同：只更新源 metadata；
- SHA 不同：进入 `SourceChanged`，优先于普通 backlog 修复目标；
- 源 SHA 改变时，不提前覆盖历史 StrongVerified metadata，直到新目标再次 StrongVerified 后建立新基线。

### 新增对象

只加入普通 backlog，不提高优先级。

## 逻辑回收站

第一次发现一个完整历史 StrongVerified Group 从 InfiniCLOUD 完全消失：

- 只写入 `FirstMissingCycleId`；
- 坚果云不移动、不改名、不删除；
- 当前 Cycle 只能观察。

后续已确认 Cycle 仍完全不存在，才进入人工审查。

人工可以：

- 删除所选；
- 本周期继续保留。

保留只解除当前 Cycle 的阻塞。下一个 Cycle 如果仍缺失，会再次进入人工审查，因此对象可以跨很多周期继续留在回收站。

### 删除硬规则

DELETE 永远不能由后台自动执行。

用户确认删除后仍必须：

1. 再查 InfiniCLOUD 每个准确成员路径；
2. 完整恢复则自动取消删除；
3. 只恢复 zip 或 prop 等部分成员时禁止删除并人工保留；
4. 再核对坚果云目标大小和 ETag；
5. ETag 无法证明身份时，在下载安全额度允许的前提下重新 GET 目标并比对历史 Target SHA256；
6. DELETE 后再次查询准确目标路径；
7. 网络或超时导致结果不确定时先 reconciliation，绝不盲目重复 DELETE。

成功人工删除后，历史 SHA 证据继续保留，TransferRecord 置为 `SourceChanged`。因此源端以后重新出现时会优先恢复目标并重新 StrongVerified。

## 人工操作门

新增 `EngineState.WaitUser`，只追加枚举值，不改变旧数值。

正常对账、源变化识别、新增登记、普通迁移全部自动化。

只有成熟回收站、删除安全异常、Conflict、认证等真正需要人的问题才停止普通迁移，并在总览显示醒目操作入口。

## v0.3 UI

运行时只启用新的 `UiShellV030`，不再挂载 v0.2.x dashboard / activity / refinement / route patch 叠层。

一级入口：

```text
总览 | 转移 | 回收站                     ⚙
```

没有常驻宽左栏。

总览保留：

- `InfiniCLOUD ⇒⇒ 坚果云` 双箭头；
- Cycle；
- 本周期对账 / 修复 / 普通迁移状态；
- 镜像覆盖；
- 当前任务；
- 上传和下载额度；
- 必要时的人工介入横幅。

转移页只区分：

- 优先修复；
- 普通任务。

回收站：

- 待观察；
- 待审查；
- 已处理。

审查表默认零选择，且不会被 250 ms 动画刷新反复重建，避免误选和选择丢失。

## Data 兼容

核心用户 Data 继续保持：

- `%APPDATA%/DavBridge/config.json`
- `%APPDATA%/DavBridge/state.json`
- `%APPDATA%/DavBridge/state.json.bak`
- `%APPDATA%/DavBridge/secrets.dat`

`MigrationState.SchemaVersion` 仍为 1。

v0.3 新增独立旁路：

- `%APPDATA%/DavBridge/reconcile.json`
- `%APPDATA%/DavBridge/reconcile.json.bak`

它只保存 Cycle、首次缺失、人工保留、删除历史和对账摘要，不保存密码，不替代 StrongVerified 或流量账本。

sidecar 丢失的安全方向只能是重新开始删除观察期，不能让任何对象更容易被删除。

## v0.3.0 自动验证

准确代码 head：`22d321f9811bb047f2ddd96c5a7463225fed51f1`

P103 CI run：`31869299097`

CI：**success**。

通过：

- scope；
- Core Smoke；
- Cycle `yyMMdd` 与时区不换日测试；
- 首次缺失 / 跨周期人工审查 / 本周期保留回归；
- 原条件 PUT、WriteUnknown、412 reconciliation；
- WaitQuota NO-WRITE 回归；
- Windows x64 framework-dependent 单 EXE publish；
- Runtime boundary；
- v0.3 新 shell 五组窗口 / DPI 隔离 self-test；
- SHA256；
- Artifact upload。

Artifact：`DavBridge-v0.3.0-win-x64`

Artifact ZIP SHA256：`597232938985882583b808d86db29a473807d6ece4162ac8d1283c2f4ee175de`

EXE SHA256：`37f78cba17fd2eb5a4864b788596371f6858e8e6de42a263f5919a5515c749c3`

## 当前实机断点

下一步只做 v0.3.0 实机验收，不提升 stable：

1. 新的 `总览 / 转移 / 回收站` 三页布局是否自然；
2. 顶部无宽左栏，双右箭头和 Cycle 显示是否满意；
3. 当前历史 state 首次建立 `reconcile.json` 时不会触发任何 DELETE；
4. 周期源端对账运行后，普通迁移和额度记账保持正常；
5. 当前没有成熟回收站对象时，回收站只显示观察或空状态；
6. 将来真实跨周期出现成熟删除候选时，再专门实机验证人工删除事务；
7. 托盘、暂停、继续、设置、重启保持正常。

真实 DELETE 行为在用户实际出现合法跨周期候选以前，只能由 Mock / CI 证明代码逻辑，不能声称已经真实账户验证。

## 事实源

实现事实以源码为准。验证事实以测试与 CI 为准。正式稳定事实以 `main` 与 `p103-stable` 为准。当前实验事实以 `p103-exp` 为准。真实 WebDAV 行为仍以用户账户实测为准。
