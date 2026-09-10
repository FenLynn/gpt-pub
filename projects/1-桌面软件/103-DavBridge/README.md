# P103｜DavBridge

## 新聊天接续

> 请接续 DavBridge 软件研发，请先完整阅读并严格按照 `https://github.com/FenLynn/gpt-pub/blob/p103-exp/projects/1-桌面软件/103-DavBridge/HANDOFF.md` 恢复项目上下文，重新核对仓库当前真实状态并先向我汇报准确断点，本轮不要立即推进或修改任何内容。

DavBridge 是面向 Windows 的可靠、低速、可恢复、强校验的单向数据迁移、备份和镜像任务管理器。当前任务聚焦 Zotero 附件从 InfiniCLOUD 到坚果云的长期迁移与持续镜像维护。

README 只保存长期稳定的项目入口和产品边界。版本、候选状态、准确 SHA、CI、Artifact、分支关系、当前断点和待验证事项等会持续变化的信息，统一只在 [HANDOFF.md](HANDOFF.md) 中维护，新对话必须重新核对仓库事实后再继续。

## 产品边界

- 唯一正式迁移方向为 `InfiniCLOUD → 坚果云`。
- InfiniCLOUD 是 authoritative source，正式产品对源端只读。
- 坚果云保存经过强校验的单向镜像子集。
- Zotero `.zip + .prop` 作为完整 Attachment Group 处理。
- 产品不是双向同步器，不做自动反向覆盖。
- 源端删除只通过跨周期观察、人工审查和删除前再次核验进行受控处理。
- 数据安全、可恢复性和可证明校验优先于迁移速度和功能扩张。

## 运行架构

```text
Vue 3 + TypeScript + Vite
        ↓ typed JSON bridge
Microsoft WebView2
        ↓
C# / .NET 8 极薄 Windows 宿主
        ↓
既有 DavBridge.Core 与既有 C# 安全链
```

Vue/WebView2 负责显示与交互，Windows 原生宿主负责窗口、托盘、单实例、登录自启动、WebView2 生命周期、原生设置和危险操作最终确认。核心迁移、安全和数据逻辑继续留在 C#。

## 核心安全语义

核心链路保持：

```text
InfiniCLOUD authoritative source，只读
→ Zotero .zip + .prop Group
→ 源端完整 GET + SHA-256
→ 目标缺失时安全 PUT，或既有副本 NO-WRITE 接管
→ 准确资源确认
→ 目标重新 GET
→ 双端 SHA-256 一致
→ StrongVerified
→ 状态持久化
→ quota / Cycle / 网络恢复
```

长期同时保留：

- SourceChanged 周期维护；
- 历史 GoodSync 副本强校验接管；
- WriteUnknown reconciliation；
- HTTP 412 协调；
- 每周期 InfiniCLOUD 源端对账；
- 新增对象进入普通 backlog，不提高优先级；
- 回收站跨周期观察；
- DELETE 必须人工确认并再次核验；
- DPAPI 与既有 Data 文件；
- 坚果云上传、下载额度与安全预留。

Vue 前端只接收安全 DTO 和发送固定白名单意图。WebDAV 凭据、DPAPI、原始 state/reconcile 文件和真正的 PUT/DELETE 逻辑不得进入 JavaScript。

## 文档入口

- **新对话和当前状态唯一入口**：[HANDOFF.md](HANDOFF.md)
- 项目长期硬规则：[开发约束.md](开发约束.md)
- UI 迁移补充约束：[开发约束-v0.4-补充.md](开发约束-v0.4-补充.md)
- UI 架构：[UI架构-v0.4.md](UI架构-v0.4.md)
- 当前工作记录：[工作记录.md](工作记录.md)
- 阶段演进记录：[阶段记录.md](阶段记录.md)
- 用户行为说明：[用户手册.md](用户手册.md)
- 本地 Data 升级与回滚：[数据兼容与升级.md](数据兼容与升级.md)
- 重大架构取舍：[设计与演进.md](设计与演进.md)
- 完整源码与恢复入口：[代码/README.md](代码/README.md)
- Visual Studio / dotnet 统一解决方案：[代码/DavBridge.sln](代码/DavBridge.sln)

## Data 边界

Runtime 与私人 Data 严格分离：

```text
%APPDATA%\DavBridge\config.json
%APPDATA%\DavBridge\state.json
%APPDATA%\DavBridge\state.json.bak
%APPDATA%\DavBridge\secrets.dat
%APPDATA%\DavBridge\reconcile.json
%APPDATA%\DavBridge\reconcile.json.bak
```

Release、Artifact、源码和 CI 不得包含真实 WebDAV 凭据、私人 Zotero 文件清单、用户日志或其他私人 Data。

## 工程与治理

活动 CI：

```text
.github/workflows/p103-davbridge-ci.yml
```

长期分支：

```text
main
p103-exp
p103-stable
```

分支提升、CI、正式发布和回流流程统一服从最新 `/GPT_RULES.md`、`projects/1-桌面软件/开发约束.md` 和本项目 `开发约束.md`。README 不固化某一时刻的分支 SHA、候选版本或发布状态，所有此类动态事实都进入 `HANDOFF.md`。