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

Vue 只负责显示、布局、Canvas 绘图和发送白名单意图。v0.4.10 bridge 命令为：

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

保持浅蓝灰壳体、白色仪器绘图区、窄顶栏、窄侧栏、强数值层级、Power 双纵轴与读数区、OSA 单行指标、Beam 光斑 + caustic、Scope 时域 + FFT。内部网格使用虚线，绘图区边界使用实线。
