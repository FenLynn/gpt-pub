# DavBridge 对话接续入口

本文件用于在更换 ChatGPT 对话后恢复 P103 DavBridge 项目上下文。

- 仓库：`FenLynn/gpt-pub`
- 项目编号：`P103`
- 项目路径：`projects/1-桌面软件/103-DavBridge/`
- 日常开发分支：`p103-exp`
- 稳定基线分支：`p103-stable`
- 正式主线：`main`
- 第一阶段正式稳定基线：`v0.1.7`
- 当前开发阶段：`v0.2.x` 通用任务化与 UI / 日常流程重构

`main` 上的 v0.1.7 是已获真实 InfiniCLOUD / 坚果云验证的回滚基线。v0.2 开发不得破坏这一基线的数据格式、强校验语义和恢复能力。

## 固定读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. 本项目 `开发约束.md`
5. 本项目 `README.md`
6. 本项目 `阶段记录.md`
7. 本项目 `工作记录.md`
8. 涉及 v0.2 通用化、任务模型或 UI 流程时读取 `通用任务架构.md`
9. 涉及升级、本地 Data、回滚或多任务持久化时读取 `数据兼容与升级.md`
10. 与重大历史取舍有关时读取 `设计与演进.md`
11. 涉及代码时读取 `代码/README.md`，以 `代码/DavBridge.sln` 为统一源码入口

随后必须核对 `main`、`p103-stable`、`p103-exp` 的最新提交和关系，以及 P103 的开放 PR、最近 CI、Artifact、标签和 Release。

## 分支事实源

- `main`：正式稳定事实源，当前第一阶段基线为 v0.1.7；
- `p103-stable`：稳定候选 / 已固化基线；
- `p103-exp`：当前 v0.2.x 日常开发事实源；
- v0.2 未经实机 UI 与兼容验证不得直接进入 stable 或 main。

## v0.2 当前架构边界

DavBridge 正从 Zotero 专用迁移器升级为：

> 可靠、低速、可恢复、强校验的单向迁移、备份和镜像任务管理器。

明确不做双向同步，不做删除传播、双向冲突合并或循环同步。

Zotero 不被删除，而是作为固定任务模板保留。当前 v0.1.7 单任务通过 `LegacyV017Adapter` 只读投影为一个 Zotero 任务。

## v0.1.7 Data 兼容硬规则

当前核心用户 Data：

- `%APPDATA%/DavBridge/config.json`
- `%APPDATA%/DavBridge/state.json`
- `%APPDATA%/DavBridge/state.json.bak`
- `%APPDATA%/DavBridge/secrets.dat`

v0.2 Phase A/B 不重写这些文件。允许新增可删除的 `v2-compat.json` sidecar，但其中不得保存密码、TransferRecord 或配额账本。

未来真正引入多任务持久化前，必须先完成备份、迁移、等价性校验和回滚路径。若内建转换不能足够安全，必须同时提供独立一次性转换工具或脚本。不得要求用户手工编辑 JSON。

已有 TransferRecord 的当前任务不得直接改写源 / 目标 URL、root 或用户名来变成另一项任务。新的源目标组合必须创建新任务，从而隔离旧 StrongVerified、配额和断点记录。

## 当前 v0.2 实现断点

当前 `p103-exp` 已包含：

- `Task / Endpoint / Policy / Template` 通用模型；
- 普通 WebDAV 单向模板和 Zotero WebDAV 固定模板；
- v0.1.7 只读任务投影；
- 回滚安全的 `v2-compat.json` 端点安全指纹；
- 第一版左侧任务、右侧详情的任务型主界面；
- 初始化 / 诊断工具折叠到次级区域；
- Running / Paused / WaitQuota 等人类可读状态；
- Paused 状态显示“暂停断点”；
- 已完成双安全门且端点身份未变化时，日常“暂停 → 继续”直接恢复，不再重复整库扫描和长期启用确认；
- 已有迁移记录后，设置页禁止直接改写任务端点身份。

底层仍使用 v0.1.7 已验证的 `MigrationEngine`、`DavBridgeConfig`、`MigrationState`、`StateStore`、DPAPI 凭据和配额状态机。

## 事实源

```text
实现事实 → 源码
验证事实 → 测试与 CI
历史事实 → Git、PR、标签与 Release
当前规则 → A/B/C 开发约束
当前状态 → README、阶段记录与工作记录
通用化设计 → 通用任务架构.md
Data 升级与回滚 → 数据兼容与升级.md
真实服务行为 → 用户账户实测与明确记录
```

不得把坚果云未公开的额度耗尽响应、750 项后分页协议细节或其他推测写成已验证能力。

## 接续后的首次回复

先说明：

- 当前正式稳定基线和正式主线状态；
- 当前 v0.2 开发版本；
- `main / p103-stable / p103-exp` 的真实关系；
- 最近完成事项；
- 尚待自动或实机验证事项；
- 本地 Data 是否发生格式变化；
- 准确继续断点；
- 本次是否进行了任何写入。

用户只要求接续或确认状态时，不得修改代码、文档、分支、PR、CI、标签或 Release。

## 写入规则

用户明确要求继续修改后：

1. 修改范围限于 P103 项目目录、P103 CI 和确有必要的 P103 状态入口；
2. 日常开发只进入 `p103-exp`；
3. 不直接在 `main` 或 `p103-stable` 开发功能；
4. 修改已有文件前读取目标分支最新文件与 SHA；
5. 不夹带 P101、P102 或其他项目修改；
6. 不为 UI / 抽象重构降低 v0.1.7 数据安全语义；
7. 提升流程固定为 `exp → stable → main`。

## 当前转交模板

```text
请接续 DavBridge 项目。请先阅读并严格按照下面的 HANDOFF.md 恢复项目上下文：
https://github.com/FenLynn/gpt-pub/blob/main/projects/1-%E6%A1%8C%E9%9D%A2%E8%BD%AF%E4%BB%B6/103-DavBridge/HANDOFF.md

如需继续当前 v0.2 开发，请在恢复正式基线后再读取 p103-exp 上同路径的 HANDOFF.md、通用任务架构.md、数据兼容与升级.md 和工作记录.md，并核对准确 head 与 CI。本轮若只要求恢复状态，先不要修改代码、文档、分支、PR、CI、标签或 Release。
```
