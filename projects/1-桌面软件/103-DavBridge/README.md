# P103｜DavBridge

DavBridge 是面向 Windows 的可靠、低速、可恢复、强校验的**单向数据迁移、备份和镜像任务管理器**。

它不定位为双向同步软件。当前优先保证数据安全、低速后台运行、断点恢复、强校验和服务端配额约束，不实现双向删除传播、双向冲突合并或循环同步。

第一阶段已经用真实 InfiniCLOUD → 坚果云 Zotero 附件迁移完成核心链验证。`main` 上的 v0.1.7 是稳定回滚基线，当前 `p103-exp` 正在开发 v0.2.x 通用任务模型和任务型 UI。

## 当前入口

- 新对话固定接续入口：[HANDOFF.md](HANDOFF.md)
- 项目长期硬规则：[开发约束.md](开发约束.md)
- 当前开发目标与实时进度：[工作记录.md](工作记录.md)
- 正式与开发阶段：[阶段记录.md](阶段记录.md)
- v0.2 通用任务设计：[通用任务架构.md](通用任务架构.md)
- 本地 Data 升级与回滚：[数据兼容与升级.md](数据兼容与升级.md)
- 重大架构取舍：[设计与演进.md](设计与演进.md)
- 完整源码与恢复入口：[代码/README.md](代码/README.md)
- Visual Studio / dotnet 统一解决方案：[代码/DavBridge.sln](代码/DavBridge.sln)

新对话必须先读取 `HANDOFF.md`，再按其中固定流程核对 `main`、`p103-stable`、`p103-exp`、PR、CI、Artifact、标签与 Release 的真实状态。

## 产品模型

v0.2 将 DavBridge 拆成四层：

```text
Task
├── Source Endpoint
├── Target Endpoint
├── Transfer Policy
└── Template / Provider Profile
```

### Task

当前只允许单向：

- Migration，转移；
- Backup，备份；
- Mirror，镜像。

Mirror 仍不是双向同步，默认不传播删除，也不自动删除目标额外对象。

### Endpoint

第一批端点：

- WebDAV；
- LocalFolder，作为后续扩展入口。

协议与服务商约束分离。InfiniCLOUD、坚果云属于 Provider Profile，不等于 WebDAV 协议本身。

### Policy

通用策略包括：

- 文件或逻辑组处理；
- 强 SHA-256；
- 已有目标一致时安全接管；
- 不可信冲突禁止自动覆盖；
- 限速；
- 请求节流；
- 单文件限制；
- 上传 / 下载配额；
- 安全预留与周期策略。

### Template

Zotero 不被删除，而是成为固定模板：

```text
zotero-webdav-one-way
```

模板保留 `.zip + .prop` 同 basename 成组和 v0.1.7 已验证的安全语义。因此未来可以建立：

```text
InfiniCLOUD → 坚果云
坚果云 → 其他 WebDAV
其他 WebDAV → 坚果云
```

每一个不同源目标组合都是独立任务，历史记录不会混用。

## v0.1.7 稳定基线

第一阶段真实验证的核心链保持冻结：

```text
源端只读
→ 扫描 / 分组
→ 低速单线程
→ 目标存在性确认
→ 已有副本 GET + SHA-256 接管，或目标缺失 PUT
→ 准确资源 PROPFIND Depth:0
→ 目标重新 GET
→ SHA-256 强校验
→ 状态持久化
→ 配额 / 网络 / 周期恢复
```

目标内容不同且不能证明是 DavBridge 自己写入的可信旧版本时进入冲突，不自动覆盖。

## v0.2 Data 兼容

当前 Phase A / B **不迁移、不重写**：

```text
%APPDATA%/DavBridge/config.json
%APPDATA%/DavBridge/state.json
%APPDATA%/DavBridge/secrets.dat
```

v0.2 可以增加独立 `v2-compat.json` sidecar，仅用于兼容信息和端点安全指纹。它不包含密码、TransferRecord 或配额账本，删除后 main 固化的 v0.1.7 仍可直接读取原 Data。

未来真正引入多任务持久化前，必须先自动备份旧 Data，再执行可校验、可回滚的转换。正常升级不得要求用户手工编辑 JSON。

## v0.2 UI 方向

主窗口改为任务型布局：

```text
左侧任务列表 | 右侧当前任务详情
```

日常区域只突出：

- 当前状态；
- 源 → 目标；
- 总体强校验进度；
- 当前周期上传 / 下载；
- 当前活动或暂停断点；
- 继续 / 暂停；
- 设置。

连接诊断、就绪扫描、流量校准、首组验证、既有副本验证统一进入“初始化与诊断”区域。

一个任务完成初始化后，日常：

```text
暂停 → 继续
```

直接恢复，不再每次重复整库扫描和长期迁移确认。端点身份真正变化时才重新要求初始化，新端点组合应创建新任务。

## 工程入口

```text
代码/
├── DavBridge.sln
├── README.md
├── .gitignore
├── DavBridge.Core/
├── DavBridge/
└── DavBridge.Smoke/
```

活动 CI 固定为 `.github/workflows/p103-davbridge-ci.yml`。

## 分支与发布

```text
main 稳定基线
→ p103-exp 日常开发
→ p103-stable 稳定候选
→ main 正式准入
```

当前：

- `main`：v0.1.7 第一阶段稳定基线；
- `p103-stable`：v0.1.7 稳定基线；
- `p103-exp`：v0.2.x 通用任务化与 UI 开发；
- 正式 Release 只从 `main` 的准确提交建立。

Runtime、Artifact 和 Git 历史不得包含真实 WebDAV 凭据、私人 Zotero 清单、用户日志或其他私人 Data。
