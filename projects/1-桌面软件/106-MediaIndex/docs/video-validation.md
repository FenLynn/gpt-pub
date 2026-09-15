# P106｜Video Validation

> 视频验证使用独立编号 `Vxxx`。当前均为公开安全的合成 / 软件包样例视频，不代表用户真实视频域。生成视频不提交仓库，只保留实验脚本和结果。

## V001｜完整视频转码与帧率变化

### 测试库

程序生成 6 个 24 s、640×360、8 fps 的库存视频。

源内容来自运行环境中可用的自然样例图，加入轻微 pan / zoom / 局部运动。不同视频之间故意复用部分视觉素材，使负样本比完全随机视频更相关。

基线签名：

- 1 fps 采样
- 每帧 64-bit pHash
- 每个 Query frame 在候选视频中找最近 frame
- 对 `query_time → source_time` 对应关系做时间一致性拟合

### 单视频变换

以其中一个源视频生成：

| Query | 时间一致 inliers | 结论 |
|---|---:|---|
| H.264 CRF32 + 480p | 24/24 | 正确 |
| H.265 CRF35 + 360p | 23/24 | 正确 |
| 8 fps → 4 fps | 24/24 | 正确 |
| 5% 边缘裁剪后拉伸 | 18/24 | 正确 |
| 大水印区域 | 15/24 | 正确 |

结论：对完整转码、分辨率变化和 fps 变化，低采样率 pHash 时间序列已经非常有效。

## V002｜视觉修改边界

### 强组合修改

8 s 中间片段同时：

- 非中心 20% 裁剪
- 拉伸回 640×360
- 大块水印
- H.264 CRF32

单全帧 pHash：

- 正确源视频仍排名第一
- 时间一致 inliers：2/8
- median Hamming：14
- 估计 source offset：约 7 s
- 置信度明显不足

28-region source-frame pHash：

- 时间一致 inliers：3/8
- median Hamming：8
- offset 约 6 s
- 有改善，但仍不足以高置信确认

紧凑 ORB、约 350 features/frame、2 s 采样的直接救援测试：

- 对该强组合片段未形成稳定时间对应
- 因此 ORB 不能被假设为视频强变换的万能 verifier

结论：

1. 视频视觉层不能只保存一个全帧 hash。
2. 图片阶段的 multi-region / visual-word / SIFT verifier 可以直接复用到视频采样帧。
3. 强裁剪 + 水印片段需要更强的 frame-level local-feature Lane B，而不是继续单独放宽 pHash 阈值。

## V003｜时间变换

### 中间片段

从源视频 7 s 处截取 8 s：

- 8/8 sampled frames 时间一致
- 正确视频 Top-1
- source offset = 7.0 s

### 轻微加速

源视频整体 1.05× 加速。

0.5 s 采样：

- 46 query samples
- 45 个进入时间模型
- fitted slope = 1.05
- offset = 0
- median Hamming = 2

说明时间模型可以直接估计轻微速度变化。

### 前插 3 s

在源视频前加入 3 s 无关片头：

- 27 query samples
- 24 个源内容 samples 被识别
- fitted slope = 1.0
- fitted offset = -3.0 s

说明前插内容不会破坏后续主序列定位。

### 删除中间 4 s

将 source `0–8 s` 与 `12–24 s` 拼接。

对应关系出现两个明显 offset mode：

- offset 0 s：8 个 samples
- offset 4 s：11 个 samples

若强行使用单一 affine model，会错误得到约 1.25 的 slope。

这是一个重要反例：

> **视频时间匹配不能只允许一个全局 offset 或一个全局 affine speed model。**

正式时间层必须支持 piecewise alignment、cut / insertion 与 monotonic sequence matching。

## V004｜多视频候选与短片段

### 6 视频相关库

6 个库存视频之间复用了部分自然样例图，因此存在一定相关视觉内容。

每个视频分别生成：

- 全长低质量 H.264
- 从 7 s 开始的 8 s 低质量 H.264 clip

结果：

