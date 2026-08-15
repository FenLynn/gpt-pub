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

当前实验候选：**v0.3.4**。

v0.3.4 完成完整 CI 的准确代码 head：`0ff1a9329f1fb34601cdf033167c4d85a7fab5fc`

P103 CI run：`31884396260`

CI：**success**。

Artifact：`DavBridge-v0.3.4-win-x64`

Artifact ZIP SHA256：`dce49eab9343ff1bd2ee6a7a8cfbcbbd5a96f9a7eb93e02ae07500a7fff31afc`

EXE SHA256：`7de38ae725020b8d98138378f1d85a8b837e16d6423c1af87930d85347452b75`

本 HANDOFF 之后若存在 `[skip ci]` 纯文档提交，不得把文档 head 当成已构建代码 head。

`main` 与 `p103-stable` 继续保持 v0.1.7。v0.3.4 未经用户实机确认不得提升。

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

## v0.3.3 UI 事故与 v0.3.4 紧急回退

v0.3.3 为了把文字直接塞入进度条，引入了 `UiDensityV033` 运行时显示层。该层会在程序启动后：

- 给既有 `MeterV030` 叠加新的 overlay 控件；
- 隐藏原控件和若干文字控件；
- 动态修改既有 `TableLayoutPanel.RowStyles`；
- 隐藏转移页卡片、表格列和多个标题说明；
- 替换原阶段区域。

用户实机证明这套做法破坏了四个一级页面的布局。CI 的无头 WinForms 构造测试没有能力替代真实窗口可见状态，因此此前 CI success 不能作为该视觉结构正确的依据。

**v0.3.3 判定为失败 UI 候选，不得继续沿用。**

v0.3.4 的处理不是继续给 Density 层打补丁，而是完整撤销：

- `Program.cs` 恢复只挂载 `UiShellV032`；
- `UiDensityV033.cs` 从当前分支删除；
- v0.3.4 运行时代码重新与 v0.3.2 已构建 shell 对齐；
- 相对 v0.3.2 准确构建 head `8a800bb1a8cc51cbef9979dbf6f71e2a4e6d8ec5`，代码目录除产品版本号外无运行逻辑差异。

### 后续 UI 修改硬约束

今后若继续减少文字或把信息放入 bar：

- 禁止再通过独立运行时 overlay 层批量接管既有页面；
- 禁止为了压缩信息在运行时批量改 `RowStyles`、隐藏父级卡片或跨页修改布局；
- 应直接在 `UiShellV032` 或其后继单一 shell 的布局源头设计；
- 每次只改一个页面或一类控件，小步实机确认后再继续；
- 总览、转移、回收站、文档四页必须逐页实机截图验收；
- CI 只证明构造、编译和自动安全回归通过，不能声称视觉验收通过。

## v0.3.4 自动验证

准确构建 head：`0ff1a9329f1fb34601cdf033167c4d85a7fab5fc`

CI run：`31884396260`，结果 **success**。

通过：

- scope；
- Core Smoke；
- 原 Cycle / StrongVerified / SourceChanged / WaitQuota / WriteUnknown / 412 / 回收站 / DELETE 安全回归；
- Windows x64 framework-dependent 单 EXE publish；
- Runtime boundary；
- Windows 隔离 self-test；
- v0.3.2 单一 `UiShellV032` 构造；
- 900×620、大窗口、125% 与 150% DPI 原布局门；
- 默认无内容区滚动条；
- 四个一级 Tab；
- Logo 路由；
- SHA256；
- Artifact upload。

Artifact：`DavBridge-v0.3.4-win-x64`

Artifact ZIP SHA256：`dce49eab9343ff1bd2ee6a7a8cfbcbbd5a96f9a7eb93e02ae07500a7fff31afc`

EXE SHA256：`7de38ae725020b8d98138378f1d85a8b837e16d6423c1af87930d85347452b75`

CI 是自动验证，不替代用户实机视觉验收和真实 WebDAV DELETE 验证。

## 当前实机断点

下一步只验收 v0.3.4 是否完整恢复 v0.3.2 shell，不提升 stable：

1. 总览布局是否恢复，不再出现 v0.3.3 的挤压、错位和异常留白。
2. 转移页任务池、当前状态、当前任务、覆盖区域是否恢复 v0.3.2 结构。
3. 回收站三个筛选器、表格和底部操作区是否恢复。
4. 文档左侧导航与正文区是否恢复。
5. 设置、暂停、继续、托盘、重启和当前迁移行为保持正常。

确认 v0.3.4 恢复稳定后，再讨论下一轮 UI 精简。下一轮不能直接重做 v0.3.3 的 overlay 方案。

真实 DELETE 仍需等合法跨周期候选出现后再做真实账户验证。

## 事实源

实现事实以源码为准，验证事实以测试与 CI 为准，正式稳定事实以 `main` 与 `p103-stable` 为准，当前实验事实以 `p103-exp` 为准，真实 WebDAV 行为以用户账户实测为准。
