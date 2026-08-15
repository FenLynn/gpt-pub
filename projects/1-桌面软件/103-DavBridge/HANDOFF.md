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

当前实验候选：**v0.3.2**

v0.3.2 完成完整 CI 的准确代码 head：`8a800bb1a8cc51cbef9979dbf6f71e2a4e6d8ec5`

P103 CI run：`31877846745`

CI 结论：**success**

Artifact：`DavBridge-v0.3.2-win-x64`

GitHub Artifact ZIP SHA256：`945edb64e875db5498d2d768302128f435933b4c63bb4005e03e2c26bbb00ebd`

EXE SHA256：`a393d0c00e700ca8d6729c29db9d78ecfbddfc5fca3a6975d37d21cbab7984c7`

本 HANDOFF 之后存在 `[skip ci]` 纯文档提交时，不得把文档 head 当成已构建代码 head。

`main` 与 `p103-stable` 继续保持 v0.1.7。v0.3.2 未经用户实机确认，不得提升到 stable 或 main。

## 固定读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. 本项目 `开发约束.md`
5. 本 HANDOFF
6. 本项目 `README.md`
7. 本项目 `用户手册.md`
8. 本项目 `阶段记录.md`
9. 本项目 `工作记录.md`
10. 涉及架构时读取 `通用任务架构.md`
11. 涉及本地 Data 与回滚时读取 `数据兼容与升级.md`
12. 涉及重大历史取舍时读取 `设计与演进.md`
13. 涉及代码时读取 `代码/README.md`，以 `代码/DavBridge.sln` 为源码入口

接续后必须重新核对 `main`、`p103-stable`、`p103-exp`、最新 P103 CI 和 Artifact。

## 产品定位

DavBridge 维护当前 Zotero 附件从 InfiniCLOUD 到坚果云的持续强校验单向镜像。

核心不变量：

- InfiniCLOUD 是唯一 authoritative source；
- InfiniCLOUD 始终只读；
- 坚果云保存经过 StrongVerified 核准或正在迁移的镜像子集；
- 不做双向同步；
- 不把目标变化反写到源端；
- 普通后台任务不得自动传播删除。

完整用户可读说明已固化到 `用户手册.md`，并同步嵌入程序的“文档”Tab。

## StrongVerified

每个 `StrongVerified` 对象保存历史可信基线，包括：

- Source SHA256；
- Target SHA256；
- Source size / ETag / LastModified；
- Target ETag；
- VerifiedAt。

无论目标最初由 DavBridge、GoodSync 还是人工复制写入，只要已经完成双端强校验，都作为历史可信基线。

普通 metadata 对账不能随意覆盖历史 SHA 基线。只有重新完成强校验后才建立新基线。

## Cycle

Cycle ID 使用启动当前坚果云额度周期的真实重置日期，格式固定为 `yyMMdd`。

例如 2026-09-07 对应 `260907`。

只有真实重置探测通过后才进入新 Cycle。`NextResetAt` 按日历日期处理，禁止先转成本机或 CI 时区后再格式化，以免跨日。

## 每周期自动流程

```text
确认真实新周期
→ 读取 InfiniCLOUD manifest
→ 与历史 StrongVerified 账本对账
→ 优先处理真正 SourceChanged
→ 必要时进入人工回收站门
→ 普通 backlog
```

源 metadata 未变化时不读取内容。

源 metadata 变化时只重新读取 InfiniCLOUD 并计算 SHA256：

- SHA 相同，只更新源 metadata；
- SHA 不同，进入 `SourceChanged`；
- `SourceChanged` 优先于普通 backlog；
- 新目标再次 StrongVerified 后才建立新的核准基线。

新增对象进入普通 backlog，不提高优先级。

## 逻辑回收站

第一次发现一个历史 StrongVerified Zotero `.zip + .prop` Group 从 InfiniCLOUD 完全消失：

- 只记录首次缺失 Cycle；
- 坚果云不移动、不改名、不删除；
- 当前 Cycle 只能观察。

后续已确认 Cycle 仍完全不存在才进入人工审查。

人工可以：

- 删除所选；
- 本周期继续保留。

保留项下个 Cycle 如果仍缺失会再次进入审查，因此允许跨很多周期保留。

### DELETE 硬规则

DELETE 永远不能由后台自动执行。

人工确认后仍必须再次：

1. 查询 InfiniCLOUD 准确成员路径；
2. 完整恢复则取消删除；
3. zip / prop 只恢复部分成员时阻止删除；
4. 核对坚果云目标仍对应历史 StrongVerified 身份；
5. metadata 无法安全证明身份时，只在下载安全额度允许时重新 GET 目标并比对历史 Target SHA256；
6. DELETE 后查询准确目标路径；
7. 网络或超时导致结果不确定时先 reconciliation，不盲目重复 DELETE。

成功人工删除后保留历史 SHA 证据，并让记录进入可恢复语义，以便源端以后重新出现时重新建立目标。

## Data 兼容

核心用户 Data 保持：

- `%APPDATA%/DavBridge/config.json`
- `%APPDATA%/DavBridge/state.json`
- `%APPDATA%/DavBridge/state.json.bak`
- `%APPDATA%/DavBridge/secrets.dat`

