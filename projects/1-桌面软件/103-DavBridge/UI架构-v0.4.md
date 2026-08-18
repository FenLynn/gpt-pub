# DavBridge v0.4 UI 架构

## 决策

DavBridge 从 v0.4 起采用：

```text
Vue 3 + TypeScript + Vite
        ↓ typed JSON bridge
Microsoft WebView2
        ↓
极薄 Windows 原生宿主（C# / .NET 8 / WinForms）
        ↓
现有 DavBridge.Core 与既有 C# 安全链
```

这次迁移的目的只有一个：替换显示与交互层，避免继续用 WinForms 控件布局承担现代 UI 工作。

## 冻结边界

以下已经验证的逻辑不属于 UI，v0.4 架构迁移不得重写、复制到 JavaScript 或改变语义：

- InfiniCLOUD authoritative source 与源端只读；
- Zotero `.zip + .prop` Group；
- StrongVerified 双端 GET + SHA-256；
- 历史 GoodSync 副本强校验接管；
- SourceChanged 与优先修复；
- WriteUnknown reconciliation；
- HTTP 412 协调；
- quota、Cycle、09:00 真实重置探测；
- 每周期源端对账；
- 回收站跨周期观察；
- 人工 DELETE 门及删除前再次核验；
- DPAPI、config/state/reconcile 持久化；
- WebDAV 客户端及真实 PUT / GET / DELETE。

## Web UI 权限

Vue 只能：

1. 接收 C# 提供的安全 DTO；
2. 显示状态、进度、额度、回收站清单和文档；
3. 发送固定白名单命令。

当前命令白名单只有：

```text
app.getSnapshot
app.openSettings
migration.pause
migration.resume
recycle.defer
recycle.delete
```

Vue 不得直接读取：

- `secrets.dat`；
- DPAPI 内容；
- WebDAV 密码；
- `state.json` / `reconcile.json` 原文件；
- 本地私人日志。

Vue 不得直接执行 WebDAV PUT、DELETE 或修改源端。

## DELETE 双门

Web UI 的删除按钮只表示“请求进入删除审查”。真正删除仍由既有 C# 安全链执行。

流程为：

```text
Web UI 选择对象
→ 前端意图确认
→ C# 原生最终确认
→ ReconciliationRemovalV030
→ 再次检查 InfiniCLOUD
→ 再次检查 Zotero Group
→ 再次检查坚果云历史身份
→ 满足全部条件后才允许 DELETE
```

## 原生宿主职责

WinForms 不再承担业务页面布局，只保留 Windows 原生能力：

- 主窗口；
- 托盘；
- 单实例；
- Windows 登录自启动；
- WebView2 生命周期；
- 原生设置对话框；
- 最终危险操作确认；
- 已有后台运行入口。

## WebView2 安全约束

- UI 只映射到本地虚拟主机 `https://davbridge.local`；
- 禁止导航到其他地址；
- 禁止新窗口；
- 默认拒绝 Web 权限；
- DevTools 正式候选关闭；
- 默认上下文菜单关闭；
- 前端静态资源编译后嵌入 DavBridge.exe；
- WebView2 用户数据存于 `%LOCALAPPDATA%/DavBridge/WebView2`。

## 构建

前端：

```text
WebUi/
npm install
npm run build
```

生成 `WebUi/dist` 后由 `DavBridge.csproj` 作为 EmbeddedResource 嵌入程序集。

Windows 交付仍保持 framework-dependent 单 EXE。WebView2 Runtime 使用系统 Evergreen Runtime，不把完整浏览器捆进 DavBridge。

## 回滚

v0.3 WinForms UI 文件目前仍保留在源码中作为实验阶段回滚参照，但 v0.4 正常运行路径不再挂载旧 UI shell。

`main` 与 `p103-stable` 仍是 v0.1.7，只有用户完成真实 Windows 验收后才考虑提升。