- 12/12 正确 Top-1
- 所有 8 s clip 的 source offset 均恢复为 7.0 s

### 更短片段

每个库存视频再生成：

- 3 s clip
- 5 s clip

结果：

| clip length | Top-1 source |
|---:|---:|
| 3 s | 6/6 |
| 5 s | 6/6 |

所有 source offset 均为 7.0 s。

但 3 s 的一个样本出现：

- 正确 source score = 1.000
- 第二候选 score = 0.953

因此：

> 3 s 片段即使 Top-1 正确，也可能缺少足够候选间隔，不能只靠序列 pHash 自动 Confirmed。

### unrelated negative

程序生成完全无关的 24 s procedural video：

- full query 对 6 个库存视频的最高序列分数约 -0.049，仅形成 2 个弱一致点
- 5 s clip 未形成有效时间匹配

本轮未出现无关视频被高置信接受。

## 当前视频结论

第一轮已经证明视频主问题可以拆成：

```text
frame-level visual retrieval
+
temporal correspondence
```

图片阶段的视觉算法不是旁支，而是视频底座。

当前视频候选架构：

```text
video
  ↓
exact hash / metadata
  ↓
adaptive sampled frames
  ↓
image fingerprints per frame
  ↓
frame-to-video inverted retrieval
  ↓
candidate videos
  ↓
temporal correspondence graph
  ↓
offset / affine-speed / piecewise alignment
  ↓
selected frame local verification
  ↓
Same video / Derived / Partial clip / Similar / Not found
```

## 当前已否决的简化

- 只比较视频文件 hash。
- 只比较首帧或固定少数帧。
- 只使用一个全局视频 perceptual hash。
- 只允许固定时间 offset。
- 只使用单一 affine speed model。
- 认为 3 s clip Top-1 就足以自动 Confirmed。
- 认为 ORB 一定能救回所有 crop + watermark 难例。

## V005｜Frame sampling rate

固定同一 6 视频相关库，对 9 个来自目标视频的 Query 测试 uniform sampling：full transcode、8 s clip、5 s clip、3 s clip、crop10、watermark、crop + watermark + clip、1.05× speed、前插 3 s；另加 1 个 unrelated 5 s negative。

| sampling interval | 9 个 related Top-1 | <3 temporal inliers |
|---:|---:|---:|
| 0.5 s | 9/9 | 0 |
| 1.0 s | 9/9 | 1 |
| 2.0 s | 5/9 | 4 |
| 4.0 s | 5/9 | 4 |

关键观察：

- 0.5 s sampling 下，强组合 crop + watermark clip 仍有 5 个时间一致点，speed105 为 45/46。
- 1 s sampling 仍保持 9/9 Top-1，但强组合 clip 只剩 2 个时间一致点，属于 weak evidence。
- 2 s 与 4 s 在短 clip 上明显失败。一个核心原因是 sampling phase alias，例如库存按偶数秒采样，而从 7 s 开始的 clip 落在奇数秒视觉时刻。
- unrelated 5 s 在 0.5 s 与 1 s 测试均未形成有效时间匹配。

结论：当前 V1 更适合 `约 1 fps uniform baseline + selective denser / scene keyframes`。scene-adaptive sampling 应作为增强，不应完全替代 uniform baseline。

可复现脚本：`experiments/v005_sampling_rate_benchmark.py`。

## V006｜Piecewise temporal alignment

对实际视频 pHash correspondences 做受限 affine 与连续 offset segmentation。

8 s clip：

- matched pairs 约 7/8，在 V003 较宽阈值下为 8/8。
- slope ≈ 1.0。
- offset ≈ 7.0 s。

前插 3 s：

- matched pairs 24/27。
- slope ≈ 1.0。
- offset ≈ -3.0 s。

删除中间 4 s：

- matched pairs 20/20。
- segment 1：query 约 0 至 7 s，offset ≈ 0 s，8 samples。
- segment 2：query 约 8 至 19 s，offset ≈ 4.1 s，12 samples。
- 受限到正常轻微 speed range 的单一 affine model 只能解释约 12/20。

