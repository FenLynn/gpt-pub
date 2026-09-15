# P106｜Algorithm Validation

> 本文件只记录已经有明确实验输出的结果。未经实际执行的推测不得写成已验证事实。

## R001｜Krokiet 全局感知哈希基线

### 数据

受控合成集：

- Library：20 张原图
- 每类 Query：20 张
- Negative control：20 张 unrelated

### 默认配置结果

| 变换 | 命中 |
|---|---:|
| JPEG 强重压缩 | 20/20 |
| Resize 50% | 20/20 |
| JPG → PNG | 20/20 |
| Crop10 | 0/20 |
| Crop30 | 0/20 |
| 小水印 | 19/20 |
| Unrelated | 0/20 |

结论：默认全局 hash 对重编码、缩放、格式转换稳定，对裁剪明显脆弱。

## R002｜Crop10 参数探索

固定：

- Hash size = 16
- Resize = Lanczos3
- Geometric invariance = Off

结果：

| Hash | Max difference | Crop10 | Unrelated false positive |
|---|---:|---:|---:|
| Mean | 10 | 0/20 | 0/20 |
| Mean | 15 | 0/20 | 0/20 |
| Mean | 20 | 2/20 | 0/20 |
| Gradient | 20 | 0/20 | 0/20 |
| DoubleGradient | 20 | 12/20 | 0/20 |
| DoubleGradient | 25 | 18/20 | 未观察到 |
| DoubleGradient | 30 | 20/20 | 未观察到 |

结论：Hash 类型比单纯放宽 Mean 阈值更重要。DoubleGradient 对轻裁剪明显更强。

## R003｜Crop30 全局 hash 边界

配置：

- DoubleGradient
- Hash size 16
- Lanczos3
- Max difference 30
- Library 为 Reference

结果：

| 项目 | 结果 |
|---|---:|
| Crop30 | 0/20 |
| Unrelated | 0/20 |

结论：轻裁剪可通过 DoubleGradient 恢复，但强裁剪仍然使全局 hash 失效。继续无限放宽阈值不是优先路线。

## R004｜SIFT + Lowe ratio + RANSAC Homography

### 数据

- Library：20
- Crop30 Query：20
- Unrelated Query：20

### 输出

Crop30 全部找到正确原图：

- Top-1 correct original：20/20
- 初始 verdict：20/20

Unrelated：

- 初始 verdict 误判：19/20

Crop30 典型指标范围：

- inliers：359 至 1309
- inlier ratio：约 0.85 至 0.98
- query coverage：约 0.60 至 0.93

Unrelated 最高候选的典型范围：

- inliers：14 至 57
- inlier ratio：约 0.28 至 0.59
- query coverage：约 0.21 至 0.73

### 重要结论

1. 局部特征路线可以恢复强裁剪候选。
2. 该测试脚本的初始 verdict 阈值明确无效，因为对 unrelated 产生 19/20 假阳性。
3. 不得把“存在 RANSAC homography”直接等同“同源”。
4. 后续必须引入更严格的特征占比、双向覆盖、几何合理性或内容一致性验证。
5. 现有结果来自受控合成数据，不允许直接冻结生产阈值。

## R005｜20 张自然 / 实际样例图的正样本矩阵

### 数据

使用运行环境中已安装软件包自带的 20 张自然或实际样例图，不提交这些原图到仓库。

每张生成 17 类 Query，共 340 个正样本：

- JPEG quality 20
- Resize 25%
- Crop10 / 30 / 50 / 70
- 非对称 Crop50
- 小水印
- 大面积覆盖
- 亮度
- 对比度
- 去饱和
- 模糊
- 5° 旋转
- 透视变化
- 水平镜像
- Crop50 + Resize + 水印 + JPEG 的组合攻击

### 201-region 64-bit pHash pyramid

此方案只用于候选召回实验。每张库存图生成 201 个不同尺度与位置的 64-bit pHash，镜像测试额外尝试镜像 Query。

关键结果：

