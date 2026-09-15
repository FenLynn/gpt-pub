# P106｜Video Architecture Draft

> 当前仅为 V001 至 V004 后的架构草案。

## 1. 视频不是单张大图片

视频同源检索同时包含两个维度：

```text
空间
这一帧是不是来自同一视觉源

时间
这些帧是不是按可解释的时间关系来自同一个视频
```

因此视频最终判定不能只依赖一个文件级 hash 或一个整体 embedding。

## 2. 第一层，文件与媒体元数据

保存：

- exact file hash
- duration
- codec / container
- width / height
- nominal fps
- audio presence
- storage / path

Exact hash 只解决字节完全相同。

duration、fps 和 codec 只能用于候选约束，不能作为同源结论。

## 3. 第二层，采样帧签名

当前基线是 1 fps，只用于验证。

正式方案要比较：

- 0.25 fps
- 0.5 fps
- 1 fps
- scene-change adaptive
- hybrid，低运动降低采样，高变化提高采样

每个采样点至少保留：

```text
video_id
source_timestamp
global / selected-region pHash
visual-word postings
texture / feature summary
optional verifier thumbnail reference
```

这些 frame signature 尽量复用图片索引实现。

## 4. Frame-to-video inverted retrieval

不要执行：

```text
Query video
×
所有库存视频
×
所有库存 frame
```

而应建立：

```text
frame fingerprint
→ postings
→ video_id + timestamp
```

每个 Query sampled frame 投票给：

- candidate video
- candidate source timestamp
- visual confidence

最终形成一组 correspondence：

```text
(query_time, source_time, visual_score)
```

## 5. 时间模型

V003 已证明只用一种模型不够。

### Model A，constant offset

用于：

- 普通转码
- 中间 clip
- 去头去尾

```text
source_time ≈ query_time + offset
```

### Model B，affine speed

用于：

- 轻微加速 / 减速
- fps 改变但时间尺度同步

```text
source_time ≈ scale × query_time + offset
```

V003 的 1.05× 查询可恢复 scale 约 1.05。

### Model C，piecewise monotonic

用于：

- 删除中间片段
- 插入片头 / 广告
- 多段拼接
- 局部变速

目标不是拟合一条全局直线，而是寻找：

```text
时间单调
局部 slope 合理
允许 source / query 跳跃
视觉证据连续
```

当前优先考虑：

- offset-mode segmentation
- dynamic programming sequence alignment
- subsequence DTW
- monotonic longest-path / Hough voting

最终实现尚未冻结。

## 6. 深度 frame verification

候选视频和时间区间确定后，只验证少量代表帧。

高纹理：

```text
SIFT
→ RANSAC
→ warp NCC / block consistency
```

低纹理：

```text
thumbnail
→ template / edge consistency
```

这与图片 verifier 共用实现。

## 7. 结果分类

视频结果建议至少区分：

- Exact file
- Same video，完整转码或重编码
- Derived video，有水印、裁剪、字幕、轻微编辑
- Partial clip，库存视频的局部片段
- Composite / edited sequence，多段来源或明显剪辑
- Similar
- Not found

对于 Partial clip 返回：

```text
source video
source start
source end
estimated speed factor
confidence
```

## 8. 短片段边界

V004 中 3 s clip 虽然 6/6 Top-1 正确，但出现第二候选非常接近正确源。

所以短片段策略应该是：

- 证据越短，自动 Confirmed 门槛越高。
- 3 s 左右默认需要 local verification 或更多独立帧证据。
- 静态镜头还需要更长时间或音频等额外证据。

## 9. 音频 Lane

音频 fingerprint 暂不进入主链，但值得后续 V010 验证。

潜在价值：

- 视觉被大水印或竖屏裁剪破坏。
- 静态画面视频。
- 同一视频不同分辨率但音轨保留。
- 更快定位长视频时间 offset。

风险：

- 换配乐。
- 静音。
- 重新配音。
- 音频速度变化。
- 版权与隐私缓存边界。

因此音频应作为独立证据 Lane，不应成为视频存在性的唯一判据。

## 10. 与图片索引统一

长期不应该维护两套完全独立视觉引擎。

目标：

```text
Image engine
  pHash
  visual word
  verifier thumbnail
  SIFT / content verification

Video engine
  sampled frame
      ↓
  reuse Image engine
      ↓
  add timestamp and sequence layer
```

视频对图片底座只增加时间语义，不复制视觉算法。

## 11. V005 至 V007 收敛

### Sampling baseline

V005 对 0.5 / 1 / 2 / 4 s uniform sampling 的结果说明：

- 0.5 s：9/9 related Top-1，困难 clip 仍有较充分时间证据。
- 1 s：9/9，当前存储与召回的更合理基础点。
- 2 s 与 4 s：仅 5/9，短 clip 出现明显 sampling phase alias。

因此当前方向不是单纯降低采样率，而是：

```text
约 1 fps uniform baseline
+
scene / motion adaptive extra samples
```

scene keyframe 只能增强，不能完全替代 uniform baseline。

### Timestamp-preserving Lane B

