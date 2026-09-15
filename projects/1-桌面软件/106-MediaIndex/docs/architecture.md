# P106｜Architecture Draft

> Phase 0 草案，不是最终实现承诺。算法数据见 `algorithm-validation.md`，存储量级见 `index-storage.md`。

## 目标数据流

```text
Media roots
   ↓
Incremental scanner
   ↓
SQLite metadata / exact hash truth
   ↓
visual signature build
   ↓
persistent compact indexes
   ↓
Query media
   ↓
fast candidate retrieval
   ↓
precise verification
   ↓
ranked source locations
```

## 图片检索漏斗

R001 至 R015 已经否定单算法方案。当前更合理的是双召回加纹理自适应精确验证：

```text
Query
  ↓
Exact content hash
  ↓
┌──────────────────────────────┐
│ Lane A                       │
│ selected multi-region pHash │
│ current study: 28 to 60     │
└──────────────┬───────────────┘
               │
               ├──── candidate union
               │     current conservative budget: about Top-50
┌──────────────┴───────────────┐
│ Lane B                       │
│ compact visual-word index    │
│ stop-word + IDF + postings   │
└──────────────┬───────────────┘
               ↓
cheap local rerank
               ↓
      ┌────────┴────────┐
      │                 │
 high texture       low texture
      │                 │
SIFT + RANSAC     multi-scale template
+ content check    / edge fallback
      │                 │
      └────────┬────────┘
               ↓
Confirmed / Probable / Similar / Not found
```

## Lane A

职责：

- 极快覆盖 JPEG 重压缩、Resize、格式变化、轻水印。
- 通过有限多区域 hash 增强中心型和常规裁剪召回。
- 提供与 Lane B 互补的候选。

R015 表明：

- 500k × 28 regions raw hash 约 106.81 MiB，warm full scan median 约 47 ms。
- 500k × 60 regions raw hash 约 228.88 MiB，median 约 67 ms。
- 500k × 201 regions raw hash 约 766.75 MiB，median 约 201 ms。

因此 201 regions 不再作为 V1 默认全库第一层。当前优先研究 28 至 60 个精选区域的召回效率。

## Lane B

职责：

- 补回任意位置裁剪。
- 补回复合攻击。
- 为最终 SIFT verifier 提供紧凑候选。

当前方向从多表 ORB LSH 进一步收敛到：

```text
local descriptors
→ visual-word quantization
→ one compact inverted index
→ stop-word filtering
→ IDF weighted sparse voting
```

R013 synthetic 500k 微基准中：

- 约 47.9 unique words/image。
- 23.95M postings。
- uint32 postings 约 91.37 MiB。
- sparse Query 只触碰数千 postings 时，候选累计低于毫秒量级。

这些数字只证明索引结构的工程量级，不证明真实 visual-word 召回率。

150 图相关压力集仍表明，当前应保守保留约 Top-50 candidates，再进入 verifier。

## 精确验证

已证明以下规则都不充分：

- 高 RANSAC inlier count。
- 高 inlier ratio。
- ORB / AKAZE 单独几何验证。
- 视觉语义相似。

同一真实场景不同视角可以同时产生数百 inliers 和接近 1 的 ratio。

因此高纹理候选至少组合：

- inlier count
- inlier ratio
- inliers / query keypoints
- query / library spatial coverage
- Homography 合理性
- warp 后全局 NCC
- 局部 block NCC / 一致像素区域

最终阈值必须由跨数据集 benchmark 冻结。

## 低纹理路径

clock、horse、cell 等少关键点样本证明，SIFT 不能覆盖所有图片。

当前 fallback：

```text
feature count / texture score low
→ candidate set already small
→ multi-scale grayscale template
→ edge consistency
```

30 个低纹理困难 Query 中，探索性实现 Top-1 29/30，Top-5 30/30，但朴素实现很慢，所以只允许候选后运行。

## 持久化结构

### SQLite

保存事实与状态：

- files
- storages
- exact hash
- media metadata
- signature version
- incremental scan state
- offline volume mapping

R014 的 500k synthetic metadata 微基准约 67.22 MiB，说明 SQLite 不构成主要规模风险。

### 旁路视觉索引

优先采用固定宽度、可 mmap 的二进制结构：

- pHash arrays
- visual-word offsets
- postings
- IDF
- stop-word bitmap

不要求每次 Query 从 SQLite 逐行读取视觉指纹。

## SIFT 存储策略

全量 compact CV_8U SIFT 仍未冻结。

500k raw descriptor payload：

- 64 descriptors/image：约 4.1 GB
- 128 descriptors/image：约 8.2 GB
- 256 descriptors/image：约 16.4 GB

当前继续比较：

1. 全量 compact storage。
2. candidate 后按需生成。
3. background lazy generation + hot cache。

## 存储设备

索引支持离线卷：

```text
storage_id
storage_fingerprint
display_name
current_mount
last_seen
online/offline
relative_path
```

即使磁盘不在线，也能回答素材曾存在于哪个存储设备和相对路径。

## 视频预留

视频后续增加：

- duration / codec metadata
- sampled frame signatures
- scene keyframes
- temporal sequence fingerprint
- optional audio fingerprint

图片 Phase 0 不因视频预留而提前复杂化。
