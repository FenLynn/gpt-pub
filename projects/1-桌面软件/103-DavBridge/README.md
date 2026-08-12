# P103｜DavBridge

DavBridge 是面向 Windows 11 的低速、单线程、强校验 WebDAV 迁移工具，首要场景是将 Zotero WebDAV 附件库从 InfiniCLOUD 长期、分周期迁移到坚果云，并在最终交割前保持源端只读和目标端可验证。

## 当前入口

- 新对话固定接续入口：[HANDOFF.md](HANDOFF.md)
- 项目长期硬规则：[开发约束.md](开发约束.md)
- 当前开发目标与实时进度：[工作记录.md](工作记录.md)
- 当前正式或候选基线：[阶段记录.md](阶段记录.md)
- 重大架构取舍：[设计与演进.md](设计与演进.md)

新对话必须先读取 `HANDOFF.md`，再按其中固定流程读取 A｜`/GPT_RULES.md` → `/目录.md` → B｜`../开发约束.md` → C｜本项目 `开发约束.md`、README、阶段记录和工作记录，并核对 `main`、`p103-stable`、`p103-exp`、PR、CI、Artifact、标签与 Release 的真实状态。

## 产品边界

首阶段只实现：

```text
InfiniCLOUD /zotero
        ↓
     DavBridge
        ↓
坚果云 /zotero
```

- 单向迁移，不做双向同步；
- InfiniCLOUD 在产品代码中保持只读；
- 同名 `.zip` 与 `.prop` 作为一个 Zotero 逻辑组串行处理；
- 目标端只有经过重新读取和 SHA-256 校验后才记为强校验完成；
- 迁移开始前已经由 GoodSync 或其他客户端放入坚果云的既有文件不会被直接覆盖，内容与当前 InfiniCLOUD 源文件完全一致时可强校验后直接接管，不重复消耗上传额度；
- 既有目标内容与源端不同且无法证明是 DavBridge 自己先前写入的旧版本时进入冲突并停止，不自动覆盖；
- 每个坚果云流量周期默认预留 50 MB 给其他服务；
- 上传 1 GB 与下载 3 GB 都进入本地保守配额保护，既有文件接管时的目标 GET 校验计入下载账本；
- 流量重置日期使用坚果云账户实际日期，不按自然月推断；
- 支持登录后自动启动、托盘静默运行、断网等待、周期重置后自动继续；
- 周期末 24 小时可进入冲刺模式，在保留少量安全余量的前提下继续利用剩余额度；
- 迁移期间 Zotero 继续只使用 InfiniCLOUD，最终验收通过后再切换 WebDAV 服务。

## 工程入口

```text
代码/
├── DavBridge.Core/   # WebDAV、状态、配额、迁移核心
├── DavBridge/        # WinForms 托盘程序
└── DavBridge.Smoke/  # 核心回归和故障边界 smoke
```

活动 CI 固定为 `.github/workflows/p103-davbridge-ci.yml`。

## 分支与发布

```text
最新 main
→ p103-exp
→ p103-stable
→ main
→ p103-vX.Y.Z 与 Release
→ main 回流 p103-stable / p103-exp
```

- 日常开发：`p103-exp`
- 稳定候选：`p103-stable`
- 正式主线：`main`
- 正式路径：`projects/1-桌面软件/103-DavBridge/`

正式 Release 只从 `main` 建立，Runtime 和 Artifact 不得包含真实 WebDAV 凭据、真实 Zotero 清单、日志或用户私人数据。
