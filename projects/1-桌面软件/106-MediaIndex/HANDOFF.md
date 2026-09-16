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
start_acceptance.bat
→ 自动构建或直接启动 MediaIndex Acceptance.exe
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
1. 双击 start_acceptance.bat
2. 若 portable 已存在会直接启动；若不存在会自动构建并启动
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


## 10. Acceptance 单 EXE 候选

用户已经授权 P106 专用 workflow 作为此前“只改 P106 目录”规则的唯一额外例外：

```text
.github/workflows/p106-mediaindex-acceptance.yml
```

当前成功候选：

```text
version: 0.0.1
commit: 70a6918ea3eb4516586082449be9442d0b96b4bf
run: 34942719186
delivery: one self-contained Windows x64 EXE
sha256: 1e1d4ea51d2309bff42068d703e0849748cf0a1bc6f0ebb59c26be22dc1ee0c7
```

架构：

```text
MediaIndex Acceptance.exe
  ↓ embedded resource
private algorithm worker
  ↓ extract on demand
%LOCALAPPDATA%\FenLynn\MediaIndex\Acceptance\Runtime
```

用户侧不需要 Python、仓库、BAT 或 .NET Runtime。

下一步仍然是用该 EXE 完成 A4 + V011 真实域 smoke acceptance。


## 11. v0.0.2 用户自动验收发现

用户本机 Round 1 库：

```text
20 library images
40 automatic positive queries
Top-50 recall = 100%
Top-1 = 85%
Confirmed recall = 57.5%
```

6 个 Top-1 失败均为 Crop30 / asymmetric Crop，且没有高置信 Confirmed。旧版在该路径上会让噪声 SIFT verification score 覆盖 pHash 的正确候选顺序。

v0.0.3 已修改：

- 有 Confirmed 时 verifier 优先。
- 无 Confirmed 时 multi-region pHash 优先，verifier 只作 tie-break。
- GUI 明示 Top1 / Top50 / Confirmed。
- 自动 smoke 加 synthetic unrelated sanity negatives。
- V011 继续使用 sequence-aware temporal fitting。

不要把 v0.0.2 的“Top50 100% / 误确认 0”视为整体验收通过，因为该轮没有负样本且 Top1 仅 85%。

## 12. Product Preview 断点

当前已经从 Phase 0 Acceptance 进入：

```text
Phase 1
MediaIndex v0.1.0 Product Preview
```

新增正式用户入口：

```text
src/MediaIndex.App/
```

新增持久核心：

```text
experiments/mediaindex_core.py
experiments/ci_mediaindex_core.py
```

新增 known hard-negative gate：

```text
experiments/ci_hard_negative_suite.py
```

新的普通用户流程：

```text
choose image library
→ build/update persistent index
→ drag/select query image
→ search
→ inspect returned source path
```

Acceptance 继续存在，但定位改为 regression / diagnostics。

### 当前持久索引

```text
%LOCALAPPDATA%\FenLynn\MediaIndex\Indexes\<library-id>\
  index.sqlite3
  region_hashes.npy
  image_ids.npy
```

### 当前 CI gate

必须通过：

- A4/V011 regression
- known hard-negative suite
- persistent core smoke
- incremental rebuild reuse
- exact byte-identical lookup
- main EXE self-test
- Acceptance EXE self-test
- single EXE checks
- SHA-256

### 下一主线

```text
v0.1.0 larger real library
→ persistent local-feature Lane B
→ 10k/100k/500k scale
→ removable/offline drive lifecycle
→ persistent video Tier V0
→ video Tier V1 + Audio Lane C
```

不要再把“手工逐条 Query 标答案”作为默认验收流程。