| 变换 | Top-1 | Top-5 | Top-10 |
|---|---:|---:|---:|
| Crop10 | 20/20 | 20/20 | 20/20 |
| Crop30 | 20/20 | 20/20 | 20/20 |
| Crop50 | 20/20 | 20/20 | 20/20 |
| Crop70 | 20/20 | 20/20 | 20/20 |
| 非对称 Crop50 | 9/20 | 15/20 | 18/20 |
| 组合攻击 | 4/20 | 15/20 | 18/20 |
| 透视变化 | 15/20 | 20/20 | 20/20 |
| 5° 旋转 | 17/20 | 19/20 | 20/20 |
| 水印 | 19/20 | 20/20 | 20/20 |
| 镜像 | 20/20 | 20/20 | 20/20 |

普通压缩、缩放、亮度、对比度、去饱和、模糊等均为 20/20 Top-1。

结论：多区域 pHash 对中心型强裁剪非常有效，但对任意位置裁剪和复合攻击仍存在明显召回缺口。

## R006｜ORB 局部特征作为候选召回补充

### 小库直接匹配

对同一 20 图 / 340 Query 测试，使用 ORB 约 1200 keypoints/image，BF Hamming + ratio 进行直接小库排名。

关键结果：

| 变换 | Top-1 | Top-5 | Top-10 |
|---|---:|---:|---:|
| 非对称 Crop50 | 20/20 | 20/20 | 20/20 |
| Crop50 | 20/20 | 20/20 | 20/20 |
| Crop70 | 17/20 | 19/20 | 19/20 |
| 组合攻击 | 17/20 | 18/20 | 19/20 |
| 大面积覆盖 | 19/20 | 19/20 | 19/20 |

多区域 pHash Top-5 与完整 ORB Top-5 取并集后：

- 340/340 正确原图进入候选集合。

### 紧凑 ORB

只保留响应最高的局部描述子：

- 64 descriptors/image：与 pHash 联合 Top-5 为 336/340，联合 Top-10 为 340/340。
- 128 descriptors/image：联合 Top-5 为 339/340，联合 Top-10 为 340/340。
- 256 descriptors/image：联合 Top-5 为 339/340，联合 Top-10 为 340/340。

结论：

1. 全局 / 多区域 hash 与局部二进制特征存在明显互补。
2. 128 个 ORB descriptors/image 已显示出较好的紧凑性潜力。
3. 本结果来自 20 张小库，直接 BF 全库匹配不能作为 50 万规模实现。

## R007｜SIFT 精确验证与 Hard Negative

### 正样本

20 张图片 × 10 类困难变换，共 200 个 true pairs：

- JPEG20
- Crop30 / Crop50 / Crop70
- 非对称 Crop50
- 水印
- 5° 旋转
- 透视
- 组合攻击
- 镜像 fallback

其中 178/200 具有至少 20 个 SIFT RANSAC inliers。低纹理样本是主要失败来源。

### 负样本

共 222 个 hard-negative pairs：

- 190 个不同库存图片配对。
- 8 个同一真实场景左右相机视角及其裁剪变体。
- 24 个草地、碎石、砖墙、星空等重复纹理的非重叠区域配对。

同场景不同视角是最危险负样本：

- inliers 最高：362
- inlier ratio 最高：0.978
- inliers / query keypoints 最高：0.328
- 单一 Homography 对齐后的灰度 NCC 最高：0.880

这证明 **inliers 很高、ratio 很高，仍然不能直接证明同源**。

### 探索性高置信规则

仅用于本轮消融，不是生产阈值：

```text
base:
  inliers >= 20
  ratio >= 0.80
  query coverage >= 0.10

evidence:
  NCC >= 0.90
  OR (inliers/query keypoints >= 0.40 AND NCC >= 0.60)
  OR (high-NCC block fraction >= 0.20 AND block NCC p90 >= 0.95)
```

在本数据上：

- true confirmed：173/200
- hard-negative false positive：0/222

结论：