因此时间模型应采用层级：

```text
constant offset
→ small affine speed
→ piecewise monotonic alignment
```

正式 Model C 需要 query/source 时间单调、局部 slope 合理、允许 gap，并对切段数量设置惩罚。当前简单 segmentation 已能正确暴露 cut boundary，后续再比较 dynamic programming、subsequence DTW 与 monotonic longest-path。

可复现脚本：`experiments/v006_piecewise_temporal_alignment.py`。

## V007｜Frame-level visual-word retrieval 反例

测试能否把图片 Lane B 直接压成 whole-video Bag of Visual Words。

设置：

- 6 个相关视频。
- 144 source sampled frames。
- ORB 500 features/frame。
- 256-word MiniBatchKMeans codebook。
- IDF weighted shared visual words。

无时间约束的 whole-video voting 表现不可靠：exact 8 s clip 的最高 vote 可以落到错误视频，crop10、watermark 和强组合 clip 也容易被复用相似场景的其他视频抢走。

加入 frame timestamp consistency 后：

- crop10 恢复正确源 Top-1。
- watermark 恢复正确源 Top-1。
- speed105 恢复正确源 Top-1。
- exact 8 s clip 在这个小 ORB codebook 上仍失败。
- 强组合 crop + watermark clip 仍无法形成稳定候选。

结论：视频 Lane B 不能把一个视频压成无时间信息的 whole-video BoVW。postings 至少保留 `visual_word → video_id → timestamp/frame_id`，候选评分必须联合 visual discrimination 与 temporal consistency。256-word ORB codebook 也明显不够判别，后续优先比较更大 vocabulary、SIFT/RootSIFT visual words、multi-assignment 和 stop words。

可复现脚本：`experiments/v007_orb_visual_word_video_negative.py`。

## V005 至 V007 后的当前视频结论

```text
video
  ↓
exact hash / metadata
  ↓
约 1 fps uniform baseline
+ selective denser / scene keyframes
  ↓
timestamp-preserving frame retrieval
  ↓
candidate videos + correspondences
  ↓
constant / affine / piecewise temporal alignment
  ↓
selected-frame image verifier
  ↓
Same video / Derived / Partial clip / Composite / Similar / Not found
```

新增已否决简化：

- uniform sampling 低到 0.5 fps 甚至更低并认为仍足够覆盖短片段。
- scene-change keyframes 完全替代 uniform baseline。
- 把整个视频压成无 timestamp 的小词表 BoVW。

## V008｜字幕、黑边、竖屏裁剪与画中画

以同一 24 s 源视频生成 4 类视觉修改，并在 6 视频相关库中检索。

### 字幕 / 底部覆盖

global pHash：

- 正确源 Top-1。
- 16 个时间一致 samples。
- median Hamming 约 10。

multi-region pHash：

- 正确源 Top-1。
- 19 个时间一致 samples。

说明常规字幕条和底部覆盖对时间序列 pHash 影响有限。

### 黑边 / letterbox

global pHash：

- 正确源 Top-1。
- 14 个时间一致 samples。

multi-region：

- 正确源 Top-1。
- 12 个时间一致 samples。

说明上下黑边本身不是主要风险。

### 画中画 / 缩小后置于背景

global pHash：未形成有效匹配。

multi-region pHash：

- 正确源恢复 Top-1。
- 约 7 个时间一致 samples。
- 仍属于弱证据。

### 竖屏中心裁剪

将 640×360 源视频中心裁成约 202×360，再缩放为 360×640。

- global pHash：未形成有效匹配。
- 当前 28-region source pHash：错误视频排第一，正确源仅为第二候选。

这是目前非常明确的视觉失败案例。

结论：

1. 字幕和 letterbox 可由 Lane A 直接覆盖。
2. 画中画可被 multi-region 部分救回，但需要 verifier。
3. 强竖屏裁剪必须依赖更强的 local-feature Lane B、orientation-aware crop handling 或 source-frame local geometry。

