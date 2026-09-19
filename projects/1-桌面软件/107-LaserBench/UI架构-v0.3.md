# v0.3.0 Web UI 架构迁移

LaserBench 的生产业务界面从 v0.3.0 起调整为：

```text
Vue 3 + TypeScript + Vite
        ↓ typed JSON bridge
Microsoft WebView2
        ↓
C# / .NET 8 WinForms 极薄宿主
        ↓
LaserBench Core / Device Abstraction
        ↓
Simulator / 后续真实仪器
```

该迁移在 v0.4.x 已成为正式生产路线，不再视为实验分支。

## 冻结边界

以下继续留在 C#，不复制到 JavaScript：

- 设备通信、采集、缓存和数值计算；
- Test 冻结语义；
- `data/exp`、`data/pic`、`data/video` 路径规则；
- never-overwrite；
- 截图、录像和配置持久化；
- 未来厂商 SDK。

Vue 只负责显示、布局、Canvas 绘图和发送白名单意图。v0.4.12 继续复用同一 bridge 命令：

```text
app.getSnapshot
app.setLabel
app.setCaptureSelection
app.capture
app.screenshot
app.record
app.setConfig
app.refreshData
app.openFolder
beam.setZ
beam.setAttenuation
```

高频 Power、Spectrum、Beam、Scope 和 FFT 图统一使用 HTML Canvas，不用逐点 DOM 节点或第三方图表库。

## 生产 UI 所有权

`MainForm` 负责原生窗口、启动、录像和 WebView2 生命周期，生产主页面由 `WebUiHost + WebUi/` 挂载。

历史 WinForms `DashboardControl`、`ModuleViews`、`NavigationPages`、`UiPrimitives` 只保留用于回滚参考，不再作为生产业务 UI 入口。

当前 Web UI 已覆盖 Dashboard、四模块聚焦页、Data 和 Settings。旧 WinForms 的拖出 Floating / 拖回嵌入交互尚未恢复，属于后续 UI 能力，不得误报为当前完成项。

## WebView2 安全边界

- UI 只映射到 `https://laserbench.local`；
- 禁止跳转到其他地址；
- 禁止新窗口；
- 默认拒绝 Web 权限；
- 关闭 DevTools、默认上下文菜单、状态栏和缩放控制；
- 前端构建产物嵌入 `LaserBench.App.exe`，运行时解压到 Portable `runtime/WebUi/<version>/`；
- WebView2 用户数据位于 Portable `runtime/WebView2/`；
- 基础包使用 Microsoft Edge WebView2 Evergreen Runtime，不捆绑 Fixed Version Runtime。

## 视觉方向

v0.4.12 继续采用并收紧 Graph-first 工作台：

- Dashboard 非绘图区统一冷深蓝灰，只有真实 Plot / 图像绘图区白底。
- 图占绝对主体；模块名和关键读数保留在极窄深色标题行。Dashboard 不渲染 X/Y 轴标题文字，只保留必要刻度；刻度 gutter 属于深色壳体，白色只填实际数据矩形。
- Power / Spectrum / Scope 的低频参数进入各自模块页；Beam Z / 播放 / Attenuation 因高频操作继续常驻 Dashboard。
- Power 的 Dashboard Trace 显示选择与 Test 采集选择分离并由 C# 配置持久化。
- 关键测量值支持单实例 Big Readout：左上状态/名称、右上黑白切换与关闭、右下拖拽等比例缩放；前端只改变呈现方式，数据仍来自同一 Snapshot。
- 内部网格使用虚线，绘图区边界使用实线，Legend 保持透明图内。
