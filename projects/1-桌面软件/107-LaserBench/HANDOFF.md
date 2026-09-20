# P107 LaserBench HANDOFF

## 当前断点

长期分支：

```text
p107-exp
p107-stable
main
```

当前稳定候选基线：**v0.4.10 Maintenance Baseline**。当前 `p107-exp` 为 **v0.5.1 Industrial UI / Channel Workstation** 开发候选，建立在 v0.5.0 Real Hardware Data Plane 之上，尚未提升 stable。

v0.4.x 已完成 Vue/WebView2 工作台、Simulator、统一采集状态、Data/Settings、Portable 安全保存、截图录像和 Windows GUI smoke。v0.4.10 不增加实验功能，主要把 v0.3/v0.4 演进后遗留的规则、依赖和状态记录重新对齐，并修正 Scope 配置一致性。

## 每次接续先读

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. `projects/1-桌面软件/107-LaserBench/开发约束.md`
5. 本文件
6. `README.md`
7. `阶段记录.md`
8. `工作记录.md`
9. 当前 `p107-exp`、`p107-stable`、`main` 差异与 P107 CI

不得只凭本文件判断当前事实；源码、CI 和 Git/PR 证据优先。

## 当前实现事实

- 生产 UI 从 v0.3.0 起为 **WinForms Host + Microsoft WebView2 + Vue 3 / TypeScript / Vite + Canvas**。
- `DashboardControl`、`ModuleViews`、`NavigationPages`、`UiPrimitives` 是旧 WinForms UI 的回滚参考，不是当前生产入口。
- C# 继续拥有设备通信、Simulator、采集、Test 冻结语义、配置、路径、安全保存、截图录像和未来厂商 SDK。
- v0.5.0 已将 `InstrumentProviderFactory` 切到 `HybridInstrumentProvider`：Juno=USB/COM STA worker，AQ6370D=TCP/SCPI worker，BeamSquared=net48 Automation bridge，MSO44=raw TCP/SCPI worker。本模块真实接口关闭时才使用 Simulator；启用真实接口但尚未 ready 时绝不伪装为 Simulator 数据。`DataPlaneReady=true` 只能由后台 worker 在成功读取真实样本后产生。
- v0.5.0 最终 UI/Driver 边界按“看得见的控件必须真有效”收口：AQ6370D 面板不再暴露无官方命令依据的 VBW / 未映射峰值阈值，本地平滑明确标注为本地处理；波长偏移在真机模式通过官方 WAVELENGTH:SHIFT 下发、Simulator 才本地模拟；BeamSquared 真机模式锁定 Z/Att/自动浏览和 Simulator M² 参数，只保留结果读取与 X/Y 显示开关，防止把未实现的机械/分析控制伪装成已接通。
- v0.5.1 对生产 Web UI 做统一工业设计收口：PlotCanvas 的 major tick/grid 共源、时间轴避免重复分钟标签、轴端数字支持直接输入；Dashboard metric 数字/单位 baseline 统一，Spectrum 补齐 nm/dBm 单位；当前实验文件夹名以内嵌无框文本显示。模块静态图标用绿/黄/灰/红表达健康状态，顶栏采集选择改蓝青色。
- Power 顶部 power/math 通道矩阵和 Scope 顶部 CH1/CH2 现在都是真正的右栏上下文入口；Power 显示单位/范围按通道持久化，Scope CH1/CH2 的 V/div、Offset、Coupling 分别持久化并由 MSO44 Driver 分别下发。Beam 独立页增加不伪造真机状态的 Frame Quality 条。

## 当前产品不变量

