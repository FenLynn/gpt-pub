# DavBridge 对话接续入口

本文件用于恢复 P103 DavBridge 当前事实与准确断点。新对话不得只凭聊天记忆继续，必须按本文与 A/B/C 约束重新核对仓库事实。

## 1. 项目身份

仓库：`FenLynn/gpt-pub`

项目：`projects/1-桌面软件/103-DavBridge/`

正式主线：`main`

日常开发：`p103-exp`

稳定候选：`p103-stable`

P103 长期不建立其他功能分支作为常驻维护线。

## 2. 当前版本与验证事实

当前正式版本：**v0.4.0**。

正式标签：`p103-v0.4.0`。

正式 Release 名：`DavBridge v0.4.0`。

正式 Release commit：

```text
94aa30fe488235b1a15065d54e6cf3b8c94fef47
```

当前研发候选位于 `p103-exp`，产品版本仍为 **v0.4.3**。

当前最后完成完整 P103 CI 的 UI 代码 head：

```text
4930be95d81e679f91784a91dab2c6b94a367c7d
```

对应 P103 CI：

```text
run 34480877831
scope          success
core-smoke     success
frontend       success
windows-build  success
report-status  success
```

该候选 Windows 单 EXE：

```text
DavBridge-v0.4.3-win-x64
EXE bytes: 2242139
EXE SHA256: 80a9f58ca78dab722ccc15df15127195725c4834e1f9c9950891e3546ceda6bc
Artifact ZIP SHA256: f27cd7ba0b4fbb2ce025399193c3a717940a084e1ab8b10f5e4a157b43e1eefa
Artifact ID: 10153669464
```

对应浏览器视觉预览 Artifact：

```text
DavBridge-webui-preview
Artifact ID: 10153588666
Artifact ZIP SHA256: b149644673b9173a72f293378baeda0840545a627024131f487e7058dcd85fab
```

CI 已重新通过 Vue typecheck、production build、视觉预览、Core Smoke、Windows publish、Runtime 私人数据边界、native-host self-test 和 Artifact 生成。

如果 `p103-exp` 在该代码 head 之后只有 HANDOFF 或其他纯文档提交，不得把文档提交 SHA 冒充新的 UI 代码验证 head。新对话仍应重新查询分支、CI 与 Artifact，以仓库实时事实为准。

## 3. 当前分支关系

在前一轮已验证代码快照时，`p103-exp` 已完整包含当时最新 `main`，不是从陈旧主线继续开发。随后只继续了 P103 文档和 Web UI 范围修改。

新对话必须重新查询：

```text
main
p103-stable
p103-exp
```

并重新核对三条分支的实时 head、祖先关系、ahead/behind 与 `main...p103-exp` 有效差异。不得把本文中的历史 SHA 快照当作永久不变事实。

## 4. 固定读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `/INTEGRATION_PLAYBOOK.md`
4. `projects/1-桌面软件/开发约束.md`
5. 本项目 `开发约束.md`
6. 本项目 `开发约束-v0.4-补充.md`
7. 本 `HANDOFF.md`
8. `UI架构-v0.4.md`
9. `README.md`
10. `工作记录.md`
11. `阶段记录.md`
12. `用户手册.md`
13. `数据兼容与升级.md`
14. `设计与演进.md`
15. `代码/README.md`
16. 涉及代码时再从 `代码/DavBridge.sln`、`代码/DavBridge/`、`代码/DavBridge/WebUi/` 和 `代码/DavBridge.Core/` 恢复实现事实

README 只是长期稳定入口，不承担动态状态快照职责。版本、SHA、CI、Artifact、分支关系、当前断点和待验证事项统一由 HANDOFF 维护。

## 5. v0.4 架构决策

当前运行架构：

```text
Vue 3 + TypeScript + Vite
        ↓ typed JSON bridge
Microsoft WebView2
        ↓
C# / .NET 8 极薄 Windows 宿主
        ↓
既有 DavBridge.Core 与既有 C# 安全链
```

核心原则是只换显示与交互层，不重写已经验证的迁移、安全和数据逻辑。不引入 Rust，不使用 Tauri sidecar，不把核心迁移逻辑搬进 JavaScript。

## 6. 当前 UI 方向与最新改动

