# P103｜DavBridge

## 新聊天直接复制

> 请接续 DavBridge 软件研发，仓库为 `https://github.com/FenLynn/gpt-pub/tree/main/projects/1-桌面软件/103-DavBridge`，交接入口为 `https://github.com/FenLynn/gpt-pub/blob/main/projects/1-桌面软件/103-DavBridge/HANDOFF.md`；开始后先只做状态恢复，不要立即修改代码、文档、分支、PR、CI、标签或 Release，必须依次读取 `/GPT_RULES.md`、`/目录.md`、`/INTEGRATION_PLAYBOOK.md`、`projects/1-桌面软件/开发约束.md`、P103 `开发约束.md`、`开发约束-v0.4-补充.md`、`HANDOFF.md`、`UI架构-v0.4.md`、`README.md`、`工作记录.md`、`阶段记录.md`、`用户手册.md`、`数据兼容与升级.md`、`设计与演进.md` 和 `代码/README.md`，然后核对 `main`、`p103-stable`、`p103-exp` 的真实 head、祖先关系、P103 当前有效差异、最近 CI 和正式 Release；当前正式版本是 v0.4.0，正式标签 `p103-v0.4.0`，正式 Release commit 为 `94aa30fe488235b1a15065d54e6cf3b8c94fef47`，当前研发候选是 p103-exp 上的 v0.4.3，最后完成完整 CI 的代码 head 为 `0fcdde9fd7167a128d8104e644fe14fa29728ae9`，对应 P103 CI run `34470894206` 全绿，EXE SHA256 为 `03325839fb6bfe9090c14800ebd777375e9b98abe9578a01e2ca2d1e97ffef1c`，Artifact ZIP SHA256 为 `8fde4e1c398d420546e02856c21d37de93332397401b7cd3fdd822c5ce12a883`；v0.4.3 已把实际 Vue/WebView2 UI 改为固定左侧导航，总览重新组织为迁移路径、三阶段状态、StrongVerified 覆盖率、当前任务、流量预算和底部运行控制，大量解释文字已转为悬浮提示，DavBridge.Core、WebDAV、StrongVerified、SourceChanged、WriteUnknown、HTTP 412、quota/Cycle、每周期对账、回收站、DELETE 安全链、DPAPI 和既有 Data 格式均未修改；`p103-exp` 在该代码 head 时相对当时最新 main 为 ahead 19 / behind 0，差异仅位于 P103 CI、Vue UI、项目版本号和 Windows 宿主范围，v0.4.3 还没有提升到 stable 或 main，当前下一关只有用户 Windows 实机验收，未经明确验收不得提升，真实 DELETE 仍等待未来合法跨周期候选自然出现后再验证；注意仓库内历史文档曾有 v0.3.x、旧 P103 专属 branch hygiene 和一次性 v0.4.0 release workflow 说法，这些均已在本次文档收口中修正，当前分支治理与正式发布必须以最新 A/B/C 约束为准，正式 Release 只能在用户当前会话对明确版本作出明确人工授权后进行；状态恢复完成后请先向我汇报你核对到的正式版本、候选版本、三条分支真实关系、最后已验证代码 head、CI 证据、尚未实机验证事项和准确断点，等我确认后再继续开发。

DavBridge 是面向 Windows 的可靠、低速、可恢复、强校验的单向数据迁移、备份和镜像任务管理器。当前任务聚焦 Zotero 附件从 InfiniCLOUD 到坚果云的长期迁移与持续镜像维护。

## 当前状态

当前正式版本：**DavBridge v0.4.0**。

正式标签：`p103-v0.4.0`。

正式 Release commit：`94aa30fe488235b1a15065d54e6cf3b8c94fef47`。

当前实验候选：**v0.4.3**，位于 `p103-exp`。

最后完成完整 CI 的代码 head：

```text
0fcdde9fd7167a128d8104e644fe14fa29728ae9
```

对应 P103 CI：`34470894206`，结果 `success`。

注意：该 head 之后如果只有文档收口提交，不得把文档提交 SHA 冒充已完成 Windows 构建验证的代码 head。

## 当前运行架构

```text
Vue 3 + TypeScript + Vite
        ↓ typed JSON bridge
Microsoft WebView2
        ↓
C# / .NET 8 极薄 Windows 宿主
        ↓
既有 DavBridge.Core 与既有 C# 安全链
```

