# DavBridge 对话接续入口

本文件用于在更换 ChatGPT 对话后恢复 P103 DavBridge 当前事实与准确断点。

## 当前事实

仓库：`FenLynn/gpt-pub`

项目：`projects/1-桌面软件/103-DavBridge/`

长期分支：

- 日常开发：`p103-exp`
- 稳定候选：`p103-stable`
- 正式主线：`main`

正式稳定回滚基线：**v0.1.7**。

当前实验候选：**v0.3.3**。

v0.3.3 完成完整 CI 的准确代码 head：`e088d8c7a918cc1cfba178df47c0da688ddd17a1`

P103 CI run：`31883251539`

CI：**success**。

Artifact：`DavBridge-v0.3.3-win-x64`

Artifact ZIP SHA256：`872b1338cce717b5b2f6b0ee5b00a75f4bae7ce9ad11e1d3821698dcd061aa28`

EXE SHA256：`620206137f34668f47f11b498c2c8a3cb9ba04dcab862f4d53de5803c950ddb1`

本 HANDOFF 之后若存在 `[skip ci]` 纯文档提交，不得把文档 head 当成已构建代码 head。

`main` 与 `p103-stable` 继续保持 v0.1.7。v0.3.3 未经用户实机确认不得提升。

## 固定读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. 本项目 `开发约束.md`
5. 本 HANDOFF
6. `README.md`
7. `用户手册.md`
8. `阶段记录.md`
9. `工作记录.md`
10. 涉及架构时读取 `通用任务架构.md`
11. 涉及 Data 与回滚时读取 `数据兼容与升级.md`
12. 涉及代码时以 `代码/DavBridge.sln` 为入口

接续后必须重新核对 `main`、`p103-stable`、`p103-exp`、最新 P103 CI 和 Artifact。

## 产品核心

DavBridge 长期维护 Zotero 附件从 InfiniCLOUD 到坚果云的强校验单向镜像。

- InfiniCLOUD 是唯一 authoritative source，并且始终只读。
- 坚果云保存 StrongVerified 镜像子集。
- Zotero `.zip + .prop` 按逻辑 Group 处理。
- 不做双向同步，不反写源端。
- `StrongVerified` 只有在源端完整 GET + SHA256 与目标重新 GET + SHA256 完全一致后成立。
- 历史 GoodSync 副本可以通过同样的双端强校验接管。
- PUT 结果未知进入 reconciliation，不盲目重试；412 也先协调，不覆盖未知目标。

## Cycle 与每周期自动对账

Cycle ID 使用启动真实坚果云额度周期的重置日期，格式 `yyMMdd`，例如 2026-09-07 为 `260907`。日期按配置中的日历日期处理，不先转换运行机器时区。

每个真实确认的新 Cycle 在普通 backlog 前自动执行：

```text
读取当前 InfiniCLOUD manifest
→ 与 StrongVerified 历史账本对账
→ 优先修复真正 SourceChanged
→ 必要时进入人工回收站门
→ 普通 backlog
```

源 metadata 未变化时不读取内容。metadata 变化时重新读取 InfiniCLOUD 并算 SHA256。SHA 未变只更新 metadata；SHA 真变化则 `SourceChanged`，优先于普通任务。新增对象只加入普通 backlog，不插队。

## 回收站与 DELETE

历史 StrongVerified Group 第一次从源端完整消失时，只记录首次缺失 Cycle，坚果云完全不动。至少跨到后续已确认 Cycle 仍完整缺失，才进入人工审查。

用户可以删除或“本周期继续保留”。保留项若下个 Cycle 仍缺失会再次进入审查，所以可能跨很多周期存在。

DELETE 永远不能后台自动执行。人工确认后仍必须再次检查源端准确成员路径、zip/prop 完整性和目标历史身份。源端部分恢复时禁止删除；目标身份不能安全证明时，只在下载安全额度允许时重新读取目标并比对历史 Target SHA256。DELETE 结果未知必须查询实际目标状态，不盲目重复。

## Data

核心 Data 继续保持：