1. 高置信 Confirmed 可以偏保守。
2. 未通过高置信门的候选不能简单判 Not found，应进入 Probable / further verification。
3. 低纹理图片必须由 hash、模板或其他 fallback 补位。
4. 以上阈值尚未跨数据集验证，禁止固化为生产默认值。

## R008｜可扩展候选索引探索

### ORB LSH

以 128 个 ORB descriptors/image，8 个 LSH 表，每表抽取 20 bits 做 exact-bucket voting 的小库实验：

- LSH 单独：Top-5 313/340，Top-10 326/340。
- 与 201-region pHash 合并：Top-5 339/340，Top-10 340/340。

结论：LSH 有潜力，但 postings 数量在 50 万级可能偏大，需要继续压缩。

### ORB / SIFT Bag of Visual Words

在同一 20 图数据上做探索性 BoVW：

- ORB BoVW 512 words：Top-5 313/340，Top-10 326/340。
- SIFT BoVW 512 words：Top-5 315/340，Top-10 329/340。
- SIFT BoVW 与 201-region pHash 的 Top-5 并集：340/340。

重要限制：BoVW codebook 是在这 20 张图的描述子上训练，结果明显乐观，只证明路线值得继续，不证明真实大库召回率。

## R009｜10 万至 50 万规模内存扫描微基准

仅测试随机 64-bit hash 的连续内存矩阵，执行 XOR + popcount + 每图 region min + Top-20。它不包含磁盘、数据库、真实 hash 分布和精确验证，因此只表示 CPU / 内存吞吐下界。

### 28 regions / image

| 库存量 | raw hash RAM | warm query |
|---:|---:|---:|
| 100k | 21.4 MB | 13.7 ms |
| 300k | 64.1 MB | 36.6 ms |
| 500k | 106.8 MB | 54.9 ms |

### 60 regions / image

| 库存量 | raw hash RAM | warm query |
|---:|---:|---:|
| 100k | 45.8 MB | 15.6 ms |
| 300k | 137.3 MB | 52.7 ms |
| 500k | 228.9 MB | 138.5 ms |

同一运行环境、20 张样例图重复测得局部特征提取：

- ORB 约 1200 keypoints：median 4.22 ms，P95 8.55 ms。
- SIFT 约 1800 keypoints：median 37.53 ms，P95 66.41 ms。

这些时间不得外推为 Windows 正式产品性能，只用于判断量级。

## 当前结论

当前最有希望的图片链已经从“单一 pHash”演化为双召回 + 精确验证：

```text
Exact hash
  ↓
Lane A: global / multi-region pHash
  +
Lane B: scalable local-feature candidate index
  ↓
candidate union
  ↓
SIFT + RANSAC
  ↓
content consistency
  ↓
Confirmed / Probable / Similar / Not found
```

其中 Lane B 的 **可扩展实现仍未冻结**。当前优先继续比较紧凑 ORB LSH、BoVW / inverted index，以及必要时才考虑 embedding。

## 后续验证

R010 至 R012 已在下文完成。R013 至 R015 继续验证大规模索引与存储工程边界。


## R010｜150 图相关场景压力集

为避免 20 张小库过于乐观，额外从 3 套世界地图 / 地形渲染图按相同地理网格切出 150 张库存图，每套 50 张。同一地理位置在不同渲染图中内容高度相关，但不是同一源文件，可充当相关 hard negatives。

从其中一套 50 张源图生成 5 类 Query，共 250 个：

- JPEG20
- Crop50
- Crop70
- 非对称 Crop50
- Crop50 + Resize + 水印 + JPEG 的组合攻击

### 201-region pHash

| 变换 | Top-1 | Top-5 | Top-20 |
|---|---:|---:|---:|
| JPEG20 | 50/50 | 50/50 | 50/50 |
| Crop50 | 50/50 | 50/50 | 50/50 |
| Crop70 | 50/50 | 50/50 | 50/50 |
| 非对称 Crop50 | 11/50 | 30/50 | 38/50 |
| 组合攻击 | 8/50 | 16/50 | 30/50 |

