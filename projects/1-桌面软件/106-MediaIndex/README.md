# P106｜MediaIndex

MediaIndex 是面向大规模照片与视频库存的只读内容检索工具。核心目标不是传统“重复文件清理”，而是回答：

> 给定一张图片、一个视频或一批媒体，库存中是否已经存在同源素材；如果存在，准确返回位置、来源区间和置信度。

## 当前阶段

**Phase 0：真实域验收前最后收口。**

图片算法验证已完成至 R016。

视频算法、时间层和规模验证已完成至 V014。

当前不进入正式 UI 开发。下一阶段是 A4 + V011 用户真实域验收。

## 项目身份

- 编号：`P106`
- 路径：`projects/1-桌面软件/106-MediaIndex/`
- 日常开发：`p106-exp`
- 稳定候选：`p106-stable`
- 正式主线：`main`
- 固定流转：`main → p106-exp → p106-stable → main`

> 当前按用户要求只维护 P106 自有目录，不修改共享 `/目录.md` 和其他公共文件。

## 当前图片架构

```text
Exact hash
→ selected multi-region pHash
→ compact local-feature candidate retrieval
→ about Top-50
→ high texture: SIFT + RANSAC + content consistency
→ low texture: template / edge fallback
→ Confirmed / Probable / Similar / Not found
```

## 当前视频架构

```text
Exact hash / metadata
        ↓
Tier V0
~1 fps lightweight temporal pHash anchors
        +
Tier V1
sparse timestamp-preserving local-feature keyframes
        +
Audio Lane C
        ↓
candidate correspondences
        ↓
constant / affine / piecewise temporal alignment
        ↓
Tier V2 selected-frame verifier
        ↓
Exact / Same / Derived / Partial / Composite / Ambiguous / Similar / Not found
```

视频当前已经验证：

- 完整转码。
- 分辨率 / fps 变化。
- 3 s 至 8 s clip。
- speed change。
- 插片头。
- 中间删除。
- 字幕。
- letterbox。
- 画中画。
- 强竖屏裁剪及 SIFT rescue。
- 多源 Composite。
- 共享片头 / 片尾歧义。
- source 内重复片段。
- Audio fingerprint。
- 1,000 h 至 50,000 h 索引容量模型。

## 当前重要工程结论

1. 图片与视频共享视觉算法，不共享相同的索引记录密度。
2. 视频不能给每个 1 fps frame 保存完整图片 signature。
3. 视频必须保留 timestamp。
4. Audio fingerprint 是 supporting evidence，不是 Same video 的充分条件。
5. 短 clip、共享片头和重复片段必须显式表达歧义。
6. 合成验证已经足够暴露架构边界，下一步必须用用户真实域验收。

## 当前文档

- `docs/algorithm-validation.md`
- `docs/video-validation.md`
- `docs/architecture.md`
- `docs/video-architecture.md`
- `docs/index-storage.md`
- `docs/real-domain-acceptance.md`
- `docs/benchmark-plan.md`
- `experiments/`

## 接续入口

新对话先读 `HANDOFF.md`，再按其中顺序核对仓库真实状态。