- `%APPDATA%/DavBridge/config.json`
- `%APPDATA%/DavBridge/state.json`
- `%APPDATA%/DavBridge/state.json.bak`
- `%APPDATA%/DavBridge/secrets.dat`

`MigrationState.SchemaVersion` 仍为 1。

v0.3 新增：

- `%APPDATA%/DavBridge/reconcile.json`
- `%APPDATA%/DavBridge/reconcile.json.bak`

它只保存 Cycle、缺失观察、人工决定和对账摘要。sidecar 丢失的安全方向只能重新开始删除观察期。

## UI 长期原则

当前一级导航固定为：

```text
总览 | 转移 | 回收站 | 文档                     ⚙
```

没有宽左侧栏。总览是运行控制中心，不做说明页。InfiniCLOUD 云形 Logo、双右箭头和坚果云橡果 Logo 保留。

解释采用三级层次：

1. 主界面只显示必须扫一眼看到的状态、数字和动作。
2. 概念解释优先使用 ToolTip。
3. 完整规则进入“文档”Tab 和 `用户手册.md`。

不得重新在主页、转移页、回收站堆大量灰色小字说明。

## v0.3.3 信息密度收口

v0.3.2 实机截图继续显示同一信息被标题、数字、说明文字和 bar 重复表达。用户明确要求能放入进度条或状态条的信息尽量直接内嵌。

v0.3.3 只改变 UI 表达，不改变迁移、对账、额度或删除安全逻辑。

本轮原则：**bar 本身就是信息载体。**

- 镜像覆盖数直接显示在覆盖 bar 内，不再额外占一行数值。
- 当前文件名、等待原因或当前动作直接显示在当前任务 bar 内。
- 上传和下载的 `已用 / 总额` 直接显示在各自额度 bar 内。
- 转移页当前任务直接显示在任务 bar 内。
- 转移页整体镜像覆盖数直接显示在覆盖 bar 内。
- “本周期”的对账、修复、迁移三项改为一条紧凑阶段带，不再使用“本周期 + 三段分散文字”。
- 转移页重复的“当前状态”说明卡移除。
- 转移任务池表格删除常驻“处理顺序”长句列，只保留任务池与数量，处理规则进入悬浮说明和文档。
- 转移、回收站、文档页标题下方的重复副标题不再常驻。
- 重置日期常驻缩短为紧凑日期，完整“09:00 后真实探测”等解释进入悬浮说明。

v0.3.3 使用 `UiShellV032 + UiDensityV033`。Density 层只负责显示压缩，不拥有业务状态机。

## 自动验证

准确构建 head：`e088d8c7a918cc1cfba178df47c0da688ddd17a1`

CI run：`31883251539`，结果 **success**。

继续通过：scope、Core Smoke、原 Cycle / StrongVerified / SourceChanged / WaitQuota / WriteUnknown / 412 / 回收站 / DELETE 安全回归、Windows x64 单 EXE publish、Runtime boundary、Windows 隔离 self-test、v0.3.2 原有 900×620 / 大窗口 / DPI / 无默认滚动条 / 四 Tab / Logo 路由布局门，以及 v0.3.3 Density 构造。

CI 是自动验证，不替代用户实机视觉验收和真实 WebDAV DELETE 验证。

## 当前实机断点

下一步只验收 v0.3.3 UI，不提升 stable：

1. 首页覆盖、当前任务、上传、下载文字是否自然进入 bar，并明显减少重复文字。
2. 三阶段紧凑带是否比旧“本周期 + 三列文字”更自然。
3. 转移页是否只保留必要的任务池、数量、当前任务和覆盖信息。
4. 回收站与文档页是否继续简洁，不重新出现说明文字堆叠。
5. 悬浮提示能否承担被移除的解释。
6. 暂停、继续、设置、托盘、重启和当前迁移行为保持正常。

真实 DELETE 仍需等合法跨周期候选出现后再做真实账户验证。

## 事实源

实现事实以源码为准，验证事实以测试与 CI 为准，正式稳定事实以 `main` 与 `p103-stable` 为准，当前实验事实以 `p103-exp` 为准，真实 WebDAV 行为以用户账户实测为准。
