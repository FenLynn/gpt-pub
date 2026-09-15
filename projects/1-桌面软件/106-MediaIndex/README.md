# P106｜MediaIndex

MediaIndex 是面向大规模照片与视频库存的只读内容检索工具。核心目标不是传统“重复文件清理”，而是回答：

> 给定一张图片、一个视频或一批媒体，库存中是否已经存在同源素材；如果存在，准确返回所在路径与匹配置信度。

## 当前阶段

**Phase 0：图片算法与索引路线验证。**

当前不进入正式产品 UI 开发，不做自动删除、移动、重命名或整理用户文件。优先证明：

1. 图片同源识别在压缩、缩放、转格式、水印、裁剪等变化下的召回能力。
2. 强裁剪和局部变化下的精确验证能力。
3. 难负样本下的误报边界。
4. 数十万级库存的索引体积、候选召回与查询延迟。
5. 图片路线冻结后，再进入视频转码与片段检索验证。

## 项目身份

- 预留编号：`P106`
- 预留路径：`projects/1-桌面软件/106-MediaIndex/`
- 日常开发：`p106-exp`
- 稳定候选：`p106-stable`
- 正式主线：`main`
- 固定流转：`main → p106-exp → p106-stable → main`

> 当前按用户要求仅维护 P106 自有目录与两条长期分支，不修改 `/目录.md` 或任何公共文件。因此 P106 在共享目录索引中的正式登记仍待后续统一仓库任务完成。

## 当前图片架构候选

```text
SQLite metadata / exact hash
  ↓
Lane A
selected multi-region pHash
current study: 28 to 60 regions
  +
Lane B
compact visual-word inverted index
  ↓
candidate union
current conservative budget: about Top-50
  ↓
high texture
SIFT + RANSAC + content consistency

low texture
template / edge fallback
  ↓
Confirmed / Probable / Similar / Not found
```

AI embedding 暂不作为最终同源判据。只有传统召回链在更大真实数据上仍存在不可接受漏检时，才重新评估是否引入。

## 重要边界

- 默认只读现有媒体，不接管目录结构。
- 索引数据库与原媒体分离。
- 不以单一相似度直接删除或覆盖文件。
- 合成测试只能用于路线和工程量级探索，不能替代真实照片域验证。
- benchmark 必须记录数据集、参数、代码版本、结果与失败案例。
- 私人照片、视频、真实用户路径、未脱敏日志不得提交到公开仓库。

## 当前文档

- `docs/algorithm-validation.md`：R001 以后所有算法和微基准事实。
- `docs/benchmark-plan.md`：验证计划与冻结条件。
- `docs/architecture.md`：当前架构草案。
- `docs/index-storage.md`：50 万级索引与存储草案。
- `experiments/`：公开安全的可复现微基准脚本。

## 接续入口

新对话先读 `HANDOFF.md`，并按其中固定顺序重新核对仓库真实状态。
