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

```text
1. Exact content hash
2. Global perceptual hash
3. Multi-region perceptual hash
4. Top-k candidate set
5. Local feature matching
6. RANSAC geometry
7. Optional content consistency
8. Final classification
```

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
- local_feature_summary / storage pointer

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
