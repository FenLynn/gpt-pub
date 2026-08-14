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

当前实验候选：**v0.2.16**

v0.2.16 已完成完整 CI 的准确代码 head：`bddcb6c86e6c55ca96b83e806fbceee740668acf`

P103 CI run：`31759063745`

当前阶段：现有 Zotero 固定任务的 UI 收口与长期无人值守稳健性验证。

`main` 与 `p103-stable` 继续保持 v0.1.7。v0.2.16 未经用户实机确认，不得提升到 stable/main。

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

如后续增加完整性巡检，只允许默认使用低流量 Metadata Probe，检查对象存在性、size、ETag、LastModified。只有元数据异常时才升级到已有安全处理流程。

## Data 兼容硬规则

核心用户 Data：

`%APPDATA%/DavBridge/config.json`

`%APPDATA%/DavBridge/state.json`

`%APPDATA%/DavBridge/state.json.bak`

`%APPDATA%/DavBridge/secrets.dat`

v0.2.16 不迁移这些文件，`MigrationState.SchemaVersion` 仍为 1。密码继续使用 Windows DPAPI CurrentUser。

`TransferStatus.WriteUnknown` 追加在既有枚举末尾，不改变既有状态编号。

未来若真正改变持久化格式，必须先完成备份、迁移、等价性校验和回滚路径；内建转换不够安全时必须提供独立一次性转换工具或脚本，不得要求用户手工改 JSON。

## 当前迁移安全语义

现有安全事务必须保持：

1. 源端只读。
2. zip 与 prop 按 Zotero 逻辑组处理。
3. 已有目标副本先 GET 加 SHA256，比对一致才安全接管。
4. 新目标采用条件 PUT，避免竞争覆盖。
5. PUT 响应未知时进入 WriteUnknown，再 Reconcile，不立即重复上传。
6. 412 进入协调流程，不盲目覆盖。
7. 上传成功后目标重新 GET 并做 SHA256 强校验，完成后才记 StrongVerified。
8. 完成前重新获取源 Manifest，避免迁移期间新增附件导致 false Complete。
9. HTTPS only，禁止自动跨 authority 重定向。
10. 高流量 Integrity Scrub 不进入当前路线。

## v0.2.16 UI 事实

v0.2.16 是当前 UI 收口候选，核心变化如下。

1. 顶部路线由 `UiRouteOverallV0215` 独占绘制，旧多层箭头覆盖链已退出运行路径。
2. 中央状态通道改为分段式右向箭头，两端均具有右向尖角语义。
3. InfiniCLOUD 与坚果云图标放大到约 50 px，名称放在图标与箭头之间并向箭头内收。
4. 总体进度使用灰紫渐变，当前文件继续使用蓝色渐变，正常状态使用绿色，额度风险继续使用绿黄红语义。
5. 当前文件移动高光使用两端渐隐，不允许重新出现硬竖线拖尾。
6. `UiInteractionCleanV0215` 不再修改文件阶段，防止把拉取 100% 强制改回拉取。Dashboard 仍是文件阶段真值。
7. 主页面校准入口保留在当前周期区域，主按钮宽度扩大，避免“等待新周期”被截断。
8. 新增底部消息栏 `UiMessageBarV0216`，使用小喇叭图标集中显示重要运行消息。
9. WaitQuota 会在消息栏解释安全上传预算不足，能够从 EngineProgress 中提取当前组仍需字节与剩余预算并转为 MB 显示。
10. 新增 `UiResetCountdownV0216`，周期区域显示重置日期、剩余天数和当日 09:00 后自动探测提示。
11. 设置页保存与取消按钮上移并统一垂直居中。
12. 设置页旧“校准流量”入口在运行时隐藏，说明改为人工校准位于主页当前周期。
13. 普通手工启动显示主页面；Windows 开机启动仍使用 `--background` 进入后台。

## 当前自动验证

v0.2.16 准确代码 head `bddcb6c86e6c55ca96b83e806fbceee740668acf` 已通过：

Core Smoke；

条件 PUT、WriteUnknown、412 reconciliation、最终 Manifest、HTTP 明文拒绝等事务 Smoke；

Windows framework dependent single EXE publish；

Runtime boundary；

真实 Windows UI 构造 self test；

SHA256 生成与 Artifact 上传。

Artifact 名称：`DavBridge-v0.2.16-win-x64`

## 当前待实机验证

下一轮不要先加功能，先检查 v0.2.16 实机表现：

1. 顶部双尖状态箭头是否协调，左右图标大小与文字间距是否合适。
2. 底部消息栏是否真正占独立一行，不遮挡左下设置和右下主按钮。
3. WaitQuota 时是否显示中文安全预算说明与距新周期剩余天数。
4. 当前周期下方是否稳定显示剩余天数，不闪回旧重置文案。
5. “等待新周期”主按钮是否完整显示。
6. 设置页旧校准入口是否消失，保存与取消是否上移且文字垂直居中。
7. 拉取达到 100% 后是否继续进入核验或等待响应，不再被旧交互层改回拉取。
8. 暂停、托盘退出、重新打开是否无异常。
9. 原有 state、配额账本和 StrongVerified 记录是否保持原样。

用户实机确认上述项目后，再决定继续微调 UI 或进入 exp 到 stable 的固化流程。

## 后续低风险内核候选

这些不阻塞 v0.2.16 实机验证：

Capability Probe 接入连接诊断并缓存；

WaitNetwork 与 WaitRetry 自适应退避和 jitter；

Config、State、Compat 统一 AtomicFileStore；

低流量 Metadata Probe，仅元数据异常时升级处理。

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