- 软件本体 Portable，配置与数据跟软件根目录走，不静默回退 AppData。
- `data/exp/` 下一层为日期或用户自定义实验目录，再下一层直接是数据文件。
- `data/pic/`、`data/video/` 直接存文件，不按日期分目录。
- 所有保存永不覆盖，冲突追加 `_1`、`_2`。
- Label、Alias 和本轮采集选择在 Test 点击瞬间冻结。
- Dashboard 负责最终综合观测，图占绝对主体；低频模块参数进入对应 Power / Spectrum / Beam / Scope 页，全局 Settings 只负责跨模块设置。
- Windows 原生标题栏保留；顶栏单行极窄；左侧导航保持窄并可折叠。
- Power、Spectrum、Beam、Scope 使用四象限高密度结构，不使用大卡片、阴影和宽边距。
- Dashboard 壳体使用冷深蓝灰，只有实际 Plot / 图像数据区白底；刻度区保持深色。Dashboard 不显示 X/Y 轴标题文字，只保留刻度数值与透明图内 Legend。
- Power 物理功率与数学百分比通道使用独立纵轴；每个 Channel / Math Channel 的 Dashboard 显示开关在 Power 页管理，且与 Test 采集选择分离。
- Dashboard 关键结果支持多个 Big Readout 同时存在；同一指标只保留一个窗口。每窗独立拖动、等比例缩放、黑白主题与关闭，并尽量紧贴读数内容。Big Readout 只在 Dashboard 显示，切换到独立页时隐藏。
- 顶部采集选择图标使用蓝青色表示“本次 Test/Run 选择”并允许内联 SVG + CSS 动画；模块左上图标固定静态，以绿/黄/灰/红表示设备健康状态。两套颜色语义不得再混用。Power bar 缓慢起伏、Spectrum 单峰纵向伸缩、Scope 持续左移、Beam 仅外环扩散。
- Beam Z 只浏览轴向光斑并同步 caustic 参考线，不改写 caustic。
- Scope Dashboard 最多显示两个通道时域和 FFT，通道开关必须同时作用于时域和 FFT。
- 不使用 Electron、FFmpeg 或第三方图表库；生产 UI 明确允许 WebView2，绘图继续使用 Canvas。
- 基础运行依赖为 .NET 8 Desktop Runtime x64 与 Microsoft Edge WebView2 Evergreen Runtime；Portable 包不得静默捆绑大型 Fixed Version WebView2。

## v0.4.10 维护目标

- 版本、README、HANDOFF、阶段记录、目录状态和 C 级约束重新一致。
- 将 WebView2 从历史规则冲突中正式纳入生产技术栈与依赖边界。
- 启动器预检 .NET 8 Desktop Runtime 与 WebView2 Evergreen Runtime，并提供官方在线安装动作和离线说明。
- Scope 时间窗实际作用于 Simulator 时域数据；CH1/CH2 开关同时过滤时域和 FFT。
- CI 继续验证 build、self-test、真实 GUI startup smoke、Portable 边界、依赖启动器、ZIP/manifest/SHA-256。

## 下一阶段边界

v0.5.0 的源码/CI 目标是把四条真实通信链做到可执行并安全失败；下一步不是再搭抽象层，而是拿实验室实机逐台完成 Probe 验收：

1. Juno：确认 StarLab/OphirLMMeasurement 版本、USB 枚举、传感器 power mode、连续 GetData 与拔插恢复。
2. AQ6370D：确认固件/remote interface、10001 socket authentication、*IDN?、TRA 点数/单位、扫描状态与断网恢复。
3. BeamSquared/SP920：确认安装目录、M2.Automation.dll 版本、net48 bridge、Rail/Quantitative/LaserResults 生命周期及单位。
4. MSO44：确认 raw socket 4000、*IDN?、waveform preamble、CURVe? 编码、采样率、trigger/pretrigger 坐标和连续刷新。

没有上述实机证据前，不把 v0.5.0 描述为“真机验收完成”，也不提升 stable。

## 发布边界

测试 EXE、候选 Portable ZIP 和 CI Artifact 不等于正式 Release。没有当前会话针对明确版本的正式发布授权时，不创建 tag 或 GitHub Release。