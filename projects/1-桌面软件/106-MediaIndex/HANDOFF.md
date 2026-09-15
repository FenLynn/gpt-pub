# P106｜MediaIndex HANDOFF

> 本文件是跨对话恢复入口。不得只凭聊天记忆继续。

## 1. 项目身份

- 项目：MediaIndex
- 预留编号：`P106`
- 预留路径：`projects/1-桌面软件/106-MediaIndex/`
- 日常开发：`p106-exp`
- 稳定候选：`p106-stable`
- 正式主线：`main`
- 固定流转：`main → p106-exp → p106-stable → main`

当前用户明确要求：暂不修改任何公共文件，只建立和维护 P106 自有目录与长期分支。因此 `/目录.md` 尚未登记 P106。后续通过独立统一仓库任务补齐。

## 2. 新对话强制读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. 本目录 `开发约束.md`
5. `README.md`
6. `阶段记录.md`
7. `工作记录.md`
8. `docs/algorithm-validation.md`
9. `docs/video-validation.md`
10. `docs/architecture.md`
11. `docs/video-architecture.md`
12. `docs/index-storage.md`
13. `docs/benchmark-plan.md`
14. `设计与演进.md`
15. 实时比较 `main / p106-stable / p106-exp`

## 3. 当前断点

当前处于：

**Phase 0：共享视觉索引冻结前验证 + 视频时间层验证。**

图片已完成至 R016：

- Krokiet / SIFT 受控基线。
- 20 图、340 Query 正样本矩阵。
- 222 hard-negative。
- 150 图相关场景压力集。
- 500k pHash、visual-word、SQLite 微基准。
- compact verifier 与低纹理 fallback。
- verifier thumbnail cache。

视频已完成至 V004：

- 完整 H.264 / H.265 / fps 变化。
- 水印、crop 与组合视觉变化。
- 中间 clip 与 source offset。
- 1.05× speed。
- 前插片头。
- 删除中间片段的 piecewise 时间反例。
- 6 视频相关库的 full / 8 s / 5 s / 3 s clip 检索。
- unrelated negative。

可复现脚本：

```text
experiments/r013_visual_word_index_microbench.py
experiments/r014_sqlite_metadata_microbench.py
experiments/r015_phash_scan_microbench.py
experiments/r016_thumbnail_verifier_microbench.py
experiments/v001_video_sequence_benchmark.py
```

## 4. 当前统一架构候选

```text
SQLite metadata / exact hash
→ shared visual engine
   ├─ Lane A: selected pHash regions
   └─ Lane B: compact visual-word inverted index
→ candidate media

image
→ verifier thumbnail
→ SIFT / NCC or low-texture fallback

video
→ sampled-frame correspondences
→ offset / affine / piecewise monotonic temporal model
→ selected-frame image verifier
```

### 已否决的简化

- 单纯调宽全局 pHash 阈值。
- 默认 201-region 全表第一层。
- 全库逐图 SIFT。
- 只看 RANSAC inliers 或 ratio。
- ORB / AKAZE 单独取代 final image verifier。
- 把视觉语义相似直接作为同源结论。
- 把 20 图小库 Top-5 当成大库结论。
- 默认要求 500k 全量保存大量 SIFT descriptors。
- 视频只使用文件 hash、首帧或一个全局视频 hash。
- 视频时间层只允许固定 offset 或单一 affine speed。
- 3 s clip Top-1 即自动 Confirmed。

## 5. 当前唯一下一步

在 `p106-exp` 并行推进：

### Image freeze

1. 更大公开真实图片交叉验证。
2. 冻结 visual-word quantization / inverted index。
3. 冻结 Lane A region layout。
4. 冻结 verifier thumbnail / privacy mode。
5. 进入 A4 用户真实图片域验收。

### Video V005-V007

1. 采样率与 scene-adaptive sampling。
2. piecewise monotonic temporal alignment。
3. frame-level visual-word inverted retrieval。
4. 随后测试字幕、竖屏裁剪、多段拼接与音频 fingerprint。

不需要用户继续手工调参数。

## 6. 写入边界

当前只允许修改：

```text
projects/1-桌面软件/106-MediaIndex/
```

当前不得修改：

- `/目录.md`
- `/GPT_RULES.md`
- 分类 `开发约束.md`
- 其他 P101 至 P105 项目
- 公共 workflow
- 其他共享入口

## 7. 恢复模板

```text
P106 MediaIndex
main: <实时 SHA>
p106-stable: <实时 SHA / ahead-behind>
p106-exp: <实时 SHA / ahead-behind>
catalog registration: pending / completed
image benchmark: <最新 R 编号>
video benchmark: <最新 V 编号>
phase: <当前阶段>
next action: <唯一明确断点>
```
