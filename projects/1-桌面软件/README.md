# 1｜桌面软件

本分类维护 GPT-Pub 中已经确认可以公开的桌面软件源码、测试、CI、版本说明和 Release。

## 设计记录参考

长期维护的软件项目建议遵循 [《软件设计记录建议书》](软件设计记录建议书.md)，通过 `README.md`、`开发约束.md`、设计与演进记录、`工作记录.md` 和 `阶段记录.md` 分别维护项目入口、当前规则、设计原因、实时进度和正式版本证据。

小型工具可以采用轻量结构，不为形式创建长期空白文档；已有项目应从下一轮开发开始渐进收敛，不为文档改名或整理破坏稳定历史。

## 当前项目

| 编号 | 项目 | 状态 | 正式路径 |
|---|---|---|---|
| P101 | [Mediova](101-Mediova/) | v4.5.5 稳定候选，待实机验收 | `101-Mediova/` |
| P102 | [AtlasDesk](102-AtlasDesk/) | v1.3.0 候选源码已纳入主线 | `102-AtlasDesk/` |
| P103 | [DavBridge](103-DavBridge/) | v0.4 候选源码已纳入主线 | `103-DavBridge/` |
| P104 | [CodexHandoff](104-CodexHandoff/) | v1.0.0-alpha.1 Tauri 重构开发中 | `104-CodexHandoff/` |
| P105 | [LocalSub](105-LocalSub/) | v0.1.1-dev 候选源码已纳入主线 | `105-LocalSub/` |

## 分支模型

| 项目 | 日常开发 | 稳定候选 | 正式主线 |
|---|---|---|---|
| P101 | `p101-exp` | `p101-stable` | `main` |
| P102 | `p102-exp` | `p102-stable` | `main` |
| P103 | `p103-exp` | `p103-stable` | `main` |
| P104 | `p104-exp` | `p104-stable` | `main` |
| P105 | `p105-exp` | `p105-stable` | `main` |

默认流程：`main → exp → stable → main → 标签与 Release → 回流 exp/stable`。

各项目长期分支相对最新 `main` 只能修改本项目目录、本项目 CI 与必要状态记录；项目长期分支不得互相合并。
