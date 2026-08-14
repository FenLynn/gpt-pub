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

当前实验候选：**v0.2.18**

v0.2.18 已完成完整 CI 的准确代码 head：`a29d50af04f3b2d57673eff899d1c2024d0c5f27`

P103 CI run：`31765695661`

Artifact：`DavBridge-v0.2.18-win-x64`

当前阶段：现有 Zotero 固定任务的 UI 最终收口、长期无人值守稳健性与实机验证。

`main` 与 `p103-stable` 继续保持 v0.1.7。v0.2.18 未经用户实机确认，不得提升到 stable/main。

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

v0.2.18 不迁移这些文件，`MigrationState.SchemaVersion` 仍为 1。密码继续使用 Windows DPAPI CurrentUser。

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

## v0.2.17 UI 与运行事实

v0.2.17 完成了主要 UI 收口：

1. 顶部路线由 `UiRouteOverallV0215` 独占绘制，50 px 端点图标与中央状态通道形成固定布局。
2. 左侧任务栏与主内容区增加 1 px 低对比度分界线。
3. 当前周期重排为单行：`上传 [bar 内数值]  下载 [bar 内数值]  校准`。
4. 主操作按钮改由 `PrimaryActionSurfaceV0217` 独占绘制，播放、暂停和等待状态整体居中。
5. 底部消息栏小喇叭与文字统一垂直中心，并增加消息优先级。
6. 新增统一 UI 几何 token `UiGeometryV0217`。
7. 新增单实例 `SingleInstanceGateV0217`，第二次手工启动唤醒已有窗口。
8. 普通双击显示主页面，Windows 开机启动继续通过 `--background` 后台运行。
9. 新增 700×520、880×570、1200×760，以及 125% 和 150% DPI 布局自检。

用户对 v0.2.17 的实机截图确认：淡分界线、当前文件条、周期单行、bar 内流量、校准位置、主按钮和底栏均明显改善；同时发现两个未真正收口点：顶部两端图标仍偏外，总体进度仍可能短暂显示千位逗号 `1,526 / 6,929`。

## v0.2.18 精修事实

v0.2.18 只处理上述实机反馈，不扩产品功能：

1. 顶部路线两端图标从原约 14 至 22 px 内缩范围改为约 28 至 38 px，自适应随窗口宽度变化，左右“图标 + 名称”整体进一步向中央收拢。
2. 名称与状态箭头间距由 5 px 收紧到 4 px，使左右端点视觉组更紧凑。
3. 总体进度去千位逗号不再依赖独立 180 ms 刷新碰运气。`UiFinalPolishV0217` 直接订阅 Dashboard 自己的 250 ms Timer，并且注册顺序位于 Dashboard `Tick()` 之后，因此每次 Dashboard 写完 `N0` 文本后，同一 UI 消息周期立即规范化，再进入绘制。
4. 该规范化只处理总体计数和问题计数，不再对当前文件名做数字替换，避免文件名本身若包含类似 `1,234` 的合法字符被误改。
5. 不修改迁移引擎、WebDAV 行为、quota 账本、StrongVerified、state/config/secrets 或任何持久化 Schema。

## 当前自动验证

v0.2.18 准确代码 head `a29d50af04f3b2d57673eff899d1c2024d0c5f27` 已通过：

- Core Smoke；
- 条件 PUT、WriteUnknown、412 reconciliation、最终 Manifest、HTTP 明文拒绝等事务 Smoke；
- Windows framework-dependent single EXE publish；
- Runtime boundary；
- 真实 Windows UI 构造 self-test；
- 三种窗口尺寸：700×520、880×570、1200×760；
- 125% 与 150% DPI 缩放布局自检；
- 设置页保存/取消尺寸与文字裁切检查；
- SHA256 生成与 Artifact 上传。

P103 CI run：`31765695661`

Artifact 名称：`DavBridge-v0.2.18-win-x64`

Artifact ZIP digest：`sha256:49cee8d9f8d8b72b3615870bc542c7e09feb69fa56086484e2662aad303faf34`

EXE SHA256：`8bb456bee9bca837b10b7b1116676a0db924244e4a08ac5056ff0bf2079fbe9f`

CI 在 self-test 失败时会直接打印 `self-test.json` 的具体场景与原因，避免仅显示 exit code 1。

## 当前待实机验证

下一轮优先检查 v0.2.18，不增加新功能：

1. 顶部 InfiniCLOUD 与坚果云图标是否比 v0.2.17 再向中间收得自然，图标、名称、箭头之间是否已经协调。
2. 总体进度是否稳定保持 `1526 / 6929` 一类无逗号数字，不再闪回 `1,526 / 6,929`。
3. 左侧与主区淡分界线继续保持低存在感。
4. “暂停断点 ...”继续保持视觉上下居中。
5. 当前周期继续保持一行：上传 bar、下载 bar、最右校准，GB 数值稳定显示在 bar 内。
6. 主按钮图标与文字继续作为整体居中且不裁字。
7. 底栏小喇叭和消息文字继续严格垂直居中。
8. 双击第二个 DavBridge 时不启动第二迁移进程，而是唤醒现有窗口。
9. 100%、125%、150% Windows 缩放下无明显重叠或裁切。
10. 暂停、托盘退出、重新打开无异常。
11. 原有 state、配额账本和 StrongVerified 记录必须保持原样。

用户实机确认后，下一步优先做历史 UI 源清理和 stable 固化，不再继续向主页堆功能。

## 后续代码清理原则

v0.2.18 实机确认之前，不删除 v025、v026、旧 UiPolish、UiLayoutPolishV0213、UiInteractionPolishV0211 等历史 UI 文件，以保留回退能力。

实机确认后，可以逐步删除或归档已经退出运行链的旧 UI generations，并把最终 UI 合并为少数正式类。代码清理不得改变迁移引擎、WebDAV 安全语义或本地 Data。

## 后续低风险内核候选

这些不阻塞 v0.2.18 实机验证：

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
