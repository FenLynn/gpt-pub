# P106｜MediaIndex HANDOFF

> 本文件是跨对话恢复入口。不得只凭聊天记忆继续。

## 1. 项目身份

- 项目：MediaIndex
- 预留编号：`P106`
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
14. `docs/benchmark-plan.md`
15. `设计与演进.md`
16. 实时比较 `main / p106-stable / p106-exp`

## 3. 当前断点

当前处于：

**Phase 0：真实域验收前最后收口。**

图片：

- R001 至 R016 已完成。
- A4 协议已准备，真实用户数据未执行。

视频：

- V001 至 V014 已完成合成 / 程序样例验证。
- V011 runner 已准备，真实用户视频未执行。

最新新增结论：

- shared intro / outro 会造成多 source 歧义。
- 一个 source 内重复内容会产生多个合法 intervals。
- vertical crop + watermark 可以通过 local SIFT geometry rescue。
- video local postings 必须保留 timestamp。
- 约 1 fps baseline 适合作为当前 Tier V0 候选。
- 视频必须采用 V0 / V1 / V2 分层索引。
- Audio Lane C 很有价值，但不能单独证明 Same video。

## 4. 当前统一架构

```text
SQLite metadata / exact hash
        ↓
shared visual primitives
        ↓
image:
  selected pHash
  visual-word retrieval
  verifier

video:
  Tier V0
    ~1 fps lightweight temporal anchors
  Tier V1
    sparse timestamp local-feature keyframes
  Tier V2
    sparse verifier cache / source decode
  Audio Lane C
  temporal alignment
        ↓
Exact / Same / Derived / Partial / Composite / Ambiguous / Similar / Not found
```

## 5. 已否决的重要简化

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

## 6. 当前唯一下一步

执行 **A4 + V011 真实域验收**。

真实媒体全部留在仓库外。

推荐：

- 100 至 300 张真实图片。
- 20 至 50 个真实视频，总时长至少 2 至 5 小时。
- 真实 Query 包含压缩、截图、裁剪、短 clip、同片头、同 BGM、竖屏、水印和 unrelated negatives。

只把去标识化结果写回仓库。

## 7. 写入边界

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

## 8. 恢复模板

```text
P106 MediaIndex
main: <实时 SHA>
p106-stable: <实时 SHA / ahead-behind>
p106-exp: <实时 SHA / ahead-behind>
catalog registration: pending / completed
image benchmark: R016
video benchmark: V014
real-domain: pending / completed
phase: <当前阶段>
next action: <唯一明确断点>
```
