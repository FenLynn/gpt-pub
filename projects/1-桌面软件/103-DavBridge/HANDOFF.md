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

当前实验候选：**v0.3.10**。

v0.3.10 完成完整 CI 和 Windows attached Meter 视觉检查的准确代码 head：`8ca0ddd6a0e3b6586a86242766671fd41939e14d`

P103 CI run：`31915216732`

CI：**success**。

Windows Artifact：`DavBridge-v0.3.10-win-x64`

Artifact ZIP SHA256：`44f41145bdfab07571ef13156e4046876425713b426bde46e02b5c03a181619f`

EXE SHA256：`d6e7a0558627e144cb07dd92168e32c3f7856d414b1b39386be6891eed590355`

视觉检查 Artifact：`DavBridge-v0.3.10-ui-snapshots`

本 HANDOFF 及其后的 `[skip ci]` 纯文档提交不得当成已构建代码 head。准确已构建代码 head 始终是上面的 `8ca0ddd6...`。

`main` 与 `p103-stable` 未修改。v0.3.10 仍需用户实机截图确认后才能考虑提升。

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

## 产品核心与安全语义

DavBridge 长期维护 Zotero 附件从 InfiniCLOUD 到坚果云的强校验单向镜像。

- InfiniCLOUD 是唯一 authoritative source，并始终只读。
- 坚果云保存 StrongVerified 镜像子集。
- Zotero `.zip + .prop` 按逻辑 Group 处理。
- 不做双向同步，不反写源端，不传播源端删除。
- `StrongVerified` 只有在源端完整 GET + SHA256 与目标重新 GET + SHA256 完全一致后成立。
- 历史 GoodSync 副本可以通过相同双端强校验接管。
- PUT 结果未知进入 reconciliation，不盲目重试。
- HTTP 412 先协调，不覆盖未知目标。
- Conflict、WriteUnknown、SourceChanged 等安全状态不得被历史副本维护覆盖。

## Cycle 与每周期自动对账

Cycle ID 使用真实坚果云额度周期的重置日期，格式 `yyMMdd`。

真实确认的新 Cycle 在普通 backlog 前自动执行：

```text
读取当前 InfiniCLOUD manifest
→ 与 StrongVerified 历史账本对账
→ 优先修复真正 SourceChanged
→ 必要时进入人工回收站门
→ 普通 backlog
```

源 metadata 未变化时不读取内容。metadata 变化时重新读取 InfiniCLOUD 并计算 SHA256。SHA 未变只更新 metadata；SHA 真变化进入 `SourceChanged`，优先于普通任务。新增对象只加入普通 backlog，不插队。

额度重置不是午夜盲重置。到达配置的重置日后，09:00 以后通过真实探测确认新服务周期，成功后才重置账本并进入新 Cycle。

## 回收站与 DELETE

历史 StrongVerified Group 第一次从源端完整消失时，只记录首次缺失 Cycle，坚果云完全不动。至少跨到后续已确认 Cycle 仍完整缺失，才进入人工审查。

用户可以删除或“本周期继续保留”。保留项若下个 Cycle 仍缺失会再次进入审查，可以跨多个周期存在。

DELETE 永远不能后台自动执行。人工确认后仍必须再次检查源端准确成员路径、zip/prop 完整性和目标历史身份。源端部分恢复时禁止删除。目标身份不能安全证明时，只在下载安全额度允许时重新读取目标并比对历史 Target SHA256。DELETE 结果未知必须查询实际目标状态，不盲目重复。

## Data

核心 Data：

- `%APPDATA%/DavBridge/config.json`
- `%APPDATA%/DavBridge/state.json`
- `%APPDATA%/DavBridge/state.json.bak`
- `%APPDATA%/DavBridge/secrets.dat`
- `%APPDATA%/DavBridge/reconcile.json`
- `%APPDATA%/DavBridge/reconcile.json.bak`

`MigrationState.SchemaVersion` 仍为 1。

## UI 长期原则

一级导航固定为：

```text
总览 | 转移 | 回收站 | 文档                     ⚙
```

没有宽左侧栏。总览是运行控制中心。InfiniCLOUD 云形 Logo、双右箭头和坚果云橡果 Logo 保留。

解释采用三级层次：主界面只显示必须状态、数字和动作；概念解释优先 ToolTip；完整规则进入“文档”Tab 和 `用户手册.md`。

### UI 修改硬约束

- v0.3.4 页面几何是当前稳定基线，除非用户明确要求，不得顺手改尺寸和层级。
- 禁止运行时 overlay 批量接管页面。
- 禁止 reparent 原 Label 到 Meter。
- 禁止为了文字进 bar 修改既有 `RowStyles`。
- 简单显示需求优先在原控件自身 Paint 或局部 presentation binding 层完成。
- 自动测试必须检查最终 attached 控件的实际 Bounds 和最终栅格像素，不能只测试独立 reference 控件。
- CI 不能代替用户实机视觉验收。

