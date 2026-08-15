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

当前实验候选：**v0.3.7**。

v0.3.7 完成完整 CI 的准确代码 head：`3e9e049b4c4c9791db8ce8149b537b732471af91`

P103 CI run：`31890467083`

CI：**success**。

Artifact：`DavBridge-v0.3.7-win-x64`

Artifact ZIP SHA256：`8ab1fc6faad3480429b44ee647edbc3aa5f3cb29db25e705faaf855375ab14fb`

EXE SHA256：`be5a615cc6788827593e17690c35f8961f076a8e4dfc3f68c4bfb47625f60725`

本 HANDOFF 及其后的 `[skip ci]` 纯文档提交不得被当成已构建代码 head。准确已构建代码 head 始终是上面的 `3e9e049...`。

`main` 与 `p103-stable` 未在本轮修改。v0.3.7 未经用户实机视觉确认不得提升。

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

## UI 事故与当前正确实现

### v0.3.3

`UiDensityV033` 通过 overlay、隐藏控件和运行时修改 `RowStyles` 压缩信息，实机破坏多个一级页面。该方案永久否决。

### v0.3.4

完整恢复 v0.3.2 的单一稳定 `UiShellV032`，并作为后续几何布局基线。

### v0.3.5

把原 Label reparent 到 Meter 并修改局部行高，实机出现 bar 过厚、文字位置错误和当前任务 Pulse 误导。该方案永久否决。

### v0.3.6

改为 `MeterV030.OnPaint()` 原生绘制动态文字，不再 reparent、不改 RowStyles。结构正确，但用户实机证明 14 px 的上传、下载额度条中 7.4 pt 字体仍会贴底并发生视觉裁切。

### v0.3.7

只修复 v0.3.6 暴露的两个问题，不调整页面几何：

- `UiOverviewMeterTextV037` 保持原 Label 和 Meter 的父级、TableLayoutPanel cell 与尺寸完全不变；
- 覆盖、当前任务使用 8.0 pt；上传、下载的 14 px bar 使用 6.2 pt；
- 自动自检使用与真实示例相近的字符串测量文本像素高度，要求文字高度小于 Meter 实际高度并保留边界；
- 当前任务存在文本时继续抑制 Pulse；
- 不创建 overlay，不创建替代 Meter，不 reparent，不改 RowStyles。

显式打开行为同时统一：

- Windows 登录自启动仍通过 `--background`，允许进入托盘；
- 用户手工双击 EXE 时，即使设置中保留“启动后默认进入托盘”，也应恢复主窗口并显示总览；
- 已运行时再次双击 EXE，通过单实例事件恢复主窗口并强制回到总览；
- 托盘双击或“打开 DavBridge”在窗口重新可见时同样回到总览。

### 后续 UI 修改硬约束

- 禁止运行时 overlay 批量接管页面。
- 禁止 reparent 原有 Label 到 Meter。
- 禁止为了文字进 bar 修改既有 `RowStyles`。
- 简单显示需求优先在原控件自身 Paint 层实现。
- v0.3.4 的页面几何结构是当前基线，除非用户明确要求重构，不得顺手调整尺寸和层级。
- CI 只证明构造、编译、安全回归与自动边界，不能声称真实视觉效果已验收。

## v0.3.7 自动验证

准确构建 head：`3e9e049b4c4c9791db8ce8149b537b732471af91`

CI run：`31890467083`，结果 **success**。

通过：

- scope；
- Core Smoke；
- Cycle / StrongVerified / SourceChanged / WaitQuota / WriteUnknown / 412 / 回收站 / DELETE 安全回归；
- Windows x64 framework-dependent 单 EXE publish；
- Runtime boundary；
- Windows 隔离 self-test；
- 700×520、900×620、1200×760、125% 与 150% DPI 构造；
- v0.3.4 shell 原布局门；
- native Meter 文字绘制；
- quota 示例文字高度与 14 px bar 适配检查；
- Label/Meter 父级、TableLayoutPanel cell 保持不变；
- Meter 不拥有被搬入的 Label 子控件；
- 显式激活会把 shell 返回 Overview 的自检；
- SHA256；
- Artifact upload。

Artifact：`DavBridge-v0.3.7-win-x64`

Artifact ZIP SHA256：`8ab1fc6faad3480429b44ee647edbc3aa5f3cb29db25e705faaf855375ab14fb`

EXE SHA256：`be5a615cc6788827593e17690c35f8961f076a8e4dfc3f68c4bfb47625f60725`

## 当前实机断点

下一步只验收 v0.3.7，不提升 stable：

1. 上传、下载额度文字必须完整处于原 14 px bar 内，不再贴底或被裁切。
2. 镜像覆盖和当前任务继续保持 v0.3.4 原几何，文字在 bar 内自然可读。
3. 手工双击 EXE 应显示主窗口总览，不因 `StartMinimized` 直接留在托盘。
4. 已运行时切到“转移 / 回收站 / 文档”任意页后，再双击 EXE，应恢复或激活窗口并切回“总览”。
5. Windows 登录自启动的 `--background` 路径仍允许后台进入托盘。
6. 转移、回收站、文档三页没有结构改造，应保持原观感。
7. 只有用户实机截图确认后，才能把视觉与真实激活行为记为通过。

真实 DELETE 仍需等合法跨周期候选出现后再做真实账户验证。

## 事实源

实现事实以源码为准，验证事实以测试与 CI 为准，正式稳定事实以 `main` 与 `p103-stable` 为准，当前实验事实以 `p103-exp` 为准，真实 WebDAV 行为与视觉效果以用户实机为准。