### ORB LSH

128 ORB descriptors/image，8 个表，每表 20 bits：

| 变换 | Top-5 | Top-20 |
|---|---:|---:|
| JPEG20 | 50/50 | 50/50 |
| Crop50 | 37/50 | 39/50 |
| Crop70 | 22/50 | 28/50 |
| 非对称 Crop50 | 41/50 | 44/50 |
| 组合攻击 | 20/50 | 30/50 |

pHash 与 ORB LSH 候选并集：

- Top-20：237/250
- Top-30：242/250
- Top-50：248/250
- Top-75：250/250

### SIFT BoVW

512 visual words，小型 codebook：

| 变换 | Top-5 | Top-20 | Top-50 |
|---|---:|---:|---:|
| JPEG20 | 49/50 | 50/50 | 50/50 |
| Crop50 | 44/50 | 48/50 | 50/50 |
| Crop70 | 26/50 | 41/50 | 48/50 |
| 非对称 Crop50 | 43/50 | 47/50 | 50/50 |
| 组合攻击 | 23/50 | 41/50 | 46/50 |

pHash + ORB LSH + SIFT BoVW：

- Top-20：246/250
- Top-30：248/250
- Top-50：250/250

重要结论：

1. 20 张小库的 Top-5 满召回明显过于乐观。
2. 在强相关 hard-negative 库中，**Top-50 是比 Top-20 更稳妥的当前候选预算**。
3. 组合攻击仍是最难召回场景。
4. BoVW 在较相关库中能补回一部分 pHash / LSH 漏检，但仍不能单独承担召回。
5. 该 150 图压力集仍然远小于真实 50 万库，Top-50 只是当前工程候选，不是最终冻结值。

本轮 150 图索引下，pHash + LSH 查询循环 median 约 3.44 ms，P95 约 7.96 ms。该时间不含真实数据库、磁盘与精确验证。

## R011｜紧凑精确特征的存储 / 召回权衡

### ORB / AKAZE 作为最终几何验证

在与 R007 相同的 200 true-pair 主体上，使用 compact binary features 进行几何 + 内容一致性验证：

- ORB 256 descriptors：145/200 被探索性高置信规则确认，0/198 hard-negative false positive。
- AKAZE 256 descriptors：145/200 被确认，0/198 false positive。

两者在 Crop70 与组合攻击上的确认率明显低于 SIFT，因此当前不建议把 ORB / AKAZE 单独作为最终 verifier。

### CV_8U SIFT

OpenCV SIFT 使用 CV_8U 描述子以降低存储：

- 64 descriptors/image：descriptor payload 8 KB/image。
- 128 descriptors/image：16 KB/image。
- 256 descriptors/image：32 KB/image。

在 128 descriptors/image 条件下，稍微收紧探索性规则中的 query-feature fraction 后：

- true confirmed：159/200
- hard-negative false positive：0/198

256 descriptors/image：

- true confirmed：168/200
- hard-negative false positive：0/198

仅计算 descriptor raw payload：

- 128 × 128 bytes × 500k ≈ 8.2 GB
- 256 × 128 bytes × 500k ≈ 16.4 GB

还未计入 keypoint 坐标与索引开销。

结论：compact SIFT 可以作为离线精确验证缓存候选，但全量持久化会形成数 GB 至十余 GB 的额外索引，需要与“候选后按需读取 / 生成”策略继续比较。

## R012｜低纹理 fallback

R007 的主要 SIFT 失败集中在 clock、horse、cell 等低纹理 / 少关键点图片。

对这 3 张图各生成 10 类困难变化，共 30 Query：

- JPEG20
- Crop30 / 50 / 70
- 非对称 Crop50
- 水印
- 5° 旋转
- 透视
- 组合攻击
- 镜像

使用多尺度 grayscale + edge template correlation，在 20 张库存候选中排名：

- Top-1：29/30
- Top-5：30/30
- 唯一 Top-1 失败为 clock + perspective，正确原图排第 3。