## 额度条 UI 事故复盘

### v0.3.6 至 v0.3.8

v0.3.6 开始把文字改为 `MeterV030.OnPaint()` 原生绘制。v0.3.7 缩小 point 字体。v0.3.8 改为 pixel 字体和手工 Y。方向都没有解决实机上传、下载文字贴底问题。

### v0.3.9

v0.3.9 新增 `MeterTextSpriteV039`，先离屏渲染，再裁掉字体 line box 空白，仅保留真实 glyph 像素，最后按 glyph 像素框居中。这个方法本身解决了字体 baseline 差异，但仍没有解决用户实机问题。

用户实机 v0.3.9 截图最终证明：上传、下载文字仍被额度条底部遮挡。该版本视觉验收明确判定失败，不得再记为通过。

随后重新打开 v0.3.9 的 Windows attached Meter 检查图，发现真正根因：

```text
coverage attached: 373×26 px
current attached:  373×26 px
upload attached:   369×50 px
 download attached: 369×50 px
```

而 `UiShellV032.BuildQuotaCell()` 明确把额度 Meter 所在第三行设计为 16 个逻辑像素。由于上传、下载 Meter 使用 `Dock=Fill`，TableLayoutPanel 的剩余高度被额度 Meter 吞掉，实际控件高度扩大到 50 px。`MeterV030` 因此是在 50 px 内正确居中文字，而主页面外层只显示额度区域的一部分，最终产生实机底部裁切。

v0.3.9 后期加入的 standalone 16/27 px reference Meter 虽然视觉通过，但它们不是主页面 attached Meter，因而没有复现这个 Bounds 错误。后续禁止把 standalone reference 控件通过当成 attached UI 通过。

## v0.3.10 修复

v0.3.10 不改页面 RowStyles、不移动额度区、不改业务逻辑，也不再调字体 Y。

新增 `UiQuotaMeterBoundsV0310`，只约束 `_uploadMeter` 和 `_downloadMeter`：

```text
Dock = Top
Height = 16 logical px
```

16 px 来自既有 `BuildQuotaCell()` 的额度 Meter 设计行高，不是针对某台机器的经验偏移。因为约束发生在正常 WinForms 控件树中，Windows DPI/缩放仍会正常缩放该逻辑高度。

v0.3.9 的 glyph sprite 居中继续保留。现在文字是在真实额度 Meter 本体中居中，不再是在一个被父层裁切的 50/76 px 大控件里居中。

## v0.3.10 验证

准确代码 head：`8ca0ddd6a0e3b6586a86242766671fd41939e14d`

CI run：`31915216732`，结果 **success**。

原有 scope、Core Smoke、Cycle、StrongVerified、SourceChanged、WaitQuota、WriteUnknown、412、回收站、DELETE、安全回归、Windows x64 单 EXE、Runtime boundary、显式打开回 Overview 等检查全部继续通过。

新增 quota Meter Bounds 硬门，并重新生成真实 attached Meter 视觉图。

最终 Windows 检查图中：

```text
100%: upload/download attached = 369×16 px
150%: upload/download attached = 555×24 px
```

文字在这两个真实 attached Meter 内完整显示并居中。与 v0.3.9 的 `369×50 px` / 更高 DPI 下继续膨胀的控件相比，根因已经从 Bounds 层消除。

视觉 Artifact 仍只是 Windows CI 证据，用户真实机器是最终事实源。

## 显式打开行为

- Windows 登录自启动通过 `--background`，允许后台进入托盘。
- 用户手工双击 EXE 恢复主窗口并显示总览。
- 已运行时再次双击 EXE，通过单实例事件恢复窗口并强制回总览。
- 托盘双击或“打开 DavBridge”同样恢复窗口并回总览。

## 当前实机断点

下一步只验收 **v0.3.10**，不提升 stable：

1. 上传、下载额度文字必须完整处于 bar 内并垂直居中，不贴底、不裁切。
2. 上传、下载 bar 的整体位置不得改变，只修内部 Bounds 与文字显示。
3. 镜像覆盖、当前任务、Logo、四个 Tab、阶段区和按钮位置不得变化。
4. 手工双击 EXE 应显示主窗口总览。
5. 用户实机确认后，才可把本次额度条问题记为关闭。

真实 DELETE 仍需等合法跨周期候选出现后再做真实账户验证。

## 事实源

实现事实以源码为准，验证事实以测试、CI 与真实 attached 控件视觉 Artifact 为准，正式稳定事实以 `main` 与 `p103-stable` 为准，当前实验事实以 `p103-exp` 为准，真实 WebDAV 行为与最终视觉效果以用户实机为准。
