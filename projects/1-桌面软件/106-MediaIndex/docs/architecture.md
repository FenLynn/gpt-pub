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

## 图片检索漏斗

A1 至 A3 的验证已经否定单算法方案。当前更合理的是双召回加纹理自适应精确验证：

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
               ├──── candidate union，当前压力集倾向保留约 Top-50
               │
┌──────────────┴───────────────┐
│ Lane B                       │
│ scalable local-feature index │
│ LSH / visual-word index      │
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

优点：

- 压缩、缩放、格式改变等普通场景非常快。
- 多区域 hash 对中心型强裁剪有效。
- 50 万级连续内存微基准表明原始 hash 体积与扫描量处于可接受量级。

局限：

- 任意位置裁剪与复合攻击仍可能漏召回。
- 单纯增加 region 数量会增加内存、扫描量和偶然近邻机会。
- 20 图小库的 Top-5 满召回不能代表相关大库。

## Lane B

局部特征负责补上任意裁剪和复合攻击。

当前比较中的候选：

1. 紧凑 ORB + LSH voting。
2. ORB / SIFT visual words + inverted index。
3. 仅在传统方案仍不足时考虑 embedding。

150 图相关场景压力集表明，pHash + ORB LSH + SIFT BoVW 在 Top-50 候选预算内达到 250/250 召回，而 Top-20 仍有漏检。因此当前工程假设是“先保留约 Top-50，再精确验证”，不是把 Top-5 当固定目标。

禁止直接对 50 万图片逐一做 SIFT BF matching。

## 精确验证

R007 与 R011 已证明：

- 高 inlier count 不是充分条件。
- 高 inlier ratio 也不是充分条件。
- 同一真实场景不同视角可以同时产生数百 inliers 和接近 1 的 ratio。
- ORB / AKAZE 适合候选召回，但在 Crop70 与复合攻击上不适合作为唯一最终 verifier。
- compact CV_8U SIFT 有更好的精确验证能力，但全量持久化可能增加数 GB 至十余 GB raw descriptor 存储。

精确验证至少组合：

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

多尺度 grayscale + edge template correlation 在 30 个低纹理困难 Query 上达到 Top-1 29/30、Top-5 30/30，但朴素实现非常慢。因此它只适合作为：

```text
局部特征不足
→ 已有小候选集
→ template / edge fallback
```

不得全库运行。

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
- texture_class / feature_count summary

SIFT 精确特征是否全量持久化尚未冻结。当前需要比较：

1. 全量 compact CV_8U SIFT。
2. 候选后按需生成。
3. 后台懒生成 + 热点缓存。

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
