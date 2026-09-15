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
