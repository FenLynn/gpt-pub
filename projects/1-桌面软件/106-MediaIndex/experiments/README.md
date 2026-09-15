# P106 Experiments

本目录只保存公开安全、可复现的算法和工程微基准。

当前原则：

1. 不包含用户私人媒体。
2. 不包含用户真实路径。
3. 默认使用程序生成数据，或运行环境中合法可用的公开样例。
4. 微基准只说明量级，不等同正式 Windows 产品性能。
5. 图片实验结果回写到 `docs/algorithm-validation.md`；视频实验结果回写到 `docs/video-validation.md`，并明确测试边界。

当前脚本：

- `r013_visual_word_index_microbench.py`：模拟 50 万图片的紧凑 visual word 倒排索引。
- `r014_sqlite_metadata_microbench.py`：模拟 50 万媒体元数据和 exact hash 的 SQLite 存储。
- `r015_phash_scan_microbench.py`：比较不同 region 数量下的 pHash 连续内存扫描成本。
- `r016_thumbnail_verifier_microbench.py`：比较缩略图缓存的存储量、SIFT 重建成本与精确验证能力。

## 视频脚本

- `v001_video_sequence_benchmark.py`：生成相关小视频库，验证转码、clip 与 speed 的 pHash 时间序列。
- `v005_sampling_rate_benchmark.py`：比较 0.5 / 1 / 2 / 4 s uniform sampling。
- `v006_piecewise_temporal_alignment.py`：验证 cut 后的 piecewise offset segmentation。
- `v007_orb_visual_word_video_negative.py`：证明无 timestamp 的小词表 ORB BoVW whole-video voting 不可靠。

- `v008_visual_edit_benchmark.py`：验证字幕、letterbox、竖屏裁剪等视觉修改。
- `v009_composite_video_benchmark.py`：验证一个 Query 同时来自多个源视频片段。
- `v010_audio_chromaprint_benchmark.py`：验证 Chromaprint 对重编码、clip、speed 与 unrelated audio 的区分。

- `v011_real_video_acceptance_runner.py`：真实视频小域 baseline 验收工具，读取 manifest 并输出 Top-1、margin、offset 与 scale。
- `v012_long_video_repeated_segments.py`：验证共享片头片尾、长视频和同源内部重复片段。
- `v013_vertical_crop_sift_rescue.py`：验证强竖屏裁剪在 pHash 候选后的 SIFT + RANSAC rescue。
- `v014_video_index_scale.py`：按总视频时长估算 1 fps baseline、local postings、thumbnail 与 Audio Lane 容量。


## 真实域验收工具

- `install_acceptance_env.bat`：创建独立 Python 环境。
- `prepare_real_domain_acceptance.bat`：创建仓库外私有验收目录结构。
- `run_real_domain_acceptance.bat`：顺序运行 A4 图片与 V011 视频 baseline。
- `a004_real_image_acceptance_runner.py`：图片真实域候选召回与保守 verifier baseline。
- `v011_real_video_acceptance_runner.py`：视频 Tier V0 pHash + 时间模型 baseline。
- `acceptance_summary.py`：合并两个 JSON 的匿名摘要。
- `image_manifest_template.csv` 与 `video_manifest_template.csv`：manifest 模板。

真实媒体不得提交到本目录。
