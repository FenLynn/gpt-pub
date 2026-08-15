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

当前实验候选：**v0.3.1**

v0.3.1 完成完整 CI 的准确代码 head：`6b21f9e7bc516b21b1d2b2bc9178ff7a52b3d454`

P103 CI run：`31870732926`

CI 结论：**success**

Artifact：`DavBridge-v0.3.1-win-x64`

GitHub Artifact ZIP SHA256：`e70fa07b629841417a4bcb514c629ca467925b330b0796bb0d37e749f24eb71d`

EXE SHA256：`7f3727393ca1cc12e4d2ed062c7e54874831d620e90c7082d781767cae90ef39`

本 HANDOFF 之后存在 `[skip ci]` 纯文档提交时，不得把文档 head 当成已构建代码 head。

`main` 与 `p103-stable` 继续保持 v0.1.7。v0.3.1 未经用户实机确认，不得提升到 stable 或 main。

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

## v0.3.1 UI 大精修

v0.3.0 实机评审发现两个明确问题：默认窗口纵向内容没有真正收口，底部存在遮挡并出现不必要滚动条；顶部新路由把此前已经认可的云盘 Logo 简化成了圆点。

v0.3.1 只修改显示与布局，不改变迁移、对账、配额、回收站或 DELETE 安全状态机。

运行时结构保持：

```text
总览 | 转移 | 回收站                     ⚙
```

本轮完成：

1. 默认 900×620 窗口改成真正的 Fill 布局，不再依赖 `Dock=Top + AutoSize + AutoScroll` 撑开页面。
2. 默认窗口关闭内容区横纵滚动条；只有低于正常工作尺寸的极限小窗才启用紧凑滚动兜底。
3. 总览重新分配固定与弹性行高，底部主操作拥有独立剩余空间，不再被页面底部截断。
4. 顶部 Header、Cycle、Tab、主操作、回收站按钮和表格层级统一为低饱和蓝灰体系。
5. 路由恢复 InfiniCLOUD 橙色云形矢量 Logo 和坚果云橡果 Logo，继续保留用户认可的双右箭头。
6. 新 Logo 路由独占原路由行，旧 v0.3.0 圆点路由退出布局测量和绘制，避免两个控件争同一 TableLayout 单元格。
7. 转移页重新压缩标题、摘要卡和当前任务区的垂直间距。
8. 回收站缩减无效留白，保持默认零选择和状态变化时刷新，不恢复 250 ms 表格重建。
9. 新 UI self-test 把默认无滚动条、底部主按钮不越界、Logo 路由完整可绘制加入硬门。

极限 `700×520` 场景仍保留紧凑兜底，不把它定义为默认无滚动条窗口。默认 900×620、1200×760、125% 和 150% DPI 都必须通过新硬门。

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

## v0.3.1 自动验证

准确代码 head：`6b21f9e7bc516b21b1d2b2bc9178ff7a52b3d454`

P103 CI run：`31870732926`

CI：**success**。

通过：

- scope；
- Core Smoke；
- Cycle `yyMMdd` 与跨时区回归；
- 回收站跨周期与 DELETE 安全回归；
- 原条件 PUT、WriteUnknown、412 reconciliation；
- WaitQuota NO-WRITE 回归；
- Windows x64 framework-dependent 单 EXE publish；
- Runtime boundary；
- Windows 隔离 self-test；
- 默认 900×620 无横纵滚动条硬门；
- 默认底部主操作不越界硬门；
- Logo 路由绘制尺寸硬门；
- 1200×760、125%、150% DPI 布局；
- SHA256；
- Artifact upload。

Artifact：`DavBridge-v0.3.1-win-x64`

GitHub Artifact ZIP SHA256：`e70fa07b629841417a4bcb514c629ca467925b330b0796bb0d37e749f24eb71d`

EXE SHA256：`7f3727393ca1cc12e4d2ed062c7e54874831d620e90c7082d781767cae90ef39`

## 当前实机断点

下一步只做 v0.3.1 实机 UI 验收，不提升 stable：

1. 默认窗口打开后不应出现内容区滚动条。
2. 总览最下方主操作应完整可见，不被底部遮挡。
3. InfiniCLOUD 橙色云形 Logo、坚果云橡果 Logo和双右箭头应同时完整显示。
4. 总览的 Cycle、镜像覆盖、当前任务、当前周期流量在默认高度内完整显示。
5. 转移页与回收站页在默认窗口内没有明显无效留白或控件遮挡。
6. 切换三个 Tab、设置、暂停与继续保持正常。
7. 托盘、重启、迁移和额度记账保持正常。

真实 DELETE 行为在用户实际出现合法跨周期候选以前，只能由 Mock / CI 证明代码逻辑，不能声称已经真实账户验证。

## 事实源

实现事实以源码为准。验证事实以测试与 CI 为准。正式稳定事实以 `main` 与 `p103-stable` 为准。当前实验事实以 `p103-exp` 为准。真实 WebDAV 行为仍以用户账户实测为准。