总览保持固定左侧导航，一级入口仍为：

```text
总览
转移
回收站
文档

设置
关于
运行状态
```

用户对上一版 Windows 实机总览的总体结构没有大意见，但明确指出：信息块堆叠过多，小字号太多，默认窗口显得拥挤，同一状态重复出现，希望进一步美化并更多使用悬浮说明。

最新一轮没有继续做单纯字号微调，而是按“减法信息架构”重组总览：

- 顶部不再重复展示正常配置状态、Cycle 和第二个设置入口；正常配置时保持安静，只有需要配置时才显示异常入口；
- 顶部只保留页面主标题，删除重复的说明副标题；
- 左侧品牌不再重复显示版本号，版本仍保留在 Windows 标题栏和“关于”页；
- 左下运行状态只保留一个主状态文字，Cycle 与路径状态进入悬浮；
- 路径与三阶段合并为一个整体表面，取消三张独立阶段卡；
- 阶段默认只显示节点与阶段名称，删除“已完成”“等待中”等重复小字，详细阶段含义进入悬浮；
- 路径说明与当前路径状态不再单独占行，进入路径悬浮；
- 原三张 dashboard card 合并为一块统一摘要面板，仅用细分隔线区分镜像覆盖、当前任务和流量预算；
- “StrongVerified”详细解释从主界面移到“镜像覆盖”标题悬浮；
- 当前任务的长说明移到标题悬浮；
- Cycle 与额度规则移到“流量预算”标题悬浮；
- 当前任务区域直接承担主操作按钮，删除底部重复的“迁移状态”卡；
- 重置时间使用短格式显示，完整文本保留悬浮；
- 可见正文整体提高字号和留白，减少 9 px 级辅助文字；
- 正常信息默认隐退，异常、等待和需要人工处理的状态才主动浮出。

当前 UI 代码 head：

```text
4930be95d81e679f91784a91dab2c6b94a367c7d
```

文件变化集中在：

```text
代码/DavBridge/WebUi/src/App.vue
代码/DavBridge/WebUi/src/main.ts
代码/DavBridge/WebUi/src/overview.css
```

旧的版本耦合样式 `sidebar-v043.css` 已删除，改为长期名称 `overview.css`。这一步未修改 `DavBridge.Core`、WebDAV、宿主安全链或 Data 契约。

CI 浏览器预览已经显示新的结构明显减少卡片堆叠和小字，但 Linux 浏览器预览的中文字形不作为最终视觉事实。下一步仍必须以用户真实 Windows/WebView2 截图为准。

## 7. 核心冻结

最新 UI 调整没有修改 `DavBridge.Core`。以下语义继续完整冻结：

- InfiniCLOUD authoritative source 与源端只读；
- Zotero `.zip + .prop` Group；
- StrongVerified 双端 SHA256；
- 历史 GoodSync 副本强校验接管；
- SourceChanged；
- WriteUnknown reconciliation；
- HTTP 412 协调；
- quota / Cycle / 09:00 真实重置探测；
- 每周期源端对账；
- 新增对象普通 backlog；
- 回收站跨周期观察；
- 人工 DELETE 门和删除前再次核验；
- DPAPI 与现有 Data 文件；
- WebDAV GET / PUT / DELETE 实现。

如果 UI 需求与这些语义冲突，调整 UI，不降低安全门。

## 8. Web UI 权限边界

当前 C# bridge 白名单仍只有：

```text
app.getSnapshot
app.openSettings
migration.pause
migration.resume
recycle.defer
recycle.delete
```

Vue 只接收安全 DTO 和发送白名单意图。密码、DPAPI、WebDAV 客户端、state/reconcile 原文件和真正写入逻辑不得进入 JavaScript。

DELETE 仍保留双门：

```text
Web UI 删除意图
→ 前端确认
→ C# 原生最终确认
→ ReconciliationRemovalV030
→ 再次核对源端、Zotero Group、目标历史身份
→ 满足全部条件后才允许 DELETE
```

## 9. Windows 原生宿主职责

WinForms 不再承担业务页面布局，只保留：

- Windows 主窗口；
- 托盘；
- 单实例；
- 登录自启动；
- WebView2 生命周期；
- 原生设置窗口；
- 危险操作最终确认；
- 已有后台运行入口。