v0.4 只替换 UI 与桌面宿主展示层，不重写已经完成真实服务验证的核心迁移逻辑。

## v0.4.3 UI 候选

当前总览采用固定左侧导航，一级入口为：

```text
总览 | 转移 | 回收站 | 文档
```

左侧底部保留设置、关于和运行状态。总览主体按以下顺序组织：

```text
迁移路径
→ 三阶段状态
→ StrongVerified 覆盖率
→ 当前任务
→ 上传 / 下载流量预算
→ 底部运行控制
```

当前 UI 原则：

- 主界面减少长期解释性文字；
- StrongVerified、Cycle、端点角色、阶段含义等解释优先进入悬浮提示；
- 状态、进度、额度和主操作必须一眼可辨；
- 视觉事实以用户真实 Windows 为准；
- UI 需求不得推动核心安全逻辑重构。

## 核心安全语义

以下链路继续冻结：

```text
InfiniCLOUD authoritative source，只读
→ Zotero .zip + .prop Group
→ 源端完整 GET + SHA-256
→ 目标缺失时安全 PUT，或既有副本 NO-WRITE 接管
→ 准确资源确认
→ 目标重新 GET
→ 双端 SHA-256 一致
→ StrongVerified
→ 状态持久化
→ quota / Cycle / 网络恢复
```

同时保留：

- SourceChanged 周期维护；
- 历史 GoodSync 副本强校验接管；
- WriteUnknown reconciliation；
- HTTP 412 协调；
- 每周期 InfiniCLOUD 源端对账；
- 新增对象进入普通 backlog，不提高优先级；
- 回收站跨周期观察；
- DELETE 必须人工确认并再次核验；
- DPAPI 与既有 Data 文件；
- 坚果云上传、下载额度与安全预留。

Vue 前端只接收安全 DTO 和发送白名单命令。WebDAV 凭据、DPAPI、原始 state/reconcile 文件和真正的 PUT/DELETE 逻辑不进入 JavaScript。

## 当前入口

- 新对话固定接续入口：[HANDOFF.md](HANDOFF.md)
- 项目长期硬规则：[开发约束.md](开发约束.md)
- v0.4 UI 迁移补充约束：[开发约束-v0.4-补充.md](开发约束-v0.4-补充.md)
- v0.4 UI 架构：[UI架构-v0.4.md](UI架构-v0.4.md)
- 当前开发记录：[工作记录.md](工作记录.md)
- 正式与开发阶段：[阶段记录.md](阶段记录.md)
- 用户行为说明：[用户手册.md](用户手册.md)
- 本地 Data 升级与回滚：[数据兼容与升级.md](数据兼容与升级.md)
- 重大架构取舍：[设计与演进.md](设计与演进.md)
- 完整源码与恢复入口：[代码/README.md](代码/README.md)
- Visual Studio / dotnet 统一解决方案：[代码/DavBridge.sln](代码/DavBridge.sln)

## Data

Runtime 与私人 Data 严格分离：

```text
%APPDATA%\DavBridge\config.json
%APPDATA%\DavBridge\state.json
%APPDATA%\DavBridge\state.json.bak
%APPDATA%\DavBridge\secrets.dat
%APPDATA%\DavBridge\reconcile.json
%APPDATA%\DavBridge\reconcile.json.bak
```

Release、Artifact、源码和 CI 不得包含真实 WebDAV 凭据、私人 Zotero 文件清单、用户日志或其他私人 Data。

## 工程与治理

活动 CI：

```text
.github/workflows/p103-davbridge-ci.yml
```

长期分支：

```text
main
p103-exp
p103-stable
```

当前仓库已经使用统一分支治理规则，不再依赖历史的 P103 专属 branch hygiene workflow。旧 v0.4.0 一次性 Release workflow 已完成使命并退役，不得按旧文档重新启用。

正常提升流程以最新 A/B/C 约束为准：

```text
最新 main
→ p103-exp
→ PR: p103-exp → p103-stable
→ 完整候选验证与实机验收
→ PR: p103-stable → main
→ 用户对明确版本再次明确授权
→ 正式标签与 Release
```

## 当前断点

v0.4.3 当前只等待用户 Windows 实机 UI 和交互验收。未经明确验收，不提升 `p103-stable` 或 `main`，不创建正式标签或 Release。

真实 DELETE 继续等待未来合法跨周期候选自然出现后再做真实账户验证。