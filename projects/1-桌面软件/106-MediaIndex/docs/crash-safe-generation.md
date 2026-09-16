# Crash-safe generation

## Goal

MediaIndex 的持久索引更新必须保证，新索引没有完整落盘之前，查询侧始终继续读取上一代完整索引。

当前实现不再使用独立的 `CURRENT.json`。活动 generation 的唯一指针保存在 `index.sqlite3` 的 `meta.active_generation` 中。该指针与图片 metadata 更新处于同一个 SQLite transaction，因此 generation 切换和 metadata 变更一起提交或一起回滚。

## Layout

```text
<index-dir>/
  index.sqlite3
  generations/
    g-.../
      generation.json
      region_hashes.npy
      image_ids.npy
      local_postings.npy
      local_offsets.npy
      local_idf.npy
      local_stop.npy
      local_delta_postings.npy
      local_delta_offsets.npy
      local_override_ids.npy
```

旧版根目录数组仍可作为迁移输入，但一旦进入 managed generation，读取侧只通过 `active_generation` 解析 Lane A 和 Lane B。

## Write protocol

```text
scan and update SQLite transaction
        ↓
create private generation
        ↓
write Lane A and Lane B payloads
        ↓
fsync generation payload files
        ↓
write and fsync generation.json
        ↓
validate required files and recorded sizes
        ↓
set meta.active_generation
        ↓
SQLite commit
        ↓
cleanup old or incomplete generations
```

关键点：

1. 当前活动 generation 不原位修改。
2. 新 generation 必须先形成完整 `generation.json`。
3. manifest 记录所有有效文件和文件大小。
4. `generation_complete()` 同时检查文件存在性和大小。
5. payload 和 manifest 在活动指针提交之前完成 fsync。
6. `active_generation` 与图片 metadata 共用 SQLite transaction。
7. commit 之前崩溃时，SQLite 回滚到旧 metadata 和旧 generation。
8. commit 之后，查询侧只能看到已经验证完整的新 generation。
9. incomplete orphan 可安全回收。
10. complete orphan 不会自动成为活动索引。

## Read protocol

```text
open index.sqlite3
        ↓
read meta.active_generation
        ↓
resolve generations/<id>
        ↓
validate generation.json
        ↓
Lane A and Lane B both read from that directory
```

查询侧不再从索引根目录直接读取：

```text
region_hashes.npy
image_ids.npy
local_postings.npy
...
```

因此不会发生 Lane A 已切新版本而 Lane B 仍读旧版本，或反过来的混合 generation。

## Recovery regression

生产路径回归：

```text
experiments/index_generation.py
experiments/ci_crash_safe_generation.py
experiments/ci_mediaindex_core.py
```

`ci_mediaindex_core.py` 会直接调用 crash-safe regression，所以现有 P106 Windows CI 无需修改 workflow 就会覆盖该阶段。

当前覆盖：

| Failure boundary | Expected result |
| --- | --- |
| generation 缺必需文件 | manifest 创建失败 |
| 新 generation 完整但 SQLite activation rollback | 旧 generation 继续 active |
| activation commit | 新 generation 成为唯一读取目标 |
| incomplete orphan | recovery cleanup 可删除 |
| previous complete generation | recovery 不删除 |
| active generation | recovery 不删除 |
| no-change rebuild | 不创建新 generation |
| delta rebuild | 创建新 generation 并原子切换 |
| query | Lane A 与 Lane B 使用同一 active generation |

## Scope

该 generation 生命周期当前用于图片 Lane A 和 Lane B。后续 persistent video Tier V0/V1 接入时，应复用同一 generation 语义，不再建立第二套活动指针机制。
