# P105｜LocalSub Release Marker

Version: 0.1.1

## 发布授权

2026-09-05，用户明确要求将当前稳定 LocalSub 固化为正式版本，并从最新 `main` 创建正式 Release。

## 发布边界

- 正式标签：`p105-v0.1.1`
- Release 名称：`LocalSub v0.1.1`
- 正式源码必须来自合入后的准确 `main` 提交。
- 发布前必须由 P105 Windows CI 在该 `main` 提交重新构建并通过完整自动门禁。
- 正式资产包含完整 Windows x64 基础包、双 EXE 增量包和 SHA-256 清单。
- 模型、ONNX Runtime、sherpa native runtime、FFmpeg、用户配置、日志和转写数据不得进入正式资产。
- 用户特定媒体、模型和机器条件下的高负载 GUI 响应性仍标记为实机待验证，Release 不得把自动 CI 成功表述成该实机项已经完成。

本文件只作为显式发布触发与审计标记。后续版本发布时修改 `Version`，不得复用既有正式标签。