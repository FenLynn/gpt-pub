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

当前实验候选：**v0.3.9**。

v0.3.9 完成完整 CI 和 Windows 视觉检查图的准确代码 head：`35eaf9c8b14760ed27829159f81c7a0fb020be10`

P103 CI run：`31895694912`

CI：**success**。

Windows Artifact：`DavBridge-v0.3.9-win-x64`

Artifact ZIP SHA256：`107d65c4e8cdadf6b31149366a8e09bc18879b7014fc8d6f1ccfd1b2389b6f7c`

EXE SHA256：`6c84f89730ca9be822055f4c5f0487b72b3add9f1c86ca8ae860f68ec4711e42`

视觉检查 Artifact：`DavBridge-v0.3.9-ui-snapshots`

本 HANDOFF 及其后的 `[skip ci]` 文档提交不得当成已构建代码 head。准确构建代码 head 始终是上面的 `35eaf9c8...`。

`main` 与 `p103-stable` 未修改。v0.3.9 仍需用户实机截图确认后才能考虑提升。

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

- InfiniCLOUD 是唯一 authoritative source，并始终只读。
- 坚果云保存 StrongVerified 镜像子集。
- Zotero `.zip + .prop` 按逻辑 Group 处理。
- 不做双向同步，不反写源端。
- `StrongVerified` 只有在源端完整 GET + SHA256 与目标重新 GET + SHA256 完全一致后成立。
- 历史 GoodSync 副本可以通过相同双端强校验接管。
- PUT 结果未知进入 reconciliation，不盲目重试。
- HTTP 412 先协调，不覆盖未知目标。

## Cycle 与每周期自动对账

Cycle ID 使用真实坚果云额度周期的重置日期，格式 `yyMMdd`，例如 2026-09-07 为 `260907`。

真实确认的新 Cycle 在普通 backlog 前自动执行：

```text
读取当前 InfiniCLOUD manifest
→ 与 StrongVerified 历史账本对账
→ 优先修复真正 SourceChanged
→ 必要时进入人工回收站门
→ 普通 backlog
```

源 metadata 未变化时不读取内容。metadata 变化时重新读取 InfiniCLOUD 并计算 SHA256。SHA 未变只更新 metadata；SHA 真变化进入 `SourceChanged`，优先于普通任务。新增对象只加入普通 backlog，不插队。

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

没有宽左侧栏。总览是运行控制中心，不做说明页。InfiniCLOUD 云形 Logo、双右箭头和坚果云橡果 Logo 保留。

解释采用三级层次：主界面只显示必须状态、数字和动作；概念解释优先 ToolTip；完整规则进入“文档”Tab 和 `用户手册.md`。

不得重新在主页、转移页、回收站堆大量灰色小字说明。

### UI 修改硬约束

- v0.3.4 页面几何是当前稳定基线，除非用户明确要求，不得顺手改尺寸和层级。
- 禁止运行时 overlay 批量接管页面。
- 禁止 reparent 原 Label 到 Meter。
- 禁止为了文字进 bar 修改既有 `RowStyles`。
- 简单显示需求优先在原控件自身 Paint 层完成。
- 自动测试不得只检查理论字号或字体行框，必须检查最终可见像素。
- CI 不能代替用户实机视觉验收。

## UI 事故与 v0.3.9 根因确认

### v0.3.3 至 v0.3.5

v0.3.3 使用 overlay 和运行时 RowStyles 压缩，破坏多个页面，永久否决。v0.3.4 完整恢复 v0.3.2 shell，并成为几何基线。v0.3.5 将 Label reparent 到 Meter 并改局部行高，实机观感错误，永久否决。

### v0.3.6 至 v0.3.8

v0.3.6 改为 `MeterV030.OnPaint()` 原生绘制文字，结构方向正确，但额度文字仍贴底。v0.3.7 尝试缩小 point 字体仍失败。v0.3.8 改为 pixel 字体并手工按 `TextRenderer.MeasureText()` 行框计算 Y，CI 栅格测试通过，但用户实机截图仍显示上传、下载数字明显压在 bar 下沿。

三轮独立复核后确认：

