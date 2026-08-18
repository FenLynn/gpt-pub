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
- 活动 CI：`.github/workflows/p105-localsub-ci.yml`

旧 `p103-localsub-ci-bootstrap`、`p103-localsub-exp`、`103-LocalSub` 与 PR #385/#387 只用于追溯 2026-08 的编号错误及 Phase 1A 来源，不再作为后续维护入口。P103 永久属于 DavBridge。

## 2. 新对话强制读取顺序

每次接续 LocalSub，先只读恢复，不凭聊天记忆直接写：

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. `projects/1-桌面软件/105-LocalSub/开发约束.md`
5. `projects/1-桌面软件/105-LocalSub/README.md`
6. `projects/1-桌面软件/105-LocalSub/阶段记录.md`
7. `projects/1-桌面软件/105-LocalSub/工作记录.md`
8. 与当前任务相关的 `设计与演进.md`、`docs/` 和源码
9. `main / p105-stable / p105-exp` 的真实关系
10. P105 当前 open PR、最近 exact-head CI、Artifact，以及存在时的 tag/Release

第一轮回复必须先说明当前正式基线、稳定候选、开发 head、待验证事项和准确断点。用户只说“接续/恢复”时，不自动修改代码。

## 3. 写入前固定核对

任何写操作前必须明确：

- 当前任务只允许修改 `105-LocalSub/**`、`p105-localsub-ci.yml` 和本项目必要的共享状态行。
- `103-DavBridge/**`、P104 和其他项目保持不动。
- 开发从最新 `main` 同步到 `p105-exp`，不把其他长期项目分支直接合入 P105。
- 不直接写 `main` 或 `p105-stable` 做日常开发。
- PR 只允许 `p105-exp → p105-stable`、`p105-stable → main`。
- 合并依据必须是当前 head 成功 CI，不复用过期 run。

## 4. 当前架构断点

Phase 1A 已建立：

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

后台媒体分析和完整后台转写实现已经从 Shell 编译边界排除，Shell 仅保留 Proxy。**禁止重新引入进程内静默 fallback。**

v0.1.1-dev 在 Shell client 中增加 connection generation。每个 pending request 绑定自己的 generation；旧 reader loop 退出只能失败旧 generation 的请求，不能影响重连后的新请求。当前 generation 断开后下一请求重新启动 Core。用户取消若 1.5 秒不收敛则回收 worker。Shell 正常退出优先主动 shutdown Core，parent watcher 保留为异常退出兜底。

## 5. 当前验证事实

Phase 1A 首次正式准入已经完成 Shell/Core 双 publish、绿色目录、Core Named Pipe `ping/shutdown`、Shell 启动、后台工作区、Process Loopback、sherpa native runtime 加载、native offline ASR 真解码与最终打包。

P105 v0.1.1-dev 当前功能代码提交：`0ff1cd4dc308ce684e882a3e0c7724304da1ecb4`。本版新增 Windows fault injection：Shell client 建立一个仍在 pending 的延迟 ping 后真实结束第一 Core，必须让当前请求失败，并由同一 client 拉起第二 Core，再次 ping 成功。当前 exact-head CI、Artifact 和 digest 以本轮 Draft PR 的 GitHub 实时状态为准。

## 6. 当前实机待验证

Phase 1A 最重要的用户实机验收仍是“进程边界是否真正保护 GUI”，不是识别准确率：

1. 后台解析或 SenseVoice 转写时拖动窗口、最大化/恢复、切换页面、滚动。
2. 任务管理器观察主要 CPU/内存负载应进入 `LocalSub.Core.exe`。
3. 后台转写时手动结束 `LocalSub.Core.exe`，`LocalSub.exe` 不应退出。
4. 当前任务应失败，再发起后台任务时应重新拉起新的 Core。
5. 关闭 LocalSub 后 Core 不长期残留。
6. 异常时优先查看 `Logs/core.log`、`Logs/core-client.log`、`Logs/responsiveness.log`。

自动 fault injection 能证明 supervisor/IPC 的恢复状态机，但不能证明用户真实媒体、模型和机器负载下的 WinForms 消息循环体验。用户尚未确认上述完整实机验收前，状态保持“待验证”。

## 7. 下一开发顺序

不要回去继续堆 WinForms 小修补。架构顺序固定为：

1. 完成 v0.1.1-dev exact-head Windows CI，并交给用户完成 Phase 1A 实机响应性与 Core 崩溃边界验收。
2. Phase 1B 分批迁移实时 Zipformer/Paraformer/SenseVoice、WASAPI、PotPlayer Process Loopback、模型下载/解压/删除等重任务到 Core。
3. 每迁一类能力就保持“Core 失败不拖死 GUI”的故障边界，并增加对应 CI/实机验证。
4. Core API 稳定后才进入 WebView2 + Vue 3 + TypeScript 主界面。
5. 最后再收口旧 WinForms 业务页。

## 8. 运行与分发硬约束

- Windows x64。
- `.NET 8` framework-dependent single-file。
- `LocalSub.exe` 与 `LocalSub.Core.exe` 同目录。
- 模型位于 `ASR/`，sherpa runtime 位于 `ASR/_runtime/`。
- 模型、ONNX Runtime、sherpa native runtime、FFmpeg 不进入基础包。
- PotPlayer 模式禁止静默回退成全系统音频。
- FFmpeg 优先复用 Mediova、手动路径或 PATH。
- 增量覆盖包发生 Core 架构变化时至少同时交付两个 EXE。

## 9. 每轮结束交接标准

结束一轮前至少核对并更新：

- `工作记录.md`：正在做什么、状态、下一步、待用户实机事项。
- `阶段记录.md`：本轮形成的候选/正式基线、PR、exact-head CI 和 Artifact 证据。
- `设计与演进.md`：只有架构决策发生变化时才更新。
- 本 HANDOFF：只有恢复流程、关键断点或长期执行顺序发生变化时才更新。

不得把同一事实复制到多个文件并各自维护不同版本。

## 10. 下一对话恢复模板

恢复后优先汇报：

```text
P105 LocalSub
main: <sha / 当前正式状态>
p105-stable: <sha / ahead-behind>
p105-exp: <sha / ahead-behind>
open PR: <编号与方向>
latest exact-head CI: <run / result>
current phase: <Phase 1A / 1B / 2>
real-machine pending: <待验证事项>
next action: <唯一明确断点>
```

确认事实后再按用户本轮指令决定是否写入。
