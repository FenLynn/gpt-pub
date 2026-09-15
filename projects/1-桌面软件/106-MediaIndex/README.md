# P106｜MediaIndex

MediaIndex 是面向大规模照片与视频库存的只读内容检索工具。核心目标不是传统“重复文件清理”，而是回答：

> 给定一张图片、一个视频或一批媒体，库存中是否已经存在同源素材；如果存在，准确返回位置、来源区间和置信度。

## 当前阶段

**Phase 0：真实域验收工具已准备，等待 A4 + V011 用户真实数据。**

图片算法验证已完成至 R016。

视频算法、时间层和规模验证已完成至 V014。

合成 / 程序样例不再继续无边界扩张。下一步必须转到用户真实库存分布。

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

## 当前真实域验收工具

为减少用户操作，当前已经从 BAT + CSV 流程进一步收敛为 Windows GUI：

```text
start_acceptance.bat
  ↓
若未构建则自动 build
  ↓
MediaIndex Acceptance.exe
```

GUI 内完成：

- 选择图片库存。
- 选择视频库存。
- 添加或拖入 Query。
- 双击 Query 设置真实源。
- hard negative 点“设为无对应”。
- 点击“开始真实域验收”。
- 点击“导出匿名结果”。

用户不再需要手写 CSV，也不需要在正式 portable 运行时管理 Python 环境。

详细说明：

- `docs/acceptance-app.md`
- `docs/real-domain-acceptance.md`

旧 BAT / CSV 工具仍保留为底层 fallback。

## 当前重要工程结论

1. 图片与视频共享视觉算法，不共享相同索引记录密度。
2. 视频不能给每个 1 fps frame 保存完整图片 signature。
3. 视频必须保留 timestamp。
4. Audio fingerprint 是 supporting evidence，不是 Same video 的充分条件。
5. 短 clip、共享片头和重复片段必须显式表达歧义。
6. 强竖屏裁剪可以通过 local SIFT geometry rescue。
7. synthetic validation 已基本完成使命，生产阈值必须由真实域决定。

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


## Windows Acceptance 单 EXE

当前 P106 已有 Windows x64 单 EXE 候选。

构建由：

```text
.github/workflows/p106-mediaindex-acceptance.yml
```

完成。

外部交付：

```text
MediaIndex-Acceptance-v0.0.1-win-x64.exe
```

内部算法 Worker 嵌入主 EXE，并按需释放到用户 LocalAppData。最终用户不需要单独安装或管理 Python、.NET Runtime 或第二个 Worker EXE。