可复现脚本：`experiments/v008_visual_edit_benchmark.py`。

## V009｜跨视频 Composite

构造 24 s composite：

```text
segment 1: lib_01 的 2 至 10 s
segment 2: lib_04 的 8 至 16 s
segment 3: lib_02 的 14 至 22 s
```

每段 8 s，重新编码后作为一个 Query。

1 fps pHash frame retrieval 自动形成 3 个连续 source runs：

```text
query 约 0.0 至 7.0 s
→ lib_01
8 samples
median Hamming ≈ 0

query 约 8.0 至 14.9 s
→ lib_04
8 samples
median Hamming ≈ 1

query 约 15.9 至 22.9 s
→ lib_02
8 samples
median Hamming ≈ 0
```

这说明 Composite / edited sequence 不需要强迫归到一个 source video。

正式结果结构应允许：

```text
Query video
→ source segment A
→ source segment B
→ source segment C
```

每段分别返回 source video、source interval、query interval 与 confidence。

可复现脚本：`experiments/v009_composite_video_benchmark.py`。

## V010｜Audio fingerprint Lane C

### 方法

使用 FFmpeg / Chromaprint raw fingerprint。程序生成 24 s 的多频段合成音频，只用于验证结构。

source fingerprint：172 个 raw uint32 entries。

### AAC 低码率重编码

source → AAC 48 kbps：

- mean bit Hamming ≈ 0.63。
- median = 0。
- 100% entries Hamming ≤ 8。

音频重编码鲁棒性非常高。

### 8 s 中间片段

clip fingerprint：43 entries。

滑窗匹配到 source：

- best raw offset = 57 fingerprint entries。
- mean Hamming ≈ 2.42。
- median = 2。
- 100% entries ≤ 8。

raw offset 需要结合 Chromaprint 的内部窗口延迟校准后才能转换成精确秒数，但已经足够用于快速 source-time 候选。

### 1.05× 速度变化

不做时间缩放时：

- mean Hamming ≈ 7.37。

加入 fingerprint sequence scale search：

- best scale ≈ 1.055。
- mean Hamming ≈ 2.69。
- median = 2。
- 100% entries ≤ 8。

与真实 1.05× 非常接近。

### Unrelated audio

- mean Hamming ≈ 14.60。
- median ≈ 15。
- Hamming ≤ 8 的比例约 1.7%。

与同源重编码 / clip 分离明显。

### 关键反例，同音轨但不同视频

把完全相同的 source audio 复用到另一个视觉完全不同的视频：

- Chromaprint 与 source 完全相同。
- mean Hamming = 0。

因此音频 fingerprint **绝不能单独证明视频同源**。

### 结论

Audio Lane C 很值得保留，最适合：

- 帮助长视频快速定位时间 offset。
- 视觉被强水印、竖屏裁剪或静态画面破坏时提供独立证据。
- 与视觉时间模型交叉确认。

但必须满足：

```text
audio match
≠
same video
```

音频只能是独立 supporting lane，不得覆盖视觉冲突。

可复现脚本：`experiments/v010_audio_chromaprint_benchmark.py`。

## V010 后的当前视频架构

```text
                 Query video
                       │
              exact hash / metadata
                       │
        ┌──────────────┴──────────────┐
        │                             │
   Visual lanes                  Audio Lane C
        │                             │
~1 fps baseline frames          Chromaprint-like
+ extra keyframes                time sequence
        │                             │
pHash + timestamp local index         │
        │                             │
        └──────────────┬──────────────┘
                       ▼
             candidate correspondences
                       │
        constant / affine / piecewise
               temporal alignment
                       │
             selected-frame verifier
                       │
Exact / Same / Derived / Partial / Composite / Similar
```

## 下一步

- V011：真实视频小域验收设计与测试工具。
- V012：更长视频、重复镜头与相同片头片尾。
- V013：竖屏强裁剪的 local-feature rescue。
- 然后把图片 A4 与视频 V11 合并为一次真实用户域验收。
