# P106｜MediaIndex HANDOFF

> 本文件是跨对话恢复入口。不得只凭聊天记忆继续。

## 1. 项目身份

- 项目：MediaIndex
- 预留编号：`P106`
- 预留路径：`projects/1-桌面软件/106-MediaIndex/`
- 日常开发：`p106-exp`
- 稳定候选：`p106-stable`
- 正式主线：`main`
- 固定流转：`main → p106-exp → p106-stable → main`

当前用户明确要求：暂不修改任何公共文件，只建立和维护 P106 自有目录与长期分支。因此 `/目录.md` 尚未登记 P106。后续通过独立统一仓库任务补齐。

## 2. 新对话强制读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. 本目录 `开发约束.md`
5. `README.md`
6. `阶段记录.md`
7. `工作记录.md`
8. `docs/algorithm-validation.md`
9. `docs/benchmark-plan.md`
10. `docs/index-storage.md`
11. `设计与演进.md`
12. 实时比较 `main / p106-stable / p106-exp`

## 3. 当前断点

当前处于 **Phase 0：图片算法与索引冻结前验证**。

已完成至 R015：

- Krokiet / SIFT 受控基线。
- 20 图、340 Query 自然样例正样本矩阵。
- 222 hard-negative。
- 150 图相关场景压力集，250 Query。
- ORB LSH、ORB / SIFT BoVW。
- compact verifier 消融。
- 低纹理 fallback。
- 100k 至 500k pHash 扫描微基准。
- 500k synthetic visual-word inverted index。
- 500k SQLite metadata microbenchmark。

可复现脚本：

```text
experiments/r013_visual_word_index_microbench.py
experiments/r014_sqlite_metadata_microbench.py
experiments/r015_phash_scan_microbench.py
```

## 4. 当前架构候选

```text
SQLite metadata / exact hash
→ Lane A: 28 至 60 selected pHash regions
→ Lane B: compact visual-word inverted index
→ candidate union，当前约 Top-50
→ high texture: SIFT + RANSAC + content consistency
→ low texture: template / edge fallback
→ Confirmed / Probable / Similar / Not found
```

### 已否决的简化

- 单纯调宽全局 pHash 阈值。
- 默认 201-region 全表第一层。
- 全库逐图 SIFT。
- 只看 RANSAC inliers。
- 只看 inlier ratio。
- ORB / AKAZE 单独取代 final SIFT verifier。
- 把视觉语义相似直接作为同源结论。
- 把 20 图小库的 Top-5 满召回当成大库结论。

### 当前主要风险

1. visual-word Lane B 仍需更大的真实图片分布验证。
2. 28 至 60 regions 的最终 layout 未冻结。
3. compact SIFT 全量存储可能达到数 GB 至十余 GB。
4. Top-50 仍需 A4 真实域验收。
5. 低纹理 fallback 有效但只能候选后运行。

## 5. 当前唯一下一步

继续在 `p106-exp`：

1. 扩大公开真实图片交叉验证集。
2. 冻结 visual-word quantization / inverted index 方案。
3. 冻结 Lane A region layout。
4. 比较 SIFT storage 与按需 / cache 策略。
5. 然后进入 A4 用户真实域验收。

不需要用户继续手工调 Krokiet 参数。

## 6. 写入边界

当前只允许修改：

```text
projects/1-桌面软件/106-MediaIndex/
```

当前不得修改：

- `/目录.md`
- `/GPT_RULES.md`
- 分类 `开发约束.md`
- 其他 P101 至 P105 项目
- 公共 workflow
- 其他共享入口

## 7. 恢复模板

```text
P106 MediaIndex
main: <实时 SHA>
p106-stable: <实时 SHA / ahead-behind>
p106-exp: <实时 SHA / ahead-behind>
catalog registration: pending / completed
phase: <当前阶段>
verified benchmark: <最后一轮编号>
invalidated assumptions: <已否决规则>
next action: <唯一明确断点>
```
