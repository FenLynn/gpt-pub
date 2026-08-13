# DavBridge 对话接续入口

本文件用于在更换 ChatGPT 对话后恢复 P103 DavBridge 项目上下文。

- 仓库：`FenLynn/gpt-pub`
- 项目编号：`P103`
- 项目路径：`projects/1-桌面软件/103-DavBridge/`
- 日常开发分支：`p103-exp`
- 稳定基线分支：`p103-stable`
- 正式主线：`main`
- 正式稳定回滚基线：**v0.1.7**
- 当前实验候选：**v0.2.9**
- v0.2.9 已 CI 验证的准确代码 head：`5cb486922caa5ce6e7326d056dce533def3a2ac5`
- 当前阶段：现有 Zotero 单向迁移的 UI 收口 + 低流量安全事务硬化

`main` / `p103-stable` 的 v0.1.7 是已获真实 InfiniCLOUD / 坚果云验证的回滚基线。v0.2.9 未经用户实机验证不得提升 stable/main。

## 固定读取顺序

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. 本项目 `开发约束.md`
5. 本项目 `README.md`
6. 本项目 `阶段记录.md`
7. 本项目 `工作记录.md`
8. 涉及架构 / 任务边界时读取 `通用任务架构.md`
9. 涉及升级、本地 Data、回滚时读取 `数据兼容与升级.md`
10. 与重大历史取舍有关时读取 `设计与演进.md`
11. 涉及代码时读取 `代码/README.md`，以 `代码/DavBridge.sln` 为统一源码入口

随后必须核对 `main`、`p103-stable`、`p103-exp` 的最新提交和关系，以及 P103 最近 CI、Artifact、PR、标签和 Release。

## 分支事实源

- `main`：正式稳定事实源，当前基线 v0.1.7；
- `p103-stable`：稳定候选 / 已固化基线；
- `p103-exp`：当前 v0.2.x 日常开发事实源；
- v0.2.9 候选代码 head 为 `5cb486922caa5ce6e7326d056dce533def3a2ac5`；
- 该候选 P103 CI run `31697751826` 已通过 Core Smoke、新事务 Smoke、Windows build、Runtime boundary、隔离自检和 Artifact；
- 候选之后若仅有 `[skip ci]` 文档提交，不得把文档 head 当作已构建代码 head。

## 产品边界

DavBridge 定位为：

> 可靠、低速、可恢复、强校验的单向迁移、备份和镜像工具。

当前用户层只收口现有 Zotero 固定任务，近期不开放普通 WebDAV 新任务。

明确不做：

- 双向同步；
- 删除传播；
- 双向冲突合并；
- rename detection；
- WebDAV LOCK；
- Client-side encrypted backup；
- HTTP/2 / HTTP/3 性能追逐；
- 高流量 Integrity Scrub；
- 定期全量目标 GET + SHA-256。

若后续做完整性巡检，只允许默认采用低流量 Metadata Probe：对象存在性、size、ETag、LastModified。只有元数据异常时才进入已有安全处理流程。

## v0.1.7 Data 兼容硬规则

当前核心用户 Data：

- `%APPDATA%/DavBridge/config.json`
- `%APPDATA%/DavBridge/state.json`
- `%APPDATA%/DavBridge/state.json.bak`
- `%APPDATA%/DavBridge/secrets.dat`

v0.2.9 不迁移这些文件，`MigrationState.SchemaVersion` 仍为 1。密码继续使用 Windows DPAPI CurrentUser。

`TransferStatus.WriteUnknown` 只追加在现有枚举末尾，不改变既有状态值编号，从而保持旧 `state.json` 数字枚举兼容。

未来真正引入新的持久化格式前，必须先完成备份、迁移、等价性校验和回滚路径；若内建转换不能足够安全，必须同时提供独立一次性转换工具或脚本，不得要求用户手工编辑 JSON。

## v0.2.9 UI 断点

当前候选新增 `UiVisualPolishV029`，不再沿用 v0.2.8 会与原控件 `OnPaint` 发生绘制顺序竞争的 Paint overlay。

当前目标：

- 顶部 InfiniCLOUD、状态箭头、坚果云由最终子绘制层独占，避免重复叠字；
- 箭头为连续矢量路径，状态文字位于箭头内部，颜色跟随状态；
- 总体 / 当前文件采用浅蓝渐变；
- 上传 / 下载配额条按低、中、高风险使用更明显的绿、黄、红渐变，右侧保留灰色安全预留；
- 左侧栏进一步提亮；
- 阶段轨道仍为 `预核验 | 拉取 | 核验 | 上传 | 回读`；
- 安全与维护页改为纵向检查清单；
- 首组验证和既有副本验证已通过时使用绿色 `✓ 已通过`；
- 已通过工具不再用大按钮抢视觉。