`MigrationState.SchemaVersion` 仍为 1。

v0.3 sidecar：

- `%APPDATA%/DavBridge/reconcile.json`
- `%APPDATA%/DavBridge/reconcile.json.bak`

sidecar 只保存 Cycle、首次缺失、人工决定、删除历史和对账摘要。sidecar 丢失时，安全方向只能重新开始删除观察期，不能让对象更容易被删除。

## v0.3.2 UI 收口

v0.3.1 实机截图确认：虽然遮挡和 Logo 已修复，但 UI 仍出现明显“说明页化”，首页与此前长期确认的运行控制中心定位不一致，转移和回收站页常驻小字过多、内容密度失衡。

v0.3.2 不继续叠 `UiPolish` 或布局补丁，运行时直接切换到新的单一 `UiShellV032`。旧 v0.3.0 / v0.3.1 shell 与 polish 类仍保留源码用于历史回溯，但不再运行挂载。

一级入口固定为：

```text
总览 | 转移 | 回收站 | 文档                     ⚙
```

### 总览

回归“运行控制中心”，只常驻：

- Cycle；
- InfiniCLOUD 云形 Logo、双右箭头、坚果云橡果 Logo；
- 当前阶段：对账、修复、普通迁移；
- 镜像覆盖；
- 当前任务；
- 本周期上传与下载额度；
- 下次重置日期；
- 暂停 / 继续或必要时的“审查回收站”。

解释性文字不再长期铺在首页。需要人工时只增加一条醒目单行横幅。

### 转移

转移页改成任务工作台，不再使用两个巨大统计卡：

- 顶部显示当前状态；
- 中部用紧凑表格显示“优先修复 / 普通任务”两池；
- 当前任务和实时进度单独显示；
- 底部显示整体镜像覆盖。

新增对象与既有 backlog 在 UI 和逻辑上都属于同一个普通任务池。

### 回收站

回收站删除常驻长段说明，只保留：

- 待观察；
- 待审查；
- 已处理；
- 当前清单；
- 待审查时才出现人工操作按钮。

所有解释通过标题、筛选器悬浮提示和“文档”页查看。

表格仍默认零选择，且不使用 250 ms 动画刷新重建选择状态。

### 文档

新增正式一级“文档”Tab。

文档使用本地内置内容，不依赖网络，当前章节：

- 使用概览；
- 镜像原则；
- StrongVerified；
- Cycle 与额度；
- 源端对账；
- 转移优先级；
- 回收站；
- 删除安全；
- 状态与提示；
- 常见问题。

程序外同步维护 `用户手册.md`，后续 UI 规则变化必须同步更新两处。

### 悬浮说明

主界面常驻信息只保留标题、关键数字、状态和必要按钮。

以下解释优先放 ToolTip：

- Cycle 含义；
- StrongVerified；
- 当前任务；
- 上传 / 下载额度；
- 对账 / 修复 / 普通迁移阶段；
- 回收站三个筛选器；
- 设置入口。

## v0.3.2 自动验证

准确代码 head：`8a800bb1a8cc51cbef9979dbf6f71e2a4e6d8ec5`

P103 CI run：`31877846745`

CI：**success**。

通过：

- scope；
- Core Smoke；
- 原 Cycle、对账、回收站、DELETE、WriteUnknown、412、WaitQuota 安全回归；
- Windows x64 framework-dependent 单 EXE publish；
- Runtime boundary；
- Windows 隔离 self-test；
- v0.3.2 单 shell 构造；
- 四个一级 Tab；
- 文档页构造；
- 默认无内容区滚动条；
- Logo 路由；
- 默认 900×620、1200×760、125%、150% DPI 布局；
- SHA256；
- Artifact upload。

Artifact：`DavBridge-v0.3.2-win-x64`

GitHub Artifact ZIP SHA256：`945edb64e875db5498d2d768302128f435933b4c63bb4005e03e2c26bbb00ebd`

EXE SHA256：`a393d0c00e700ca8d6729c29db9d78ecfbddfc5fca3a6975d37d21cbab7984c7`

## 当前实机断点

下一步只做 v0.3.2 实机 UI 验收，不提升 stable：

1. 总览是否重新具有运行控制中心感，而不是说明页感；
2. 首页与 v0.3.1 相比是否明显减少小字和无效说明；
3. Logo、双箭头、Cycle、阶段、镜像覆盖、当前任务和流量是否在默认窗口内自然完整；
4. 转移页两任务池是否比旧大卡片更自然；
5. 回收站是否更简洁，空状态不显得像说明文档；
6. 文档 Tab 是否易读，规则是否足够完整；
7. 悬浮说明是否在需要时能解释概念，但不干扰常态视觉；
8. 暂停、继续、设置、托盘、重启和当前迁移保持正常。

真实 DELETE 在出现合法跨周期候选前仍只能由 Mock / CI 证明逻辑，不能声称已经真实账户验证。

## 事实源

实现事实以源码为准。验证事实以测试与 CI 为准。正式稳定事实以 `main` 与 `p103-stable` 为准。当前实验事实以 `p103-exp` 为准。真实 WebDAV 行为仍以用户账户实测为准。
