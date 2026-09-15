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

## 5. SIFT 精确特征

如果全量保存 CV_8U SIFT descriptors：

| descriptors/image | raw descriptor payload at 500k |
|---:|---:|
| 64 | 约 4.1 GB |
| 128 | 约 8.2 GB |
| 256 | 约 16.4 GB |

还不含 keypoint 坐标和索引。

因此当前必须比较三种策略：

1. 全量 compact SIFT。
2. Query 候选出现后按需从原图计算。
3. 后台懒生成，并建立 LRU / persistent hot cache。

当前倾向 2 或 3，但尚未冻结。

## 6. 离线盘

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

## 7. 启动加载草案

预计：

```text
open SQLite
→ validate schema / index version
→ mmap pHash arrays
→ mmap visual-word offsets / postings
→ open lightweight caches
→ ready
```

不应在每次启动重新读取原媒体或重建视觉索引。

## 8. 待验证

- Windows NTFS 下 mmap 启动与随机访问。
- 断电安全下 SQLite WAL 配置。
- 50 万至 100 万的增量 update。
- storage identity 在移动硬盘盘符变化时的稳定性。
- postings 增量构建与 compact rebuild。
