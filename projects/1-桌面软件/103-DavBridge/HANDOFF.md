# DavBridge 对话接续入口

本文件用于在更换 ChatGPT 对话后恢复 P103 DavBridge 项目上下文。

- 仓库：`FenLynn/gpt-pub`
- 项目编号：`P103`
- 项目路径：`projects/1-桌面软件/103-DavBridge/`
- 日常开发分支：`p103-exp`
- 稳定基线分支：`p103-stable`
- 正式主线：`main`
- 第一阶段固化版本：`v0.1.7`

本文件只维护固定接续流程。版本事实、真实验证、当前待办与断点分别以 `阶段记录.md`、`工作记录.md`、PR、CI 和 Git 历史为准。

## 固定读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. 本项目 `开发约束.md`
5. 本项目 `README.md`
6. 本项目 `阶段记录.md`
7. 本项目 `工作记录.md`
8. 与当前任务有关时读取 `设计与演进.md`
9. 涉及代码时读取 `代码/README.md`，以 `代码/DavBridge.sln` 为统一源码入口

随后必须核对 `main`、`p103-stable`、`p103-exp` 的最新提交和关系，以及 P103 的开放 PR、最近 CI、Artifact、标签和 Release。

## 源码恢复规则

- P103 首次正式准入后，**`main` 是正式稳定事实源**。
- `p103-stable` 保存当前稳定基线，`p103-exp` 承载下一阶段日常开发。
- 当前源码统一入口：`projects/1-桌面软件/103-DavBridge/代码/DavBridge.sln`。
- `DavBridge.Core`、`DavBridge`、`DavBridge.Smoke` 三个工程缺一不可。
- 本地 `bin`、`obj`、发布目录、用户配置、状态、凭据和日志不属于源码事实。
- 开始下一阶段开发前必须先按 B 级规则同步最新 `main` 到 `p103-exp`，不得在过时基线上直接提升。

## 事实源

```text
实现事实 → 源码
验证事实 → 测试与 CI
历史事实 → Git、PR、标签与 Release
当前规则 → A/B/C 开发约束
当前状态 → README、阶段记录与工作记录
真实服务行为 → 用户账户实测与明确记录
```

不得把坚果云未公开的额度耗尽响应、750 项后分页协议细节或其他推测写成已验证能力。

## 接续后的首次回复

先说明当前正式版本、main/stable/exp 关系、最近完成事项、尚待验证事项、准确断点，以及本次是否进行了写入。用户只要求接续或确认状态时，不得修改代码、文档、分支、PR、CI、标签或 Release。

## 写入规则

用户明确要求继续修改后：

1. 修改范围限于 P103 项目目录、P103 CI 和确有必要的 P103 状态入口；
2. 日常开发只进入 `p103-exp`；
3. 不直接在 `main` 或 `p103-stable` 开发功能；
4. 修改已有文件前读取目标分支的最新文件与 SHA；
5. 不夹带 P101、P102 或其他项目修改；
6. 提升流程固定为 `exp → stable → main`。

## 当前转交模板

```text
请接续 DavBridge 项目。请先阅读并严格按照下面的 HANDOFF.md 恢复项目上下文：
https://github.com/FenLynn/gpt-pub/blob/main/projects/1-%E6%A1%8C%E9%9D%A2%E8%BD%AF%E4%BB%B6/103-DavBridge/HANDOFF.md

我可能会在本段文字后附上上一轮交接记录；如未附上，请直接从仓库恢复上下文。请先核对并汇报当前正式版本、当前稳定候选或开发版本、main/p103-stable/p103-exp 的真实关系、最近完成事项、未完成或待实机验证事项及准确断点。本轮先不要修改代码、文档、分支、PR、CI、标签或 Release。
```
