# P106 Experiments

本目录只保存公开安全、可复现的算法和工程微基准。

当前原则：

1. 不包含用户私人媒体。
2. 不包含用户真实路径。
3. 默认使用程序生成数据，或运行环境中合法可用的公开样例。
4. 微基准只说明量级，不等同正式 Windows 产品性能。
5. 每个脚本的结果必须回写到 `docs/algorithm-validation.md`，并明确测试边界。

当前脚本：

- `r013_visual_word_index_microbench.py`：模拟 50 万图片的紧凑 visual word 倒排索引。
- `r014_sqlite_metadata_microbench.py`：模拟 50 万媒体元数据和 exact hash 的 SQLite 存储。
- `r015_phash_scan_microbench.py`：比较不同 region 数量下的 pHash 连续内存扫描成本。
