# P106｜Index and Storage Draft

> Phase 0 工程草案。所有容量与耗时来自微基准，不是正式产品 SLA。

## 1. 元数据事实库

当前建议使用 SQLite 保存：

- file id
- storage id
- relative / resolvable path
- file size
- mtime
- width / height / duration
- exact hash
- media status
- signature version
- offline / online storage mapping

R014 的 500k 微基准中，files + lightweight image signatures 的 SQLite 文件约 67.22 MiB。

因此 SQLite 适合承担：

- 事实源
- 增量扫描状态
- 路径定位
- exact-hash 查询
- storage 映射
- 索引版本控制

## 2. 高频视觉索引不全部塞进 SQLite 行

需要每次 Query 高频扫描的数据优先采用紧凑旁路结构：

```text
SQLite
  metadata / truth

pHash array
  fixed-width contiguous
  memory mapped or resident

visual-word inverted index
  offsets
  postings
  idf
  stop-word bitmap

optional verifier cache
  compact grayscale thumbnails
  hot descriptor cache
```

这样可以避免每个 Query 对数十万 SQLite rows 做对象化读取。

## 3. Lane A 容量

500k 图片，64-bit pHash：

| regions/image | raw payload |
|---:|---:|
| 28 | 106.81 MiB |
| 60 | 228.88 MiB |
| 201 | 766.75 MiB |

R015 表明 201 regions 作为默认全表扫描成本偏高。

当前 V1 方向：

- 优先研究 28 至 60 个精选 regions。
- region layout 需要结合真实召回再冻结。
- 更密集 region set 可以只对候选进行二次细化。

## 4. Lane B 容量

R013 的 synthetic visual-word index：

- 500k images
- 约 47.9 unique visual words/image
- 23.95M postings
- uint32 postings 约 91.37 MiB
- offsets + IDF 不到 1 MiB

这说明一个紧凑单路倒排表可以控制在百 MiB 量级。

重点设计：

- visual-word vocabulary version
- stop-word threshold
- IDF
- postings compression
- incremental append / rebuild
- codebook upgrade migration

## 5. 精确验证缓存

### 方案 A，全量 compact SIFT

如果全量保存 CV_8U SIFT descriptors：

| descriptors/image | raw descriptor payload at 500k |
|---:|---:|
| 64 | 约 4.1 GB |
| 128 | 约 8.2 GB |
| 256 | 约 16.4 GB |

还不含 keypoint 坐标和索引。

### 方案 B，验证缩略图

R016 的 grayscale JPEG60 样例：

| max dimension | 500k cache estimate | SIFT extraction median |
|---:|---:|---:|
| 192 | 1.91 GiB | 6.35 ms |
| 256 | 3.07 GiB | 11.31 ms |
| 320 | 4.26 GiB | 16.79 ms |
| 384 | 5.74 GiB | 26.25 ms |

320px JPEG60 在 200 个困难 true pairs 中探索性高置信确认 131/200，并对 194 hard negatives 保持 0 FP。

320px WebP70 的存储估计约 3.63 GiB，true confirmed 128/200。

### 当前倾向

优先继续验证：

```text
all files:
  selected pHash
  visual-word postings
  optional 256 to 320px grayscale verifier thumbnail

deep verification:
  decode thumbnail
  build SIFT only for current candidates
  cache hot descriptors
```

原因：

1. 缩略图既可重建 SIFT，也可用于 NCC、template 和 edge fallback。
2. 离线移动硬盘不在线时仍有视觉证据。
3. 相比全量 128 至 256 SIFT descriptors，存储更容易控制。
4. 普通 exact / pHash 命中不进入深度验证，因此 0.5 至 0.8 s 的最坏 Top-50 verifier CPU 不代表常规 Query 延迟。

尚未冻结：

- 256 还是 320px。
- JPEG 还是 WebP。
- 是否默认启用缩略图缓存。
- 隐私模式下是否允许完全禁用视觉缓存。

## 6. 隐私边界

缩略图缓存与 hash 不同，它能泄露可辨认媒体内容。

