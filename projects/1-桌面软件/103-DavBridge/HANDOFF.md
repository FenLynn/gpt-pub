# DavBridge 对话接续入口

本文件用于在更换 ChatGPT 对话后恢复 P103 DavBridge 项目上下文。

- 仓库：`FenLynn/gpt-pub`
- 项目编号：`P103`
- 项目路径：`projects/1-桌面软件/103-DavBridge/`
- 日常开发分支：`p103-exp`
- 稳定候选分支：`p103-stable`
- 正式主线：`main`

本文件只规定固定接续流程，不重复维护当前版本、提交、PR、CI、Artifact、待办或用户实机反馈。

## 固定读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. 本项目 `开发约束.md`
5. 本项目 `README.md`
6. 本项目 `阶段记录.md`
7. 本项目 `工作记录.md`
8. 与当前任务有关时读取 `设计与演进.md`

随后必须核对：

- `main`、`p103-stable`、`p103-exp` 的最新提交和相互关系；
- DavBridge 的开放 PR、最近合并 PR 和准确 head SHA；
- P103 GitHub Actions、测试结果和 Windows Runtime Artifact；
- 正式标签与 Release 是否真实存在；
- 哪些能力已自动验证，哪些仍只是假设或待真实 InfiniCLOUD / 坚果云账户验证。

## 事实源

```text
实现事实 → 源码
验证事实 → 测试与 CI
历史事实 → Git、PR、标签与 Release
当前规则 → A/B/C 开发约束
当前状态 → README、阶段记录与工作记录
真实服务行为 → 用户账户实测与明确记录
```

旧聊天记录用于快速定位，不替代仓库与真实服务核验。尤其不得把坚果云未公开的额度耗尽响应、750 项后分页协议细节或其他推测写成已验证能力。

## 接续后的首次回复

先说明：

- 当前正式版本和正式主线状态；
- 当前稳定候选或开发版本；
- `main`、`p103-stable`、`p103-exp` 的真实关系；
- 最近完成事项；
- 尚未完成或尚待实机验证事项；
- 准确继续断点；
- 本次是否进行了任何写入。

用户只要求接续或确认状态时，不得修改代码、文档、分支、PR、CI、标签或 Release。

## 写入前要求

用户明确要求继续修改后，仍须：

1. 明确允许修改范围仅为 P103 项目目录、P103 CI 和必要的 P103 状态入口；
2. 日常串行开发进入 `p103-exp`，不得直接写 `main` 或 `p103-stable`；
3. 修改已有文件前读取同一分支的最新文件与 SHA；
4. 不得夹带 P101 Mediova、P102 AtlasDesk 或其他项目修改；
5. 候选提升、正式准入、Artifact 和 Release 继续服从 A/B/C 约束。

## 转交模板

```text
请接续 DavBridge 项目。请先阅读并严格按照下面的 HANDOFF.md 恢复项目上下文：
https://github.com/FenLynn/gpt-pub/blob/main/projects/1-%E6%A1%8C%E9%9D%A2%E8%BD%AF%E4%BB%B6/103-DavBridge/HANDOFF.md

我可能会在本段文字后附上上一轮交接记录；如未附上，请直接从仓库恢复上下文。请先核对并汇报当前正式版本、当前稳定候选或开发版本、main/p103-stable/p103-exp 的真实关系、最近完成事项、未完成或待实机验证事项及准确断点。本轮先不要修改代码、文档、分支、PR、CI、标签或 Release。
```
