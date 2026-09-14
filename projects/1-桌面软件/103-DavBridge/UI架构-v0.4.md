# DavBridge v0.4 / v0.5 UI 架构

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

以下已经验证的安全逻辑不属于 UI，v0.4 架构迁移不得复制到 JavaScript 或改变语义。v0.4.13 仅在 C# 内增加人工暂停的安全边界协调，不改变下列不变量：

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
data.openRoot
data.openLocal
data.changeRoot
data.backup
data.restore
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
- DataRoot 目录选择与资源管理器打开；
- 备份和恢复的原生文件选择；
- 数据迁移后的应用重启；
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

## v0.4.26 当前界面结构

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
当前任务 → 对象在左，真实状态和进度在中，动作在右
悬浮提示 → Teleport 到 body 的全局最高层
人工暂停 → UI 立即反馈“正在暂停”，Core 在安全 member 边界落到 Paused
```

UI 文字策略：

- 主页面只保留决策所需信息；
- StrongVerified、Cycle、阶段状态、端点角色等定义进入 tooltip；
- 人工操作仍必须明显；
- tooltip 不能替代危险操作确认；
- 任何布局精修不得改变 bridge 权限或 C# 安全链。

### v0.4.20 About 健康窗口连续性

About 页继续保持轻量单条健康状态，不增加图表或新的导航层级。C# 侧 OperationalHealth DTO 新增 observationGap 与 observationGapSeconds 聚合字段。

Vue 只根据聚合结果区分“健康账本建立中”“近 24 小时”和“近 24 小时观察不连续”。运行空窗细节不进入活动抽屉，也不新增 bridge 命令。

观察连续性只改变健康摘要的可信度文案和轻量 warning 视觉，不改变首页、迁移页、暂停控制或任何安全操作。

### v0.4.23 About 信息层级

About 继续使用单行左右布局，但不再让所有条目处于同一优先级。

“当前状态”优先显示运行、会话、周期、健康，初始化仅在未完成时显示。“最近活动”只保留异常与记录，“记录”合并最近完成和最近暂停。“软件信息”置底，只显示版本、构建和技术栈。

运行环境自检摘要进入“运行”行 tooltip，其他解释性内容继续使用 tooltip。v0.4.20 的 observation continuity 聚合字段继续使用，健康语义不变。

### v0.4.24 最终 UI 收束

v0.4.24 不重做页面，只做终审和防回归。总览、转移、回收站、文档与 About 的当前视觉结构视为 v0.4 冻结候选。

CI 固定生成九张浏览器视觉预览，包括四种总览尺寸、转移、回收站、文档，以及两种 About 尺寸。生产 UI 所有权检查要求 `Program.cs` 继续挂载 `WebUiHostV040`，同时禁止旧 `UiShellV030`、`UiShellV032` 和旧 Dashboard 回到 `Program.cs` 或 `MainForm.cs`。

旧 WinForms UI 源码继续保留为历史实现和回滚参考，不再承担生产业务页面。废弃 About selector 已从活动 CSS 删除。

### v0.4.25 surface 层级

v0.4.25 保持 v0.4.24 的页面结构和交互职责，只重新统一 surface 色阶。

普通信息区不再使用纯白或高透明度白色作为默认背景，而是使用淡蓝灰 quiet / soft / panel 层。About 继续无卡片背景，直接融入 canvas。回收站当前选中 tab、tooltip 与少量真实交互层仍可使用更亮 surface，用于表达抬升和焦点。

该调整只改变视觉层级，不改变 bridge 权限、状态语义、布局或 Core 安全链。

### v0.4.26 品牌区版本号

左上品牌区采用两级信息层次。第一行为 DavBridge 主标题，第二行为当前版本号。版本号使用更小、更淡的字体，不承担导航或状态语义。

该位置在 1100×825 和 900×620 视觉预览中均通过检查，未挤压导航和侧栏状态区。

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

v0.4.26 已完成 stable/main 两级准入，当前作为 v0.4 稳定主线基线。首次 main 准入提交为 `829def0a9776da47fd432a0831fa666993781356`，最终候选验证 head 为 `c9da993f465d1e216d30deb5f5cefd517b67b9ce`，对应 P103 CI run `34765050320` 五项全绿。

正式 GitHub Release 仍为 v0.4.0，本轮没有 tag 或 Release 授权。

v0.4 UI 结构、surface 层级、品牌区版本号、生产 UI 所有权门和旧 WinForms 隔离规则均冻结。Vue 仍只接收聚合安全 DTO，不读取匿名事件账本、runtime marker 或私人 Data，也不增加 bridge 命令。

后续只处理真实缺陷和长期运行反馈。新的功能主题必须先评估 v0.5，不在 v0.4 上继续堆叠页面与状态。


## v0.5.0 数据可发现与迁移中心

v0.5.0 不把本地文件系统权限交给 Vue。前端只能显示 C# 聚合后的 DataOverview，并发送固定白名单意图。

```text
About / 设置
→ data.openRoot / data.openLocal / data.changeRoot / data.backup / data.restore
→ WebUiHostV040 白名单
→ MainForm 原生维护动作
→ DataManagementV050
→ Windows 文件系统 / ZIP / SHA-256 / DPAPI
```

前端不能传任意文件路径给 C# 执行写入。DataRoot 的实际选择仍由原生 FolderBrowserDialog 完成，备份和恢复路径仍由原生 SaveFileDialog / OpenFileDialog 完成。

About 的 DataOverview 只公开当前本机可见的路径、用途、存在状态和备份策略，不把 `state.json`、`reconcile.json`、`secrets.dat` 内容送入 JavaScript。

持久 DataRoot 与本机 LocalRoot 明确分离：

```text
DataRoot
  config/state/reconcile/v2-compat/secrets/Backups
  可由用户安全迁移

LocalRoot
  bootstrap/product-experience/window/runtime/Temp/WebView2/WebUi
  固定在 LocalAppData
```

bootstrap 是唯一固定入口。主文件和 `.bak` 必须始终指向同一个当前 DataRoot，防止损坏恢复时静默退回旧目录。

备份和恢复均由 C# 执行 manifest 与 SHA-256 校验。恢复前必须创建当前数据安全快照。DPAPI 密文无法在当前 Windows 用户下解密时只跳过 `secrets.dat`，不得降低其他数据恢复校验。

本轮不修改 DavBridge.Core 的迁移实现。


## v0.5.1 About 与数据管理信息分层

v0.5.0 初版把完整文件与目录清单直接放进 About，实机确认信息密度过高，而且“数据目录 / 本机目录”的命名容易让用户误以为两个目录都可修改。

v0.5.1 改为两层结构。

About 只显示：

```text
持久数据
最近备份
数据管理 → 查看详情
```

独立数据管理二级页显示：

```text
持久数据目录  可修改
本机运行目录  固定
备份与恢复
关键持久数据
本机运行数据
```

本机运行目录继续固定在 LocalAppData，只允许查看和打开。只有持久 DataRoot 可以通过原生安全迁移流程修改。

CI 的浏览器视觉预览新增 `data-1100x825.png`。About 1100×825、About 900×620 和 Data 1100×825 均作为本轮视觉回归基线。