正式产品必须：

- 明确说明 verifier thumbnail 属于本地视觉缓存。
- 默认不上传。
- 不进入公开日志。
- 支持清空。
- 支持禁用视觉缓存的隐私模式。
- 加密方案是否必要由正式威胁模型决定。

## 7. 离线盘

库存卷必须使用稳定 storage identity，不只记录 Windows 盘符。

概念结构：

```text
storage
  id
  fingerprint
  display_name
  current_mount
  last_seen
  online

file
  storage_id
  relative_path
```

这样移动硬盘离线时仍能回答：

> 该素材库存中存在，位于某个离线存储卷的某个相对路径。

## 8. 启动加载草案

预计：

```text
open SQLite
→ validate schema / index version
→ mmap pHash arrays
→ mmap visual-word offsets / postings
→ open optional thumbnail / descriptor caches
→ ready
```

不应在每次启动重新读取原媒体或重建视觉索引。

## 9. 待验证

- Windows NTFS 下 mmap 启动与随机访问。
- 断电安全下 SQLite WAL 配置。
- 50 万至 100 万的增量 update。
- storage identity 在移动硬盘盘符变化时的稳定性。
- postings 增量构建与 compact rebuild。
- thumbnail cache 的分块文件格式与随机读取。


## 10. 视频索引不能复制图片签名结构

V014 证明，视频规模必须按总时长而不是文件数估算。

如果使用约 1 fps baseline：

- 1,000 h 约 3.6M frames。
- 10,000 h 约 36M frames。
- 50,000 h 约 180M frames。

若每个 baseline frame 只保存：

```text
video_id
timestamp
global pHash
约 16 bytes
```

10,000 h 约 0.54 GiB，仍然很轻。

但如果每帧复制图片级结构：

- 28-region hash：10,000 h 约 7.78 GiB。
- 24 local postings × 8 bytes：约 6.44 GiB。
- 6 KB verifier thumbnail/frame：约 201 GiB。

因此禁止把图片的完整 visual signature 原样附着到每个 sampled video frame。

## 11. 视频建议采用三层视觉索引

当前候选结构：

```text
Tier V0
约 1 fps baseline
global pHash
video_id
timestamp

Tier V1
scene / motion / periodic sparse keyframes
selected local visual words
timestamp-preserving postings

Tier V2
very sparse verifier thumbnails
or online source decode on demand
```

### Tier V0

职责：

- 完整转码。
- 普通 clip。
- 初步 source video / offset。
- 为 Lane B 与 Audio Lane 提供候选。

目标是轻量、连续、覆盖所有时间位置。

### Tier V1

职责：

- crop。
- watermark。
- 竖屏。
- 画中画。
- pHash Lane A 失败时的 local-feature candidate rescue。

不能丢弃 timestamp。

### Tier V2

不再默认按 1 fps 保存 thumbnail。

优先方案：

- scene-adaptive sparse thumbnails。
- 每分钟数量上限。
- 只对离线卷或用户指定媒体保留。
- 在线源文件存在时按需解码。
- 对热点候选建立临时 descriptor cache。

## 12. Audio Lane C 容量

V010 的 raw Chromaprint 量级约 28.7 bytes/s。

粗略：

| 总视频时长 | raw audio fingerprint |
|---:|---:|
| 1,000 h | 0.096 GiB |
| 5,000 h | 0.481 GiB |
| 10,000 h | 0.961 GiB |
| 50,000 h | 4.806 GiB |

因此 Audio Lane C 的容量明显小于“每秒 thumbnail”方案，适合作为长视频时间定位和视觉困难场景的 supporting index。

## 13. 统一索引格式的当前边界

图片：

```text
one file
→ one image signature set
```

视频：

```text
one file
→ many Tier V0 temporal anchors
→ sparse Tier V1 local keyframes
→ optional Tier V2 verifier cache
→ optional Audio Lane C
```

共享的是 hash、local descriptor、verifier 算法实现。

不能强迫图片和视频在持久化层使用完全相同的记录密度。
