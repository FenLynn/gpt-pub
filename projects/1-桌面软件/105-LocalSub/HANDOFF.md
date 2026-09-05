# P105｜LocalSub HANDOFF

> 本文件是跨对话恢复入口，不替代源码、CI、Git、A/B/C 规则与阶段记录。

## 1. 固定身份

- 项目：LocalSub
- GPT-Pub 编号：`P105`
- 正式路径：`projects/1-桌面软件/105-LocalSub/`
- 日常开发：`p105-exp`
- 稳定候选：`p105-stable`
- 正式主线：`main`
- 固定流转：`main → p105-exp → p105-stable → main`
- P105 长期项目分支只允许 `p105-exp` 与 `p105-stable`。
- 活动 CI 与正式发布门禁：`.github/workflows/p105-localsub-ci.yml`
- 显式发布标记：`RELEASE.md`

旧 `p103-localsub-*`、`103-LocalSub` 与 PR #385/#387/#395 只用于追溯编号错误和 Phase 1A 开发历史，不再作为维护入口。P103 永久属于 DavBridge。

## 2. 新对话强制读取顺序

每次接续 LocalSub，先只读恢复：

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. `projects/1-桌面软件/105-LocalSub/开发约束.md`
5. `projects/1-桌面软件/105-LocalSub/README.md`
6. `projects/1-桌面软件/105-LocalSub/阶段记录.md`
7. `projects/1-桌面软件/105-LocalSub/工作记录.md`
8. `projects/1-桌面软件/105-LocalSub/RELEASE.md`
9. 与当前任务相关的 `设计与演进.md`、`docs/` 和源码
10. `main / p105-stable / p105-exp` 的真实关系
11. P105 当前 open PR、当前 exact-head CI、tag 与 Release

不得只凭聊天记忆继续工作。

## 3. 写入规则

- 日常代码和状态修改只在 `p105-exp`。
- 不建立普通版本专用 P105 分支。
- `p105-stable` 只接收 `p105-exp` 的正式提升 PR。
- `main` 只接收 `p105-stable` 的正式准入 PR。
- 禁止修改 P103 DavBridge、P104 或其他项目。
- 所有提升都只认当前准确 head 的成功 CI。
- 发布完成后 `p105-exp / p105-stable` 必须非强制快进到最新发布 main。

## 4. 当前架构

```text
LocalSub.exe
├─ WinForms 主界面
├─ 托盘
├─ Overlay
├─ 实时 PotPlayer 链，暂时保留
└─ Named Pipe IPC
        ↓
LocalSub.Core.exe
├─ 媒体解析
├─ Media Foundation / FFmpeg
├─ 波形数据生成
├─ Silero VAD
└─ SenseVoice / Offline Zipformer / FireRedASR2 / Fun-ASR-Nano 后台转写
```

IPC v1：Windows Named Pipe + UTF-8 newline-delimited JSON，方法为 `ping / analyze / transcribe / cancel / shutdown`。

已迁入 Core 的后台媒体分析和转写不得重新引入 GUI 进程内静默 fallback。

v0.1.1 已加入 connection generation、Core 断开显式失效、下一请求自动重启 Core、cancel 超时回收和 Shell 主动 shutdown Core。

## 5. v0.1.1 验证历史

最终开发候选：

- 历史 Draft PR #395，现已关闭且未合并
- exact head `b9e7cbaf792cc925bc0d40918ab73ac00e242869`
- Windows CI run `32129200379`，`success`
- Artifact `9321563463`
- Artifact digest `sha256:5531d0ea9202ab06a0b521e61aa5d796904804f903f873dd92dcbdf7865c5e66`

该 run 已验证 Core IPC、真实强杀第一 Core 与 generation 2 重连、Shell 启动、后台工作区、Process Loopback、sherpa native runtime、native offline ASR 和打包边界。

该历史 run 不能代替当前正式发布 head 的验证。

## 6. 2026-09-05 分支收口事实

本轮发布准备开始前：

- 最新 main 为 `19e91cb22682ddcbe943199693dc510d9de73b0a`。
- main 已包含 v0.1.1 最新 LocalSub 源码。
- `p105-exp` 与 `p105-stable` 均已通过非强制 fast-forward 同步到该 main。
- `p103-localsub-*` 搜索结果为 0。
- P105 分支搜索结果只包含 `p105-exp` 与 `p105-stable`。
- #395 已关闭且未合并。

随后才在 `p105-exp` 开始正式发布准备。

## 7. 当前发布断点

用户已明确要求把当前稳定 LocalSub 固化并正式发布。

当前目标：

- Version：`0.1.1`
- Tag：`p105-v0.1.1`
- Release：`LocalSub v0.1.1`
- 发布标记：`RELEASE.md`

固定顺序：

1. `p105-exp → p105-stable`，当前 exact head 完整 P105 CI。
2. `p105-stable → main`，当前 exact head 再完整 P105 CI。
3. main 合并提交修改了 `RELEASE.md` 后，P105 workflow 在该准确 main SHA 再构建并运行完整 Windows 门禁。
4. exact-main build 成功后创建正式 tag 和 Release assets。
5. workflow 非强制快进 `p105-exp / p105-stable` 到发布 main，并验证只剩这两条 P105 项目分支。

Release assets：

- `LocalSub-v0.1.1-win-x64-net8.zip`
- `LocalSub-v0.1.1-incremental-two-exe.zip`
- `LocalSub-v0.1.1-SHA256.txt`

## 8. 实机待验证

用户特定媒体、模型与机器条件下的高负载 GUI 响应性仍待真实机器确认。自动 fault injection 只证明 supervisor/IPC 恢复状态机。

正式 v0.1.1 Release Notes 必须明确这一点，不得声称该实机项已完成。

## 9. 后续开发

正式 v0.1.1 收口后，下一功能开发从最新 `p105-exp` 开始。架构顺序保持：

1. Phase 1B 分批迁移实时 Zipformer/Paraformer/SenseVoice、WASAPI、PotPlayer Process Loopback 与模型重任务到 Core。
2. 每类迁移继续维持 Core 失败不拖死 GUI 的边界。
3. Core API 稳定后再进入 WebView2 + Vue 3 + TypeScript 主界面。
4. 最后收口旧 WinForms 业务页。

## 10. 恢复模板

```text
P105 LocalSub
main: <sha>
p105-stable: <sha / ahead-behind>
p105-exp: <sha / ahead-behind>
open PR: <编号与方向>
latest exact-head CI: <run / result>
release tag: <存在/不存在>
release: <存在/不存在>
real-machine pending: <待验证事项>
next action: <唯一明确断点>
```
