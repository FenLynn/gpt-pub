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

## 待执行

- R005：真实自然图像正样本变换矩阵
- R006：难负样本
- R007：低纹理 / 重复纹理
- R008：多区域 hash Top-k 候选召回
- R009：10 万、30 万、50 万规模压力测试
- R010：最终图片链的消融与阈值冻结