1. 实机截图中页面几何、bar 本身、中文覆盖和当前任务文字都正常，异常集中在纯 Latin/数字额度字符串，说明不是整体布局或 bar 高度故障。
2. v0.3.6 的 `VerticalCenter` 和 v0.3.8 的手工 Y 都仍基于字体 line box / baseline，最终可见 glyph ink 并不一定以 line box 中心为视觉中心。CJK 与 Latin/digit 的可见 glyph 占位差异解释了实机现象。
3. 旧 125%/150% CI 只是 `form.Scale(...)` 的尺寸缩放，不等于真实显示设备 DPI；因此旧 headless 测试不能作为用户屏幕文字位置的充分证据。

## v0.3.9 正确修复

产品 UI 几何和业务逻辑不变。只替换 Meter 文字最终定位方法。

新增 `MeterTextSpriteV039`：

1. 先在足够高的离屏缓冲区中渲染文字。
2. 扫描真实可见 glyph 像素。
3. 裁掉字体 line box 上下空白，仅保留实际字形像素。
4. 转为透明 glyph sprite。
5. `MeterV030` 最终使用 `DrawImageUnscaled`，按 sprite 的实际高度在 Meter 内精确居中。

因此最终垂直定位不再依赖 Latin、数字、中文各自不同的 baseline / line-box 占位。

sprite 按文本、宽高、目标像素和颜色缓存，避免 250 ms UI 刷新重复做像素扫描。

## v0.3.9 自动与视觉验证

最终代码 head：`35eaf9c8b14760ed27829159f81c7a0fb020be10`

CI run：`31895694912`，结果 **success**。

通过原有 scope、Core Smoke、Cycle、StrongVerified、SourceChanged、WaitQuota、WriteUnknown、412、回收站、DELETE、安全回归、Windows x64 单 EXE、Runtime boundary、窗口显式激活回 Overview 等全部既有检查。

本轮新增真实 Meter 视觉 Artifact。第一次尝试截取整个未 Show 的 Form，PNG 只有空白窗体，因此明确判定该视觉证据无效，没有据此交付。随后改为直接调用真实 `MeterV030.DrawToBitmap`，生成可见检查表。

最终检查表覆盖：

- 当前布局中的 coverage、current、upload、download Meter；
- 固定 16 px 上传额度条；
- 固定 27 px 上传额度条；
- 固定 16 px 下载额度条；
- 固定 27 px 下载额度条。

其中 27 px 与用户实机截图中的额度条物理高度接近。人工打开 Windows CI PNG 后，四个固定额度测试均完整显示、无上下裁切、视觉居中。像素复核中，27 px 上传字形中心和下载字形中心都落在 bar 中心附近，误差不超过约 1 px。

注意：这些检查证明 Windows CI 绘制路径和明确复刻的 16/27 px 场景已通过，但用户真实机器仍是最终视觉事实源。

## 显式打开行为

v0.3.7 引入并继续保留：

- Windows 登录自启动通过 `--background`，允许后台进入托盘；
- 用户手工双击 EXE 恢复主窗口并显示总览；
- 已运行时再次双击 EXE，通过单实例事件恢复窗口并强制回总览；
- 托盘双击或“打开 DavBridge”同样恢复窗口并回总览。

## 当前实机断点

下一步只验收 v0.3.9，不提升 stable：

1. 用户实机上传、下载数字必须完整居中于 bar，不贴底、不被裁切。
2. 镜像覆盖和当前任务继续保持 v0.3.4 原几何。
3. 页面整体结构、Logo、四个 Tab、阶段区、按钮位置不得变化。
4. 手工双击 EXE 应显示主窗口总览。
5. 已运行时切到其他 Tab 后再次双击 EXE，应恢复或激活并回总览。
6. Windows 登录自启动 `--background` 仍允许后台托盘。
7. 用户实机确认后，才可记录 v0.3.9 视觉通过并考虑后续收口。

真实 DELETE 仍需等合法跨周期候选出现后再做真实账户验证。

## 事实源

实现事实以源码为准，验证事实以测试、CI 与生成的视觉检查 Artifact 为准，正式稳定事实以 `main` 与 `p103-stable` 为准，当前实验事实以 `p103-exp` 为准，真实 WebDAV 行为与最终视觉效果以用户实机为准。
