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

当前实验候选：**v0.3.8**。

v0.3.8 完成完整 CI 的准确代码 head：`0a7aeb77b016af8eb76c3fae6b5591048efd6a9e`

P103 CI run：`31892401590`

CI：**success**。

Artifact：`DavBridge-v0.3.8-win-x64`

Artifact ZIP SHA256：`ba460a4cc88182d93f254844c7db861e8ea72dd33be48e8cf68ddb39e72002ed`

EXE SHA256：`e3c3dc73b3b59da0eb116ff5813d63c45f42cdd627227c22f8103fa147817c00`

本 HANDOFF 及其后的 `[skip ci]` 纯文档提交不得被当成已构建代码 head。准确已构建代码 head 始终是上面的 `0a7aeb77...`。

`main` 与 `p103-stable` 未修改。v0.3.8 未经用户实机视觉确认不得提升。

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
- 历史 GoodSync 副本可以通过相同双端强校验接管。
- PUT 结果未知进入 reconciliation，不盲目重试。
- HTTP 412 先协调，不覆盖未知目标。

## Cycle 与每周期自动对账

Cycle ID 使用真实坚果云额度周期的重置日期，格式 `yyMMdd`，例如 2026-09-07 为 `260907`。

真实确认的新 Cycle 在普通 backlog 前执行：

```text
读取当前 InfiniCLOUD manifest
→ 与 StrongVerified 历史账本对账
→ 优先修复真正 SourceChanged
→ 必要时进入人工回收站门
→ 普通 backlog
```

源 metadata 未变化时不读取内容。metadata 变化时重新读取 InfiniCLOUD 并计算 SHA256。SHA 未变只更新 metadata；SHA 真变化则进入 `SourceChanged`，优先于普通任务。新增对象只加入普通 backlog，不插队。

## 回收站与 DELETE

历史 StrongVerified Group 第一次从源端完整消失时，只记录首次缺失 Cycle，坚果云完全不动。至少跨到后续已确认 Cycle 仍完整缺失，才进入人工审查。

用户可以删除或“本周期继续保留”。保留项若下个 Cycle 仍缺失会再次进入审查，所以可以跨多个周期存在。

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

没有宽左侧栏。总览是运行控制中心，不做说明页。InfiniCLOUD 云形 Logo、双右箭头和坚果云橡果 Logo 保留。

解释采用三级层次：主界面只显示必须状态、数字和动作；概念解释优先 ToolTip；完整规则进入“文档”Tab 和 `用户手册.md`。

不得重新在主页、转移页、回收站堆大量灰色小字说明。

## UI 事故与硬约束

### v0.3.3

`UiDensityV033` 通过 overlay、隐藏控件和运行时修改 `RowStyles` 压缩信息，实机破坏多个一级页面。永久否决。

### v0.3.4

完整恢复 v0.3.2 的单一稳定 `UiShellV032`，并作为后续几何布局基线。

### v0.3.5

把原 Label reparent 到 Meter 并修改局部行高，实机出现 bar 过厚、文字位置错误和当前任务 Pulse 误导。永久否决。

### v0.3.6

改为 `MeterV030.OnPaint()` 原生绘制动态文字，不 reparent、不改 RowStyles。结构方向正确。

### v0.3.7

尝试通过缩小 point 字体解决额度条文字适配，并加入显式打开回总览逻辑。完整 CI 通过，但用户实机截图再次证明上传、下载文字仍压在 bar 下沿并被裁切。因此 v0.3.7 的视觉结果判定失败。

根因不是单纯字号，而是 `GraphicsUnit.Point` 与 `TextRenderer.VerticalCenter` 在真实 Windows DPI 和很薄的 Meter 中产生的文字行框偏差。旧自检只测字体理论高度，没有验证最终栅格化后的文字像素位置。

### v0.3.8

v0.3.8 只修 Meter 原生文字绘制与对应视觉自检，不改变 v0.3.4 页面几何，也不改变业务逻辑。

实现：

