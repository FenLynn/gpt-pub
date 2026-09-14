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

当前用户明确要求：暂不修改任何公共文件，只建立 P106 自有目录和长期分支。因此 `/目录.md` 尚未登记 P106。后续通过独立统一仓库任务补齐，不得在当前 P106 开发提交中夹带。

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
10. `设计与演进.md`
11. 实时比较 `main / p106-stable / p106-exp`

## 3. 当前断点

当前处于 **Phase 0：图片算法 A 阶段验证**。

已完成：

- A0 受控 Krokiet / SIFT 基线。
- A1 第一轮 20 图、340 Query 自然样例正样本矩阵。
- A2 第一轮 222 hard-negative。
- A3 第一轮 100k 至 500k hash 微基准与候选索引探索。

当前架构候选：

```text
Exact hash
→ Lane A: global / multi-region pHash
→ Lane B: scalable local-feature index
→ candidate union
→ SIFT + RANSAC
→ content consistency
→ Confirmed / Probable / Similar / Not found
```

### 已否决的简化

- 单纯调宽全局 pHash 阈值。
- 全库逐图 SIFT。
- 只看 RANSAC inliers。
- 只看 inlier ratio。
- 把视觉语义相似直接作为同源结论。

### 当前主要风险

Lane B 尚未冻结。小库中 ORB、LSH 与 BoVW 均显示价值，但 50 万规模的紧凑 local-feature inverted index 尚未经过真实分布验证。

## 4. 当前唯一下一步

继续在 `p106-exp`：

1. 扩大公开图片交叉验证集。
2. 比较 compact ORB LSH 与 visual-word inverted index。
3. 专门处理低纹理图片。
4. 冻结 candidate Top-k 策略后，再进入 A4 用户真实域验收。

不需要用户继续手工调 Krokiet 参数。

## 5. 写入边界

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

## 6. 恢复模板

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
