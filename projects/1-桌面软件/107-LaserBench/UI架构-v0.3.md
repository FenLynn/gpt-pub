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

## 冻结边界

以下继续留在 C#，不复制到 JavaScript：

- 设备通信、采集、缓存和数值计算；
- Test 冻结语义；
- `data/exp`、`data/pic`、`data/video` 路径规则；
- never-overwrite；
- 截图、录像和配置持久化；
- 未来厂商 SDK。

Vue 只负责显示、布局、Canvas 绘图和发送白名单意图。当前桥接命令为：

```text
app.getSnapshot
app.setLabel
app.setCaptureSelection
app.capture
app.screenshot
app.record
beam.setZ
beam.setAttenuation
```

高频 Power、Spectrum、Beam、Scope 和 FFT 图统一使用 HTML Canvas，不用逐点 DOM 节点。

## 生产 UI 所有权

`MainForm` 只负责原生窗口、启动、录像和 WebView2 生命周期，生产主页面由 `WebUiHost + WebUi/` 挂载。历史 WinForms `DashboardControl`、`ModuleViews`、`NavigationPages`、`UiPrimitives` 暂时保留用于回滚参考，但不再作为生产业务 UI 入口。

## WebView2 安全边界

- UI 只映射到 `https://laserbench.local`；
- 禁止跳转到其他地址；
- 禁止新窗口；
- 默认拒绝 Web 权限；
- 关闭 DevTools、默认上下文菜单、状态栏和缩放控制；
- 前端构建产物嵌入 `LaserBench.App.exe`，运行时解压到 Portable `runtime/WebUi/<version>/`；
- WebView2 用户数据位于 Portable `runtime/WebView2/`。

## 视觉方向

v0.3.0 首轮直接对齐目标图：浅蓝灰壳体、白色仪器模块、窄顶栏、窄侧栏、强数值层级、Power 右侧读数、OSA 单行指标、Beam 伪彩色光斑、caustic 和 Scope 双图。内部网格继续使用虚线，绘图区边界使用实线。
