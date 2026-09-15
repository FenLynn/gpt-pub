# P106｜MediaIndex

MediaIndex 是面向大规模照片与视频库存的只读内容检索工具。核心目标不是传统“重复文件清理”，而是回答：

> 给定一张图片、一个视频或一批媒体，库存中是否已经存在同源素材；如果存在，准确返回所在路径与匹配置信度。

## 当前阶段

**Phase 0：图片索引收敛 + 视频算法可行性验证。**

当前不进入正式产品 UI 开发，不做自动删除、移动、重命名或整理用户文件。

图片主线已经推进到 R016，核心视觉底座基本形成。视频不再等待图片 UI 或 MVP 完成，而是在同一 `p106-exp` 上提前验证时间序列层，避免后续数据库和索引格式因为视频需求再次重构。

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
optional 256 to 320px verifier thumbnail
  ↓
high texture
SIFT + RANSAC + content consistency

low texture
template / edge fallback
  ↓
Confirmed / Probable / Similar / Not found
```

## 当前视频架构候选

```text
video
  ↓
exact hash / media metadata
  ↓
adaptive sampled frames
  ↓
reuse image fingerprints
  ↓
frame-to-video inverted retrieval
  ↓
candidate video + timestamp correspondences
  ↓
offset / affine-speed / piecewise temporal alignment
  ↓
selected-frame image verifier
  ↓
Same video / Derived / Partial clip / Similar / Not found
```

V001 至 V004 已证明：

- 完整转码、分辨率和 fps 变化可由低采样率 frame pHash 序列稳定识别。
- 8 s 中间 clip 可以恢复源视频和 source offset。
- 1.05× 速度变化可以恢复时间 scale。
- 插入片头可以恢复主内容的 offset。
- 删除中间片段会产生 piecewise 时间关系，单一 affine model 不够。
- 3 s clip 虽能正确 Top-1，但可能出现非常接近的第二候选，因此不能仅凭短序列自动 Confirmed。

AI embedding 暂不作为最终同源判据。只有传统召回链在更大真实数据上仍存在不可接受漏检时，才重新评估是否引入。

## 重要边界

- 默认只读现有媒体，不接管目录结构。
- 索引数据库与原媒体分离。
- 不以单一相似度直接删除或覆盖文件。
- 合成测试只能用于路线和工程量级探索，不能替代真实照片 / 视频域验证。
- benchmark 必须记录数据集、参数、代码版本、结果与失败案例。
- 私人照片、视频、真实用户路径、未脱敏日志不得提交到公开仓库。

## 当前文档

- `docs/algorithm-validation.md`：R001 以后图片算法和微基准事实。
- `docs/video-validation.md`：V001 以后视频算法验证事实。
- `docs/benchmark-plan.md`：验证计划与冻结条件。
- `docs/architecture.md`：图片架构草案。
- `docs/video-architecture.md`：视频时间序列架构草案。
- `docs/index-storage.md`：50 万级索引与存储草案。
- `experiments/`：公开安全的可复现微基准与视频验证脚本。

## 接续入口

新对话先读 `HANDOFF.md`，并按其中固定顺序重新核对仓库真实状态。
