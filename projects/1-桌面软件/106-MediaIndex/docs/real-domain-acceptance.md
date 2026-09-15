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