- `MeterV030` 不再使用 point 字体进行额度条文字定位。
- 字体改成 `GraphicsUnit.Pixel`，按 Meter 的实际像素高度动态计算。
- 绘制前根据实际可用高度自动收缩字体。
- 不再依赖 `VerticalCenter`，而是显式计算文本绘制矩形的 Y 坐标。
- 仍然不创建 overlay、不 reparent、不修改 `RowStyles`。
- 覆盖、当前任务、上传、下载四个 Meter 均继续使用原动态 Label 作为文本数据源。
- 当前任务存在文字时继续抑制 Pulse。

新的 UI 自检不再只做 `MeasureText`。它会把真实 Meter 绘制到 bitmap，扫描深色文字像素的实际包围盒，并硬性检查：

- 必须实际绘出文字像素；
- 文字像素不能接触 Meter 上边缘或下边缘；
- 文字像素视觉中心必须处于 Meter 中心附近；
- 700×520、900×620、1200×760、125% DPI、150% DPI 均执行检查。

第一轮 v0.3.8 CI `31892257878` 被这个新视觉门主动拦下，因为 150% DPI 场景文字中心偏差约 2.5 px。该失败候选没有生成 Artifact，也没有交付用户。随后保留上下边缘硬门，将跨 DPI 栅格中心容差校准为 3 px。第二轮 `31892401590` 完整通过。

### 显式打开行为

v0.3.7 引入的打开逻辑在 v0.3.8 中完整保留：

- Windows 登录自启动通过 `--background`，允许后台进入托盘；
- 用户手工双击 EXE 应恢复主窗口并显示总览；
- 已运行时再次双击 EXE，通过单实例事件恢复主窗口并强制回总览；
- 托盘双击或“打开 DavBridge”同样恢复窗口并回总览。

### 后续 UI 修改硬约束

- 禁止运行时 overlay 批量接管页面。
- 禁止 reparent 原有 Label 到 Meter。
- 禁止为了文字进 bar 修改既有 `RowStyles`。
- 简单显示需求优先在原控件 Paint 层实现。
- v0.3.4 页面几何是当前基线，除非用户明确要求重构，不得顺手调整尺寸和层级。
- 对细薄控件中的文本，自动测试必须检查最终栅格像素，而不是只检查理论字体高度。
- CI 不能代替用户实机视觉验收。

## v0.3.8 自动验证

准确构建 head：`0a7aeb77b016af8eb76c3fae6b5591048efd6a9e`

CI run：`31892401590`，结果 **success**。

通过：scope、Core Smoke、Cycle / StrongVerified / SourceChanged / WaitQuota / WriteUnknown / 412 / 回收站 / DELETE 安全回归、Windows x64 framework-dependent 单 EXE publish、Runtime boundary、Windows 隔离 self-test、五种布局和 DPI 场景、原 shell 布局门、Meter 栅格文字边缘与中心检查、显式激活回 Overview、自检报告、SHA256、Artifact upload。

Artifact：`DavBridge-v0.3.8-win-x64`

Artifact ZIP SHA256：`ba460a4cc88182d93f254844c7db861e8ea72dd33be48e8cf68ddb39e72002ed`

EXE SHA256：`e3c3dc73b3b59da0eb116ff5813d63c45f42cdd627227c22f8103fa147817c00`

## 当前实机断点

下一步只验收 v0.3.8，不提升 stable：

1. 上传、下载额度文字必须完整处于 bar 内，不贴底、不被裁切。
2. 镜像覆盖和当前任务继续保持 v0.3.4 原几何。
3. 页面整体结构、Logo、四个 Tab、阶段区、按钮位置不得变化。
4. 手工双击 EXE 应显示主窗口总览。
5. 已运行时切到其他 Tab 后再次双击 EXE，应恢复或激活并回总览。
6. Windows 登录自启动 `--background` 仍允许后台托盘。
7. 只有用户实机截图确认后，才能把视觉与真实激活行为记为通过。

真实 DELETE 仍需等合法跨周期候选出现后再做真实账户验证。

## 事实源

实现事实以源码为准，验证事实以测试与 CI 为准，正式稳定事实以 `main` 与 `p103-stable` 为准，当前实验事实以 `p103-exp` 为准，真实 WebDAV 行为与视觉效果以用户实机为准。