但该朴素实现对 30 × 20 候选、17 个尺度总计耗时约 52.6 s，因此 **绝不能全库运行**。

结论：

1. 低纹理并不是无解。
2. template / edge correlation 适合在“局部特征不足”时作为候选后 fallback。
3. 必须先缩小到很小的候选集再运行。
4. 低纹理路径与普通高纹理路径应该分支处理，而不是强迫所有图片走同一算法。

## 更新后的当前判断

当前图片链更适合采用分层漏斗，而不是一条固定算法：

```text
Exact hash
  ↓
Lane A: pHash / multi-region hash
  +
Lane B: local-feature inverted retrieval
  ↓
candidate union，当前压力集倾向保留约 Top-50
  ↓
cheap local rerank
  ↓
high-texture:
    SIFT + RANSAC + content consistency
low-texture:
    multi-scale template / edge fallback
  ↓
Confirmed / Probable / Similar / Not found
```

当前最大的未决项已从“算法是否可行”收敛为：

- Lane B 在 50 万真实分布下采用哪种 inverted index。
- SIFT 精确特征是全量 compact 持久化，还是候选后按需生成 / 缓存。
- Top-50 是否能在更大、更多样的公开图库中保持足够召回。
- A4 用户真实素材域验收。


## R013｜50 万图 visual-word 倒排索引微基准

### 目的

验证 Lane B 是否必须依赖重量级向量数据库，还是可以先采用紧凑的 visual-word inverted index。

本轮只测试索引工程量级，不测试真实图片识别准确率。

### 合成分布

- 图片数：500,000
- visual words/image：48
- vocabulary：65,536
- 20% word assignment 来自 512 个高频词
- 其余来自长尾词
- 每图内部重复 word 去重
- 停用词：全词表 df 最高的 1%

最终：

- 平均 unique words/image：约 47.90
- postings：23,950,892
- postings 本体：约 91.37 MiB
- offsets：约 0.50 MiB
- IDF：约 0.25 MiB
- 构建时临时 word matrix：约 91.55 MiB

因此 50 万图、约 48 个紧凑 visual words/image 的核心倒排 postings 可以控制在约 100 MiB 量级，不需要为每个图片保存多表 LSH 的重复 posting。

### 稀疏候选累计

搜索只对命中的 postings 做 `unique + sparse bincount`，不再为每次 Query 分配 50 万长度 dense score array。

500k 条件下，Query 含 4 个高频干扰词、8 个随机噪声词：

| Query 中保留的目标长尾词 | Top-5 | Top-20 | Top-50 | median | P95 |
|---:|---:|---:|---:|---:|---:|
| 1 | 1/100 | 1/100 | 1/100 | 约 0.22 ms | 约 0.32 ms |
| 2 | 59/100 | 100/100 | 100/100 | 约 0.26 ms | 约 0.46 ms |
| 4 | 100/100 | 100/100 | 100/100 | 约 0.29 ms | 约 0.57 ms |

以上召回数字来自合成 visual-word 模型，只用于说明“共享多个具有区分度的局部词时，稀疏倒排很容易把目标推入 Top-50”，不得当作真实图片召回率。

### stop-word 作用

在 4 个目标长尾词条件下，额外强制加入 4 个最高频视觉词：

- 不过滤 stop words：median postings touched 约 41,406，median query 约 2.97 ms。
- 过滤 top 1% stop words：median postings touched 约 3,554，median query 约 0.25 ms。

结论：

1. visual-word inverted index 在 50 万规模的核心 postings 内存可控制在约百 MiB。
2. stop-word 过滤非常重要，可以把候选 posting 量压低一个数量级。
3. sparse accumulation 明显优于 dense 50 万 score array。
4. Lane B 值得优先做 inverted index，而不是默认上 HNSW 或 embedding。
5. 该微基准只证明索引结构量级，真实 visual-word 量化误差仍需公开大图库验证。

可复现脚本：`experiments/r013_visual_word_index_microbench.py`。

