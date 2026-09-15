# P106｜Real-domain Acceptance Protocol

> 本文用于 A4 图片真实域验收与 V011 视频真实域验收。真实私人媒体、绝对路径和可辨认缩略图不得提交到公开仓库。

## 1. 目的

前面的 R / V 系列主要回答“路线是否可行”。

A4 / V011 不再探索新算法，主要回答：

> 当前已经收敛的 MediaIndex 检索链，在用户真实库存分布中是否仍保持高召回和低误报。

如果真实域失败，应回到具体失败类型修正，而不是继续无目的增加算法层。

## 2. 数据必须留在仓库外

推荐本地目录：

```text
MediaIndex-Acceptance/
├─ Library/
│  ├─ Images/
│  └─ Videos/
├─ Query/
│  ├─ Images/
│  └─ Videos/
└─ manifest.csv
```

公开仓库只保存：

- 测试工具。
- 去标识化统计。
- 算法版本。
- 失败类型分类。

不得保存：

- 原照片。
- 原视频。
- 可辨认 verifier thumbnail。
- 用户真实绝对路径。
- 私人媒体 fingerprint dump。

## 3. 图片 A4 建议最小集

库存：

- 100 至 300 张真实图片。
- 尽量混入连拍、同场景不同角度、截图、海报、人物、风景、低纹理图。

Query：

- 30 至 50 个明确同源正样本。
- 20 至 50 个 hard negative。

正样本优先来自真实日常链路：

- 微信 / 社交软件压缩。
- Windows 截图。
- 相册二次导出。
- JPG / PNG / WebP 转换。
- 任意裁剪。
- 竖屏裁剪。
- 加字 / 水印。
- 多次转存。

重点指标：

- candidate Top-50 recall。
- Confirmed recall。
- false Confirmed。
- Probable 数量。
- Query 延迟。

## 4. 视频 V011 建议最小集

库存：

- 20 至 50 个真实视频。
- 总时长最好至少 2 至 5 小时。
- 混入同一活动、同一相机、同一片头、相同 BGM 等相关视频。

Query 建议 30 个以上：

- 完整转码。
- 不同分辨率。
- 不同 fps。
- 5 至 20 s 中间片段。
- 3 至 5 s 短片段。
- 字幕。
- 黑边。
- 竖屏裁剪。
- 水印。
- 去头去尾。
- 插片头。
- 轻微加速。
- 多段拼接。
- unrelated negatives。

## 5. 视频 manifest

`v011_real_video_acceptance_runner.py` 使用 CSV：

```csv
query,expected_source,relation,expected_start_sec
D:\test\q01.mp4,folder/source01.mp4,Partial clip,125.0
D:\test\q02.mp4,folder/source02.mp4,Same video,
```

`expected_source` 使用相对于 `--library` 的路径。

当前 V011 runner 是 **视觉 pHash + 时间模型基线工具**，不包含最终 local-feature Lane B、Composite piecewise 或 Audio Lane C。因此它用于快速暴露真实域困难样本，不代表最终产品判定能力。

## 6. 验收记录

仓库只记录类似：

```text
dataset: USER-DOMAIN-01
private media: not committed
image library count: ...
video library count: ...
positive query count: ...
hard negative count: ...

image Top-50 recall: ...
false Confirmed: ...

video Top-1: ...
clip source accuracy: ...
median start error: ...
ambiguous short clips: ...
failure classes:
  vertical crop: ...
  repeated intro: ...
  same audio different video: ...
```

## 7. 当前冻结原则

A4 / V011 之前不根据合成集冻结生产阈值。

A4 / V011 之后：

- 若普通同源变化稳定，通过。
- 若 failure 只集中在已知边界，则做定向 fallback。
- 若 false Confirmed 出现，优先提高判定保守性。
- 若 candidate 召回不足，修 Lane A / Lane B，而不是放宽 final verifier。


## 8. Windows 一键真实域工具链

当前已经提供：

```text
experiments/
  install_acceptance_env.bat
  prepare_real_domain_acceptance.bat
  run_real_domain_acceptance.bat
  image_manifest_template.csv
  video_manifest_template.csv
  a004_real_image_acceptance_runner.py
  v011_real_video_acceptance_runner.py
  acceptance_summary.py
```

### 第一次使用

在 `experiments` 目录双击：

```text
install_acceptance_env.bat
```

该脚本优先使用 `python`，若不存在再尝试 `py -3`。

当前安装：

- OpenCV
- NumPy
- Pillow
- pillow-heif

因此 A4 runner 可直接读取常见 JPG / PNG / WebP / TIFF，并支持 HEIC / HEIF。

### 创建本地私有工作区

双击：

```text
prepare_real_domain_acceptance.bat
```

默认生成：

```text
experiments/MediaIndex-Acceptance/
├─ Library/
│  ├─ Images/
│  └─ Videos/
├─ Query/
│  ├─ Images/
│  └─ Videos/
├─ image_manifest.csv
└─ video_manifest.csv
```

也可以把自定义目录作为第一个参数传入。

该工作区只用于本机，不得提交仓库。

### 图片 manifest

```csv
query,expected_source,relation
Query/Images/q01.jpg,folder/source01.jpg,Same source
Query/Images/q02.jpg,folder/source02.jpg,Crop
Query/Images/negative01.jpg,,Hard negative
```

规则：

- `query` 可使用相对于 acceptance root 的路径，也可用绝对路径。
- `expected_source` 使用相对于 `Library/Images` 的路径。
- hard negative 的 `expected_source` 留空。

A4 runner 当前输出：

- selected-region pHash candidate Top-k。
- expected source 是否进入 Top-50。
- SIFT / RANSAC / NCC baseline rerank。
- Top-1。
- baseline Confirmed recall。
- hard-negative false Confirmed。
- Query latency。

这些 baseline threshold 只用于验收分布观察，不是生产阈值。

### 视频 manifest

```csv
query,expected_source,relation,expected_start_sec
Query/Videos/q01.mp4,folder/source01.mp4,Partial clip,125.0
Query/Videos/q02.mp4,folder/source02.mp4,Same video,
Query/Videos/negative01.mp4,,Unrelated,
```

视频 runner 当前输出：

- Top-1 source。
- temporal inliers。
- fraction。
- estimated offset。
- estimated scale。
- median Hamming。
- second-candidate margin。
- positive Top-1 accuracy。
- negative exploratory strong-match count。

### 一键执行

完成媒体与 manifest 后，双击：

```text
run_real_domain_acceptance.bat
```

生成：

```text
a004_results.json
v011_results.json
real_domain_summary.json
```

后续分析时，优先只提供这三个 JSON。

不需要上传私人原照片或原视频，除非用户主动选择提供某个失败案例用于进一步诊断。

## 9. A4 / V011 的解释边界

当前 A4 图片 runner 已经包含较完整的 pHash candidate + SIFT verifier baseline。

V011 视频 runner 仍故意保持轻量，只作为 Tier V0 基线：

- 没有 timestamp local-feature Lane B。
- 没有 Audio Lane C。
- 没有 Composite piecewise solver。

如果 V011 在竖屏、强 crop、重复片头等已知难例中失败，不代表最终视频架构失败。重点是记录失败是否符合 V001 至 V014 已知边界。

真实域验收真正要警惕的是：

- 普通常规同源变化大量漏召回。
- unrelated negatives 产生强 false match。
- candidate source 连 Top-k 都进不去。
- 已知简单 clip 不能恢复 source time。