## 10. Data

核心 Data 保持既有兼容格式：

```text
%APPDATA%\DavBridge\config.json
%APPDATA%\DavBridge\state.json
%APPDATA%\DavBridge\state.json.bak
%APPDATA%\DavBridge\secrets.dat
%APPDATA%\DavBridge\reconcile.json
%APPDATA%\DavBridge\reconcile.json.bak
```

Runtime、Artifact、Release、源码和 CI 不得包含私人凭据、真实 Zotero 文件清单、用户日志或其他私人 Data。

## 11. CI 与差异边界

当前总览减法美化的完整 CI 已成功。Windows build 日志再次确认：

- `DavBridge.Core` 正常构建；
- Vue UI 正常嵌入单 EXE；
- Runtime 未泄露私人 Data；
- native-host self-test 通过；
- `webUiEmbedded=true`、bridge whitelist 有效、核心逻辑没有搬入 JavaScript；
- 产品版本仍为 v0.4.3。

构建仍可见既有 WindowsBase/WebView2 WPF reference conflict warning，以及旧 WinForms UI 历史文件的几个编译 warning，但本轮 CI 全部通过，本轮 UI 修改未涉及这些文件。不要为了当前视觉微调顺手扩展到无关清理。

新对话仍需重新 compare 当前 `main...p103-exp`，确认 P103 有效差异没有越过 UI、宿主与 P103 CI 范围。

自动视觉预览不是最终视觉验收，最终事实仍以用户真实 Windows 为准。

## 12. 仓库治理更新

历史文档曾描述：

```text
.github/workflows/p103-davbridge-v040-release.yml
.github/workflows/p103-davbridge-branch-hygiene.yml
```

这两套说法已经过期。一次性 Release workflow 完成正式发布后已经退役，P103 专属 branch hygiene 也已经被仓库级统一治理取代。

当前分支和发布规则只服从最新 A/B/C 约束。正常流程是：

```text
最新 main
→ p103-exp
→ PR: p103-exp → p103-stable
→ 完整候选验证
→ 用户真实 Windows 验收
→ PR: p103-stable → main
→ 用户在当前会话对明确版本明确授权
→ 正式标签与 Release
→ 按最新规则同步长期分支
```

生成候选 EXE、ZIP 或 Artifact 不等于授权正式 Release。

## 13. 当前准确断点

当前不要重新设计 Core，不要回到旧 WinForms 业务 UI，不要从历史垃圾分支恢复，不要因为 CI 绿色就自动提升 stable/main。

总览“减法美化”代码已经完成完整 CI。**当前唯一正常下一关是用户拿 `4930be95...` 对应 Windows candidate 做真实 WebView2 实机验收。**

重点观察：

- 默认窗口是否明显减少堆叠感；
- 主文字是否比上一版更容易读，是否仍存在不必要的小字；
- 路径与三阶段合并后是否简洁但仍一眼可理解；
- 镜像覆盖、当前任务、流量预算统一摘要面板的层级是否自然；
- 主操作按钮放入当前任务区是否合理；
- 悬浮提示是否足够覆盖 StrongVerified、Cycle、路径状态和阶段含义；
- 870×525 左右默认窗口、高 DPI、窗口缩放下是否出现截断、遮挡或悬浮溢出；
- 转移、回收站、文档、设置、关于等其他页面功能不受影响。

用户确认新的 Windows 实机截图后，再做下一轮精修。未经实机确认，不提升 `p103-stable` 或 `main`，不创建正式标签或 Release。

真实 DELETE 仍需等待未来合法跨周期候选自然出现后再实机验证。

## 14. 事实源

- 实现事实：源码；
- 安全逻辑事实：DavBridge.Core、Core Smoke 与既有 C# 测试；
- 构建事实：准确代码 head 对应的 CI；
- 正式发布事实：`main` 上正式标签与 GitHub Release；
- 日常开发：`p103-exp`；
- 稳定候选：`p103-stable`；
- 最终 UI 与真实 WebDAV 行为：用户真实 Windows；
- 当前治理：最新 `/GPT_RULES.md`、分类 `开发约束.md` 和本项目 `开发约束.md`。