# P106｜MediaIndex Release Status

Version: 0.0.1-dev

## 当前状态

**没有正式发布授权。**

P106 当前处于 Phase 0 真实域验收准备阶段。Acceptance GUI 已进入 `v0.0.1-dev` 源码预览，但仍未授权正式发布：

- 没有正式 tag。
- 没有 GitHub Release。
- 没有稳定产品版本。
- 没有发布候选授权。

本文件当前仅用于明确“未授权发布”状态，不构成任何 Release marker。

未来只有在用户针对明确版本明确要求正式发布后，才允许按照仓库 A-11 创建正式标签与 Release。


## v0.0.1-dev Windows 候选

2026-09-15，用户明确授权增加 P106 专用 Windows 构建任务，用于生成可直接下载的 EXE。

活动 workflow：

```text
.github/workflows/p106-mediaindex-acceptance.yml
```

首个成功单 EXE 候选：

- Version: 0.0.1
- Branch: `p106-exp`
- Commit: `70a6918ea3eb4516586082449be9442d0b96b4bf`
- GitHub Actions run: `34942719186`
- Artifact: `MediaIndex-Acceptance-v0.0.1-win-x64`
- EXE bytes: `234863734`
- SHA-256: `1e1d4ea51d2309bff42068d703e0849748cf0a1bc6f0ebb59c26be22dc1ee0c7`

Windows CI 已通过：

- Python worker build。
- .NET 8 self-contained single-file publish。
- 主 EXE 仅单文件交付检查。
- embedded worker extraction。
- worker self-test。
- SHA-256 generation。
- artifact upload。

该候选仍属于 `p106-exp` 实验版本，不代表正式 stable/main Release。

## MediaIndex v0.1.0 Product Preview

P106 已开始构建正式主程序：

```text
MediaIndex-v0.1.0-win-x64.exe
```

状态仍为：

```text
p106-exp preview
not stable
not main
no GitHub Release tag
```

该 Preview 只有在 P106 Windows CI 同时通过 acceptance regression、known hard-negative、persistent core、incremental reuse、exact lookup、single-EXE self-test 后才允许作为 downloadable artifact 提供给用户。

## 2026-09-16｜MediaIndex v0.1.0 Product Preview CI 通过

Windows CI 已完整通过：

```text
Run: 35071827474
Commit: 3084e8605cbb489b99db1624d23af3b1bf340cdc
Artifact: MediaIndex-v0.1.0-win-x64
Artifact ID: 10435739179
EXE bytes: 235793460
EXE SHA-256: bb6ddb309ad329dba009964ed4989cc33e7cfef9d3094ef6d2b9d435e79768ae
```

通过项：

- A4/V011 automated regression
- known hard-negative gate
- persistent core smoke
- incremental rebuild reuse
- exact byte-identical lookup
- algorithm worker build
- Acceptance single EXE publish + self-test
- MediaIndex main single EXE publish + embedded-worker self-test
- artifact upload
- SHA-256 generation

known hard-negative suite 当前 4/4 均未被误提升为 Confirmed。

该版本仍属于 `p106-exp` Product Preview，不等同于 stable/main 正式 Release。

## 2026-09-16｜MediaIndex v0.2.0 Product Preview CI 通过

Windows CI 已完整通过：

```text
Run: 35099480358
Commit: 6e7ddadb5bf9695244556b6868bc20459d0eb52c
Artifact: MediaIndex-v0.2.0-win-x64
Artifact ID: 10447951988
Main EXE bytes: 235809844
Main EXE SHA-256: 9af2c3ca43344427c8e751ae1e0a49895ae50c50cdeeb4d40dfbf20ea121f64e
```

本轮新增并通过：

- persistent local-feature Lane B
- Lane A / Lane B candidate fusion
- adaptive deep verification
- conservative Probable geometry layer
- relative-scale-preserving template fallback
- 12/12 correlated small-crop stress end-to-end Top1
- 2 个 pHash Top20 漏检由 Lane B rescue
- hard-negative gate 继续保持 0 false Confirmed
- hard-negative gate 继续保持 0 false Probable geometry
- main EXE embedded-worker self-test

该版本仍属于 `p106-exp` Product Preview，不等同于 stable/main 正式 Release。

## 2026-09-16｜MediaIndex v0.3.0 Product Preview CI 通过

Windows CI 已完整通过：

```text
Run: 35104960886
Commit: 19d4f410310d11645507a1ae9bb9fc9f23054134
Artifact: MediaIndex-v0.3.0-win-x64
Artifact ID: 10449394604
Main EXE bytes: 235818036
Main EXE SHA-256: 66342c481f6a916cbab95e7ddf4df39a4d2aaeec9d728399f11f8a68ba48c723
```

本轮新增并通过：

- persistent Lane B immutable base + delta overlay
- override/delete mask
- changed/new/deleted real delta lifecycle regression
- no-change delta reuse
- provisional 5% compaction threshold
- 10k / 100k / 500k structural scale guard
- Windows mmap lifetime / handle cleanup
- A4/V011 regression
- known hard-negative gate
- persistent Lane B crop stress
- main EXE embedded-worker self-test

该版本仍属于 `p106-exp` Product Preview，不等同于 stable/main 正式 Release。
