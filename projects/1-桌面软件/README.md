# 1｜桌面软件

本分类维护 GPT-Pub 中已经确认可以公开的桌面软件源码、测试、CI、版本说明和 Release。

## 当前项目

| 编号 | 项目 | 状态 | 正式路径 |
|---|---|---|---|
| P101 | [Mediova](101-Mediova/) | v4.0.0 公开迁移验证中 | `101-Mediova/` |
| P102 | [AtlasDesk](102-AtlasDesk/) | v0.7.4 已正式发布 | `102-AtlasDesk/` |

## 分支模型

| 项目 | 日常开发 | 稳定候选 | 正式主线 |
|---|---|---|---|
| P101 | `p101-exp` | `p101-stable` | `main` |
| P102 | `p102-exp` | `p102-stable` | `main` |

默认流程：`main → exp → stable → main → 标签与 Release → 回流 exp/stable`。

P101 分支相对最新 `main` 只能修改 P101 目录、P101 CI 与必要状态记录；P102 同理。项目长期分支不得互相合并。