V007 否定了 whole-video small-vocabulary ORB BoVW。相关视频之间会共享大量视觉词，如果丢掉 timestamp，exact clip 都可能被错误视频抢走。

视频 local-feature postings 至少保留：

```text
visual token
→ video_id
→ timestamp / frame_id
```

candidate score 应同时考虑 visual score 与时间一致性。

### Piecewise temporal model

V006 的删除中段案例可以被两个 offset segment 正确解释，而单一 affine 只能覆盖部分证据。

正式模型层级固定为：

```text
constant offset
→ small affine speed
→ piecewise monotonic alignment
```

Model C 后续优先采用 dynamic programming 或 monotonic longest-path，而不是无限增加 RANSAC 直线。

## 12. V008 至 V010 收敛

### Visual edit severity

V008 把视频视觉变换分成了两类：

- 字幕 / letterbox：Lane A pHash 序列通常已经足够。
- 画中画 / 强竖屏裁剪：Lane A 明显变弱，尤其竖屏中心裁剪在当前 28-region source pHash 中会错排。

所以视频 visual path 也必须 texture / transform aware。竖屏和画中画优先进入 frame-level local-feature Lane B 与 verifier，而不是继续放宽全局 Hamming 阈值。

### Composite source graph

V009 表明一个 Query 可以由多个库存视频片段组成。结果模型不能只返回一个 source video，而应允许：

```text
query segment
→ source video
→ source interval
→ temporal transform
→ confidence
```

多个 segment 共同组成 Composite / edited sequence 结果。

### Audio Lane C

V010 已验证 Chromaprint-like sequence 具有高价值：

- AAC 低码率重编码几乎保持 fingerprint。
- 8 s clip 可以通过 fingerprint sliding 找到 source 区间。
- 1.05× audio speed 可以通过 scale search 恢复约 1.055。
- unrelated audio 与同源 fingerprint 分离明显。

但同一个音轨放到完全不同的视频时 fingerprint 可以 100% 相同。因此：

```text
audio evidence
只能支持 / 加速
不能单独宣布 same video
```

Audio Lane C 当前定位：

- candidate video / timestamp acceleration。
- 静态画面与严重视觉裁剪的 supporting evidence。
- 与 visual temporal model 做 cross-check。

最终高置信 Same / Derived 仍要求视觉证据或明确的多模态一致性。


## 13. Shared intro, repeated segments and ambiguity

V012 adds two required concepts.

### Ambiguous source

If a 3 to 5 s Query contains only a shared intro or outro used by multiple videos, several sources can be equally correct.

The system must allow:

```text
Ambiguous
multiple source videos
same confidence class
```

It must not break ties arbitrarily and label one video Confirmed.

### Multiple positions in one source

A repeated sequence can occur twice inside the same source video.

Therefore a source result can contain:

```text
source video
candidate interval 1
candidate interval 2
...
```

The temporal layer needs interval uniqueness, not only source-video uniqueness.

Common intro, outro, logo and template sequences should be downweighted similarly to stop words.

## 14. Strong crop rescue

V013 shows a practical rescue path for vertical crop and crop plus watermark.

Experimental chain:

```text
pHash candidate shortlist
→ rough temporal offset
→ search around offset ±1 s
→ SIFT + RANSAC
→ candidate rerank
```

For the tested 8 s vertical crop queries:

- correct source survived the pHash Top-3.
- SIFT restored the correct source to first place.
- incorrect candidates produced no verified frames.

This validates local geometry as a deep video verifier.

However, the production path should not depend on pHash Top-3. Timestamp-preserving local-feature postings should be able to retrieve the source independently when strong crop weakens pHash.

## 15. Tiered video indexing

V014 shows that video indexing must scale with total hours.

Current architecture:

```text
Tier V0
approximately 1 fps
global pHash
video_id
timestamp

Tier V1
sparse scene / motion / periodic keyframes
local visual words
timestamp-preserving inverted postings

Tier V2
very sparse verifier thumbnail
or source decode on demand

Audio Lane C
compact time-sequence fingerprint
```

Important consequence:

> The image engine and video engine share algorithms, but they should not store the same amount of data per visual sample.

A 10,000 h library contains about 36M baseline samples at 1 fps. Storing a small pHash anchor for each is practical. Storing image-level thumbnails for every sample is not.

## 16. Current result graph

Video matching should be represented as evidence and source intervals, not one scalar similarity.

A candidate can contain:

```text
candidate video
visual correspondences
audio correspondences
time model
matched query intervals
matched source intervals
ambiguity
selected-frame verification
confidence
```

Final relation can be:

- Exact file
- Same video
- Derived video
- Partial clip
- Composite / edited sequence
- Ambiguous
- Similar
- Not found

## 17. Real-domain gate

The next architecture gate is V011 together with image A4.

Synthetic validation has already exposed:

- short-clip ambiguity
- shared intro ambiguity
- repeated intervals
- strong vertical crop
- composite editing
- speed changes
- middle deletion
- same audio with different video
- video index growth

The remaining question is no longer whether these cases exist. It is how often they occur in the user's real inventory and which thresholds are appropriate there.
