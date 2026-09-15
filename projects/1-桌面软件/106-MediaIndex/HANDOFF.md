# P106｜MediaIndex HANDOFF

> 本文件是跨对话恢复入口。不得只凭聊天记忆继续。

## 1. 项目身份

- 项目：MediaIndex
- 编号：`P106`
- 路径：`projects/1-桌面软件/106-MediaIndex/`
- 日常开发：`p106-exp`
- 稳定候选：`p106-stable`
- 正式主线：`main`
- 固定流转：`main → p106-exp → p106-stable → main`

当前用户要求仍然有效：不修改公共文件，只维护 P106 自有目录与长期分支。因此 `/目录.md` 尚未登记 P106。

## 2. 新对话强制读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. 本目录 `开发约束.md`
5. `README.md`
6. `阶段记录.md`
7. `工作记录.md`
8. `docs/algorithm-validation.md`
9. `docs/video-validation.md`
10. `docs/architecture.md`
11. `docs/video-architecture.md`
12. `docs/index-storage.md`
13. `docs/real-domain-acceptance.md`
14. `docs/acceptance-app.md`
15. `docs/benchmark-plan.md`
16. `设计与演进.md`
17. 实时比较 `main / p106-stable / p106-exp`

## 3. 当前断点

**Phase 0：等待 A4 + V011 真实用户域验收。**

图片：

- R001 至 R016 已完成。
- A4 图片 runner 已完成。
- 真实用户数据未执行。

视频：

- V001 至 V014 已完成 synthetic / programmatic 验证。
- V011 视频 runner 已完成并支持 negatives。
- 真实用户数据未执行。

## 4. 真实域工具

当前首选入口已经改为 GUI：

```text
build_acceptance.bat
→ MediaIndex Acceptance.exe
```

GUI 源码：

```text
src/MediaIndex.Acceptance/
```

portable builder：

```text
build/BuildAcceptancePortable.ps1
build_acceptance.bat
```

private worker：

```text
experiments/acceptance_worker.py
```

用户流程：

```text
1. 第一次双击 build_acceptance.bat
2. 以后直接运行 dist/.../MediaIndex Acceptance.exe
3. 选库存目录
4. 拖入或添加 Query
5. 双击每条 Query 设置真实源，或设为无对应
6. 点开始
7. 只导出匿名结果 JSON
```

旧 CSV / BAT 流程保留为 fallback。

私人媒体、绝对路径和可辨认缓存不得写入公开仓库。

## 5. 当前统一架构

```text
SQLite metadata / exact hash
        ↓
shared visual primitives
        ↓
image
  selected pHash candidate retrieval
  local geometry verifier

video
  Tier V0 ~1 fps temporal anchors
  Tier V1 sparse timestamp local keyframes
  Tier V2 sparse verifier / source decode
  Audio Lane C
  piecewise temporal alignment
        ↓
Exact / Same / Derived / Partial / Composite / Ambiguous / Similar / Not found
```

## 6. 已否决的重要简化

- 单一 pHash。
- 默认 201-region 全表。
- 全库逐图 / 逐帧 SIFT。
- 只看 RANSAC inliers 或 ratio。
- ORB / AKAZE 单独作为 final verifier。
- AI semantic similarity 直接判同源。
- 视频只用文件 hash、首帧或一个整体 hash。
- 视频只支持固定 offset 或单一 affine。
- 2 s / 4 s 粗采样作为短 clip 基线。
- whole-video unordered BoVW。
- audio match 单独宣布 Same video。
- 每个 1 fps video frame 保存完整图片级 thumbnail / signature。
- 对共享片头强行输出唯一 source。

## 7. 当前唯一下一步

执行 **A4 + V011 真实域验收**。

正式建议：

- 图片 Library 100 至 300。
- 图片正样本 30 至 50。
- 图片 hard negatives 20 至 50。
- 视频 Library 20 至 50。
- 总视频时长 2 至 5 小时以上。
- 视频 Query 30 个以上。

若用户希望更快启动，可先做更小 smoke acceptance，再扩大。

真实域通过后：

```text
freeze Phase 0
→ build first MediaIndex MVP
```

## 8. 写入边界

当前只允许修改：

```text
projects/1-桌面软件/106-MediaIndex/
```

不得修改：

- `/目录.md`
- `/GPT_RULES.md`
- 分类 `开发约束.md`
- P101 至 P105
- 公共 workflow
- 其他共享入口

## 9. 恢复模板

```text
P106 MediaIndex
main: <实时 SHA>
p106-stable: <实时 SHA / ahead-behind>
p106-exp: <实时 SHA / ahead-behind>
catalog registration: pending
image benchmark: R016
video benchmark: V014
real-domain toolkit: ready
real-domain run: pending / completed
phase: <当前阶段>
next action: <唯一明确断点>
```
