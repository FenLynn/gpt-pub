# DavBridge 对话接续入口

本文件用于恢复 P103 DavBridge 当前事实与准确断点。新对话不得只凭聊天记忆继续，必须按本文与 A/B/C 约束重新核对仓库事实。

## 1. 项目身份

仓库：`FenLynn/gpt-pub`

项目：`projects/1-桌面软件/103-DavBridge/`

正式主线：`main`

日常开发：`p103-exp`

稳定候选：`p103-stable`

P103 长期不建立其他功能分支作为常驻维护线。

## 2. 当前版本事实

当前正式版本：**v0.4.0**。

正式标签：`p103-v0.4.0`。

正式 Release 名：`DavBridge v0.4.0`。

正式 Release commit：

```text
94aa30fe488235b1a15065d54e6cf3b8c94fef47
```

当前研发候选位于 `p103-exp`。新对话必须重新读取项目文件中的产品版本，并以当前分支真实 head 和最近完整 CI 为准。

此前最后完成完整 P103 CI 的代码 head 为：

```text
0fcdde9fd7167a128d8104e644fe14fa29728ae9
```

对应 P103 CI：

```text
run 34470894206
scope          success
core-smoke     success
frontend       success
windows-build  success
report-status  success
```

该候选的 EXE SHA256：

```text
03325839fb6bfe9090c14800ebd777375e9b98abe9578a01e2ca2d1e97ffef1c
```

Artifact ZIP SHA256：

```text
8fde4e1c398d420546e02856c21d37de93332397401b7cd3fdd822c5ce12a883
```

之后存在文档收口提交，以及一轮新的总览 UI 减法美化提交。**不要把尚未完成完整 CI 的新提交冒充已验证代码基线。**

## 3. 当前分支关系

此前最后已验证代码 head 时：

```text
p103-exp relative to then-current main:
ahead 19
behind 0
```

说明当时 `p103-exp` 已包含最新 `main`，不是从陈旧主线继续开发。

当时 `main`：

```text
042329ede97b09cd375ebcf7c55d7245fc56b933
```

当时 `p103-stable`：

```text
d8d5aed844ca2944c8511c85c0a892dbbd411fc5
```

新对话必须重新查询三条分支的实时 head 和祖先关系，不得把上述快照当作永久不变事实。

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

用户对上一版实机总览的总体布局没有大意见，但明确反馈：

- 信息块堆叠过多；
- 小字号太多；
- 默认窗口下显得拥挤；
- 同一状态重复显示；
- 应更多使用悬浮说明。

最新一轮已经按“减法信息架构”调整总览，重点不是简单缩小或放大字号，而是减少重复层级：

- 顶部不再重复展示正常配置状态、Cycle 和第二个设置入口；仅在需要配置时显示异常提示；
- 左侧品牌不再重复显示版本号，版本保留在“关于”页和 Windows 标题栏；
- 左下运行状态只保留一个主状态文字，Cycle 放入悬浮信息；
- 路径卡内合并三阶段，取消三张独立阶段卡和“已完成/等待中”等重复小字；
- 路径说明和当前路径状态改为悬浮；
- 原三张 dashboard card 合并为一块统一摘要面板，以细分隔线区分镜像覆盖、当前任务和流量预算；
- `StrongVerified` 详细含义从主界面移到“镜像覆盖”标题悬浮；
- 当前任务详细原因移到标题悬浮；
- Cycle 规则移到“流量预算”标题悬浮；
- 当前任务区域直接承担主操作按钮，删除底部重复的“迁移状态”卡；
- 重置时间压缩为短格式显示，完整文本保留悬浮；
- 正常状态默认隐退，异常和需要人工操作的状态才主动浮出。

对应最新 UI 代码提交为：

```text
4c67753c2ba7ed775efd5bdfd5f651e8e97039c1
```

该提交更新 `App.vue`，新增长期名称 `overview.css`，并移除版本耦合的 `sidebar-v043.css`；同时 `main.ts` 改为导入 `overview.css`。该提交尚需完整 CI 和新的 Windows 实机截图确认。

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

此前最后已验证代码 head 的 `main → p103-exp` 有效差异只位于 P103 CI、Windows 宿主和 Web UI 范围，没有 `DavBridge.Core` 差异。

最新总览 UI 减法美化仍只触及 Web UI 文件，不应扩大核心差异范围。新对话必须重新 compare 当前 `main...p103-exp`，确认这一事实。

CI 必须继续验证：

- Core Smoke；
- Vue typecheck 与 production build；
- 浏览器视觉预览；
- Windows x64 framework-dependent single EXE；
- Runtime 私人数据边界；
- 隔离 native-host self-test；
- SHA256 与候选 Artifact。

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

当前最近一步是总览 UI 的减法美化。正常下一步顺序为：

1. 等待并核对 `4c67753c...` 对应完整 P103 CI；
2. 如果 CI 全绿，使用该准确 head 的 Windows candidate；
3. 用户在真实 Windows 上重点检查默认窗口视觉密度、字号、悬浮提示、三阶段合并后的清晰度、统一摘要面板和主操作按钮位置；
4. 只有用户确认实机结果后，才决定是否继续微调或进入稳定提升流程。

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