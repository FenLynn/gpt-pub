# P105｜LocalSub Release Marker

Version: 0.1.1

## 发布授权

2026-09-05，用户明确要求将当前稳定 LocalSub 固化为正式版本，并从最新 `main` 创建正式 Release。

首次 exact-main build 已完整通过，但 Release job 因 GitHub Actions 对 skipped 上游 job 的隐式依赖语义而未执行发布步骤。该问题只影响发布 job 调度，不影响已经成功的 build 与 smoke。随后已为 release job 增加显式 `always()`。

第二次 exact-main build 同样完整通过，release job 已实际启动，但原发布标记检测使用 `git diff --name-only` 后再比较中文路径，受 Git `core.quotepath` 默认转义影响，错误判定 `RELEASE.md` 未变化。随后已改为直接对目标路径执行 `git diff --quiet ... -- "$marker"`。

第三次 exact-main build 再次完整通过，路径检测已经正确输出 `formal release requested`，但 PowerShell 将 `git diff --quiet` 用于表示“文件有变化”的预期退出码 1 保留为整个 step 的最终退出码，导致 Actions 将检测 step 判为失败。当前已对所有预期允许非零返回的发布检查显式归零，并将 Release checkout 改为完整历史，以保证后续对老分支的祖先关系安全校验可靠。本次再次更新发布标记，请求 `p105-v0.1.1` 正式发布。

## 发布边界

- 正式标签：`p105-v0.1.1`
- Release 名称：`LocalSub v0.1.1`
- 正式源码必须来自合入后的准确 `main` 提交。
- 发布前必须由 P105 Windows CI 在该 `main` 提交重新构建并通过完整自动门禁。
- 正式资产包含完整 Windows x64 基础包、双 EXE 增量包和 SHA-256 清单。
- 模型、ONNX Runtime、sherpa native runtime、FFmpeg、用户配置、日志和转写数据不得进入正式资产。
- 用户特定媒体、模型和机器条件下的高负载 GUI 响应性仍标记为实机待验证，Release 不得把自动 CI 成功表述成该实机项已经完成。

本文件只作为显式发布触发与审计标记。后续版本发布时修改 `Version`，不得复用既有正式标签。
