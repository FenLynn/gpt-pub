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

这次迁移的目的只有一个：替换显示与交互层，避免继续用 WinForms 控件布局承担现代业务 UI 工作。

WinForms 仍作为 Windows 原生宿主技术存在，但不再负责总览、转移、回收站和文档等业务页面布局。

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
app.closeSettings
migration.pause
migration.resume
migration.retry
quota.calibrate
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

Web UI 的删除按钮只表示请求进入删除审查。真正删除仍由既有 C# 安全链执行。

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

## v0.4.10 当前界面结构

当前候选采用固定左侧导航：

```text
总览
转移
回收站
文档

设置
关于
运行状态
```

总览主页面保持固定左侧导航，配置异常时再显示必要入口；正常状态不重复占用顶部空间。

总览主体结构：

```text
迁移路径
→ 三阶段状态
→ StrongVerified 覆盖率
→ 上传 / 下载流量预算
→ 当前任务
```

v0.4.9 同时规定：

```text
转移页 → 三条轻量队列行 + 当前动作 + 总体覆盖
文档页 → 单列正文
左下角状态 → SVG 图标 + 主状态 + 非重复副状态
悬浮提示 → Teleport 到 body 的全局最高层
```

UI 文字策略：

- 主页面只保留决策所需信息；
- StrongVerified、Cycle、阶段状态、端点角色等定义进入 tooltip；
- 人工操作仍必须明显；
- tooltip 不能替代危险操作确认；
- 任何布局精修不得改变 bridge 权限或 C# 安全链。

## 构建

前端：

```text
WebUi/
npm install
npm run build
```

生成 `WebUi/dist` 后由 `DavBridge.csproj` 作为 EmbeddedResource 嵌入程序集。

Windows 交付保持 framework-dependent single EXE。WebView2 Runtime 使用系统 Evergreen Runtime，不把完整浏览器捆入 DavBridge。

## 验证规则

每个 UI 候选至少检查：

- Core Smoke；
- main 到候选的 Core / Reconciliation / WebDAV / Data 差异；
- Vue typecheck 与 production build；
- production bundle；
- 浏览器视觉预览；
- Windows single EXE publish；
- Runtime 私人数据边界；
- native-host self-test；
- 用户真实 Windows 最终视觉验收。

自动截图只能提前发现明显布局错误，不能代替实机视觉事实。

## 回滚与历史 UI

v0.3 WinForms 业务 UI 源码目前仍保留作为历史回滚和实现参照，但 v0.4 正常运行路径不再挂载旧业务 UI shell。

不得因为旧源码仍存在，就在新开发中继续叠加 WinForms 业务控件。

当前正式回滚基线是 v0.4.0，不再把历史 v0.1.7 或 v0.3.x 描述为当前正式版本。

## 当前阶段

v0.4.10 位于 `p103-exp`，最后完成完整 CI 的代码 head 为 `9bd983c248b30c6908ccb89786766f4f6321fe1f`，对应 run `34700404112`。它尚未提升到 `p103-stable` 或 `main`。

下一关是用户 Windows 实机验收，重点检查路线与阶段间距、转移页、全局 tooltip、设置账户字段可编辑性和左下角状态 SVG。