## R014｜50 万媒体 SQLite 元数据微基准

### 数据结构

模拟 500,000 个媒体文件，字段包括：

- storage_id
- relative path
- size
- mtime
- width / height
- 16-byte exact hash
- status
- 8-byte global image hash

索引：

- exact_hash
- storage_id + relpath

构建阶段使用 `journal_mode=OFF` 与 `synchronous=OFF`，所以构建时间只表示批量导入量级，不代表正式产品的数据安全设置。

### 结果

500k files + 500k image_signatures：

- SQLite 文件：约 67.22 MiB
- files 批量写入：约 2.78 s
- signatures 批量写入：约 0.58 s
- warm exact-hash lookup：median 约 0.0069 ms，P95 约 0.0096 ms
- warm storage/path lookup：median 约 0.0063 ms，P95 约 0.0074 ms
- 顺序读取 500k global hash rows：约 0.44 s

结论：

1. SQLite 保存文件目录、设备映射、exact hash 和轻量 signature 完全可行。
2. 50 万级 metadata 不是系统主要风险。
3. 大块 pHash arrays 与 local-feature postings 更适合独立紧凑文件或 mmap，而不是把所有高频检索数据逐条从 SQLite 读取。
4. SQLite 继续作为事实数据库和增量扫描状态库，视觉索引可以采用旁路二进制结构。

可复现脚本：`experiments/r014_sqlite_metadata_microbench.py`。

## R015｜pHash region 数量与全表扫描成本

使用随机 64-bit hashes，执行：

```text
XOR
→ popcount
→ 每图 region min
→ Top-20
```

每组重复 6 次，排除第一次后取 warm median。

| 库存 | regions/image | raw RAM | warm median |
|---:|---:|---:|---:|
| 100k | 28 | 21.36 MiB | 8.67 ms |
| 300k | 28 | 64.09 MiB | 29.74 ms |
| 500k | 28 | 106.81 MiB | 47.01 ms |
| 100k | 60 | 45.78 MiB | 14.13 ms |
| 300k | 60 | 137.33 MiB | 52.22 ms |
| 500k | 60 | 228.88 MiB | 67.20 ms |
| 100k | 201 | 153.35 MiB | 40.30 ms |
| 300k | 201 | 460.05 MiB | 107.38 ms |
| 500k | 201 | 766.75 MiB | 200.68 ms |

环境噪声会影响具体毫秒数，所以该表用于比较量级与 region 数量趋势，不作为产品 SLA。

结论：

1. 201-region 在 50 万图时 raw hash 已接近 0.75 GiB，单 Query 连续扫描约 0.2 s，作为默认常驻全表扫描过重。
2. 28 至 60 region 的 raw RAM 约 107 至 229 MiB，更适合 V1 的 Lane A 常驻候选层。
3. 201-region 可以保留为研究上限或二阶段候选内细化，不建议作为每个 Query 的第一步全库扫描。
4. Lane A 也应从“尽量多 region”转向“有限 region + Lane B 局部倒排互补”。

可复现脚本：`experiments/r015_phash_scan_microbench.py`。

## R015 后的阶段性收敛

截至当前，图片主链已经出现较稳定的工程方向：

```text
SQLite metadata / exact hash
  ↓
Lane A
  28 至 60 个精选 pHash regions
  常驻内存或 mmap
  ↓
Lane B
  compact visual-word inverted index
  约百 MiB postings 量级
  stop-word + IDF
  ↓
候选并集
  当前继续以 Top-50 为保守预算
  ↓
高纹理
  SIFT + RANSAC + content consistency
低纹理
  template / edge fallback
  ↓
Confirmed / Probable / Similar / Not found
```

当前仍未冻结：

- 28、60 或其他 region layout 的最终选择。
- visual-word codebook 的真实训练策略与版本升级机制。
- SIFT 是全量 compact 存储，还是候选后按需生成与缓存。
- Top-50 在更大真实图库中的召回。
- A4 用户真实素材域验收。