## v0.2.9 低流量安全事务

已实现并有新增 Smoke 覆盖：

1. **HTTPS-only WebDAV**：明文 HTTP 在发送凭据前拒绝；
2. **禁止自动重定向**：避免跨 host / 降级重定向中的凭据边界不明确；
3. **条件 PUT**：新对象使用 `If-None-Match: *`，可信旧目标可使用 `If-Match: ETag`；
4. **WriteUnknown + Reconcile**：PUT 响应丢失时先查目标事实，不立即第二次上传；
5. **412 reconciliation**：目标竞争创建导致前置条件失败时不盲目覆盖；
6. **完成前源 Manifest 二次快照**：避免迁移过程中新增附件却 false Complete；
7. **错误分类基础**：401、403、412、429、5xx 等进入更明确的 WaitNetwork / WaitRetry 语义；
8. **Capability Probe 基础接口**：协议层已有 OPTIONS / DAV / Allow 探测，但暂未塞进日常运行循环。

WriteUnknown reconciliation 的行为：

```text
PUT 连接 / 响应异常
→ WriteUnknown
→ PROPFIND 目标
→ 目标不存在：回到 SourceReady，后续安全重试
→ 目标存在但长度异常：Conflict
→ 目标存在且长度合理：在下载预算允许时 GET + SHA-256
→ 与源相同：StrongVerified
→ 与源不同：Conflict
```

## 当前自动验证

v0.2.9 准确代码 head `5cb4869...`：

- 原有 Core Smoke：通过；
- 条件 create-only PUT：通过；
- PUT 已被服务器接收但响应丢失，只 reconcile、不二次上传：通过；
- 条件竞争 412 安全 reconciliation：通过；
- 完成前第二次源 Manifest 能阻止 false Complete：通过；
- HTTP 明文端点拒绝：通过；
- Windows framework-dependent single EXE：通过；
- Runtime boundary：通过；
- 隔离 Windows self-test：通过。

## 下一准确断点

```text
不要提升 stable/main
→ 用户先实机运行 v0.2.9 候选
→ 检查主页顶部不再出现 InfiniCLOUD / 坚果云 / 箭头重复叠字
→ 检查安全与维护页为纵向列表，已通过项显示绿色 ✓
→ 连接诊断确认 HTTPS-only + 禁止自动重定向不影响真实 InfiniCLOUD / 坚果云
→ 短时继续迁移，观察条件 PUT 与新 reconciliation 是否存在服务商兼容问题
→ 暂停 / 退出 / 重开确认原 Data 与断点继续正常
→ 实机通过后再考虑 exp → stable
```

下一低风险内核硬化候选，不阻塞 v0.2.9 实机验证：

- capability probe 接入连接诊断并缓存，只在首次连接 / 诊断 / 异常后使用；
- WaitNetwork / WaitRetry 自适应退避 + jitter；
- Config / State / Compat 统一 `AtomicFileStore`；
- 低流量 Metadata Probe，仅元数据异常时升级处理。

## 事实源

```text
实现事实 → 源码
验证事实 → 测试与 CI
正式稳定事实 → main / p103-stable
当前实验事实 → p103-exp
本地 Data 兼容 → 数据兼容与升级.md
当前断点 → 本 HANDOFF + 工作记录.md
真实服务行为 → 用户账户实测与明确记录
```

不得把坚果云未公开的额度耗尽响应、750 项后分页协议细节或其他推测写成已验证能力。

## 接续后的首次回复

先说明：

- 当前正式稳定基线；
- 当前实验候选及准确已验证代码 SHA；
- `main / p103-stable / p103-exp` 的真实关系；
- 最近完成事项；
- 尚待实机验证事项；
- 本地 Data 是否发生格式变化；
- 准确继续断点；
- 本次是否进行了任何写入。

用户只要求接续或确认状态时，不得修改代码、文档、分支、PR、CI、标签或 Release。

## 写入规则

用户明确要求继续修改后：

1. 修改范围限于 P103 项目目录、P103 CI 和确有必要的 P103 状态入口；
2. 日常开发只进入 `p103-exp`；
3. 不直接在 `main` 或 `p103-stable` 开发功能；
4. 修改已有文件前读取目标分支最新文件与 SHA；
5. 不夹带 P101、P102 或其他项目修改；
6. 不为 UI / 抽象重构降低 v0.1.7 数据安全语义；
7. 提升流程固定为 `exp → stable → main`。
