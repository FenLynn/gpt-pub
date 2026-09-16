# P106｜MediaIndex

MediaIndex 是面向大规模照片与视频库存的只读内容检索工具。核心目标不是传统“重复文件清理”，而是回答：

> 给定一张图片或视频，库存中是否已经存在同源素材；如果存在，返回最可能的来源、真实路径、来源区间与置信层级。

## 当前阶段

**Phase 1：从验收工具进入正式 MediaIndex Product Preview。**

图片算法验证已经完成 R001 至 R016，并完成第一轮用户真实自动验收：

```text
20 library images
40 automatic positive queries
4 automatic negative sanity queries
Top-1 positive = 100%
Top-50 recall = 100%
false Confirmed = 0
```

视频算法、时间层和规模验证已完成至 V014。

Acceptance 工具继续保留为诊断与回归入口，但不再作为最终产品主界面。

## 项目身份

- 编号：`P106`
- 路径：`projects/1-桌面软件/106-MediaIndex/`
- 日常开发：`p106-exp`
- 稳定候选：`p106-stable`
- 正式主线：`main`
- 固定流转：`main → p106-exp → p106-stable → main`

用户已授权 P106 专用 Windows workflow 作为此前“只修改 P106 自有目录”规则的唯一公共文件例外：

```text
.github/workflows/p106-mediaindex-acceptance.yml
```

除该 workflow 外，仍不修改共享入口、其他项目或公共配置。

## 正式主程序

新的正式用户入口：

```text
MediaIndex.exe
```

源码：

```text
src/MediaIndex.App/
```

v0.1.0 Product Preview 当前实现：

- 选择现有图片库存目录。
- 建立持久图片索引。
- 二次索引复用未变化文件。
- 拖入或选择 Query 图片。
- 返回排名、判断层级、库存相对路径和真实绝对路径。
- 双击候选可在资源管理器中定位。
- 原始库存保持只读。
- 索引保存在用户 LocalAppData。
- 原盘暂时离线时仍可利用持久 pHash 索引产生候选。
- 内置自动验收页。

详细架构见：

- `docs/product-architecture.md`
- `docs/index-storage.md`

## 当前图片产品链

当前 Product Preview：

```text
persistent metadata
→ persistent selected-region pHash matrix
→ Top candidate shortlist
→ SIFT + Lowe ratio + RANSAC
→ NCC/content consistency
→ low-confidence grayscale/edge template fallback
→ Exact / Confirmed / Probable / Candidate
```

目标生产链仍为：

```text
exact / metadata
→ persistent pHash Lane A
→ persistent local-feature Lane B
→ candidate union
→ deep verifier
→ low-texture fallback
→ final source result
```

因此 v0.1.0 是正式产品壳与持久 Lane A 的开始，不代表 500k 媒体生产索引已经冻结。

## 持久图片索引

每个图片库存对应：

```text
%LOCALAPPDATA%\FenLynn\MediaIndex\Indexes\<library-id>\
├─ index.sqlite3
├─ region_hashes.npy
└─ image_ids.npy
```

SQLite 负责：

- 路径与元数据。
- 增量状态。
- lazy SHA-256 exact evidence。

紧凑 NumPy 矩阵负责高吞吐 Hamming/popcount candidate retrieval。

## Hard-negative gate

P106 Windows CI 不只跑 easy positives。

当前还必须通过 known hard-negative suite，包括：

- 同场景不同 camera / parallax。
- 相同 poster/template 但主体内容不同。
- 重复纹理与相位变化。
- 低纹理 look-alike。

如果这些已知 hard negatives 被提升成高置信 same-source，构建失败，不生成正式候选 EXE。

## Acceptance 诊断工具

诊断入口仍保留：

```text
MediaIndex Acceptance.exe
```

它用于：

- 自动 A4/V011 smoke。
- 实际算法回归。
- 生成匿名统计。
- 特殊失败案例的手工 Query。

普通用户后续不需要先进入 Acceptance 才能搜索库存。

## 当前视频架构

视频目标保持：

```text
Tier V0
~1 fps lightweight temporal anchors

Tier V1
sparse timestamp-preserving local-feature keyframes

Tier V2
sparse verifier cache / source decode

Audio Lane C
compact audio fingerprint sequence

temporal alignment
constant / affine / piecewise
```

Product Preview 当前先完成持久图片检索。视频持久索引会沿该已验证架构接入同一个 MediaIndex 主程序，而不是复制图片索引结构。

## 当前关键文档

- `docs/product-architecture.md`
- `docs/algorithm-validation.md`
- `docs/video-validation.md`
- `docs/architecture.md`
- `docs/video-architecture.md`
- `docs/index-storage.md`
- `docs/real-domain-acceptance.md`
- `docs/acceptance-app.md`
- `docs/benchmark-plan.md`
- `HANDOFF.md`

## 接续入口

新对话先读 `HANDOFF.md`，再按照其中顺序核对仓库真实状态和 CI。

## v0.2.0｜Persistent Lane B

v0.2.0 把此前 benchmark 阶段的 local-feature 候选召回正式接入持久索引。

```text
Lane A
selected multi-region pHash

Lane B
ORB descriptors
→ deterministic compact local words
→ persistent inverted postings

Lane A + Lane B
→ reciprocal-rank candidate union
→ adaptive deep verification
→ Confirmed / Probable / Candidate
```

当前 Lane B 的职责仅是候选召回。它不会因为 local-word 相似直接宣布同源。

对于极端小裁剪，若保守 `Confirmed` 未满足，但 SIFT 几何、query coverage 与内容一致性共同形成很强证据，则可进入独立 `Probable` 层。`Confirmed` 的 hard-negative 门槛没有因此降低。

深度验证采用自适应预算：先验证少量融合候选，如果尚无强证据，再优先扩展 Lane B 与 Lane A 的靠前候选，找到强证据后停止。
