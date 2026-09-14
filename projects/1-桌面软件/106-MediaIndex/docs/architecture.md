# P106｜Architecture Draft

> Phase 0 草案，不是最终实现承诺。

## 目标数据流

```text
Media roots
   ↓
Incremental scanner
   ↓
Metadata + exact hash + visual signatures
   ↓
Persistent index
   ↓
Query media
   ↓
Fast candidate retrieval
   ↓
Precise verification
   ↓
Ranked source locations
```

## 图片候选链

A1 至 A3 的现有验证表明，单一路径不足以同时兼顾普通重编码、强裁剪、任意位置裁剪和低误报。

当前草案调整为双召回：

```text
Query
  ↓
Exact content hash
  ↓
┌──────────────────────────────┐
│ Lane A                       │
│ global / multi-region pHash │
└──────────────┬───────────────┘
               │
               ├──── candidate union
               │
┌──────────────┴───────────────┐
│ Lane B                       │
│ scalable local-feature index │
│ ORB-LSH / BoVW under study   │
└──────────────┬───────────────┘
               ↓
Top-k candidates
  ↓
SIFT + Lowe ratio
  ↓
RANSAC geometry
  ↓
content-consistency checks
  ↓
Confirmed / Probable / Similar / Not found
```

### Lane A

优点：

- 压缩、缩放、格式改变等普通场景非常快。
- 多区域 hash 对中心型强裁剪有效。
- 索引紧凑，几十万规模连续内存扫描已显示可行量级。

局限：

- 任意位置裁剪与复合攻击仍可能漏召回。
- 单纯增加 region 数量会增加内存、扫描量和偶然近邻机会。

### Lane B

现阶段验证表明局部特征可以显著补上任意裁剪。

候选实现仍在比较：

1. 紧凑 ORB + LSH voting。
2. ORB / SIFT Bag of Visual Words + inverted index。
3. 仅在前两者不足时考虑 embedding。

禁止直接对 50 万图片逐一做 SIFT BF matching。

## 精确验证

R007 已证明：

- 高 inlier count 不是充分条件。
- 高 inlier ratio 也不是充分条件。
- 同一真实场景不同视角可以同时产生数百 inliers 和接近 1 的 ratio。

因此精确验证至少组合：

- inlier count
- inlier ratio
- inliers / query keypoints
- query / library spatial coverage
- Homography 合理性
- warp 后全局 NCC
- 局部 block NCC / 一致像素区域
- 必要时额外模板或边缘一致性

最终阈值必须由跨数据集 benchmark 冻结。

## 数据库草案

### files

- id
- storage_id
- relative_or_resolvable_path
- media_type
- size
- mtime
- width
- height
- duration
- exact_hash
- status

### image_signatures

- file_id
- global_hash
- region_hash_set_version
- region_hashes
- local_feature_version
- compact_local_signature / postings reference
- precise_feature_cache_policy

SIFT 精确特征是否全量持久化尚未冻结。可以按热点、候选或增量后台策略生成，避免无必要地放大 50 万规模索引。

### query_results

默认不持久保存私人查询内容。若未来需要历史记录，应单独设计隐私边界。

## 存储设备

索引应支持离线卷：

```text
storage_id
display_name
last_seen
online/offline
root mapping
```

即使磁盘当前离线，也能回答“库存曾经存在于哪个存储设备和相对路径”。

## 视频预留

视频后续增加：

- duration / codec metadata
- sampled frame signatures
- scene keyframes
- temporal sequence fingerprint
- optional audio fingerprint

图片 Phase 0 不因视频预留而提前复杂化。
