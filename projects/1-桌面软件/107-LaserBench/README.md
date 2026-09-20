# P107｜LaserBench

LaserBench 是面向激光实验室的高密度多仪器观测、统一采集与实验数据整理桌面软件。

当前开发版本为 **v0.5.3（p107-exp）**，稳定候选仍为 v0.4.10。v0.5.3 明确撤回 v0.5.2 对 Dashboard 分隔线、文字尺度、子页布局、右栏和 Plot 几何的广泛视觉重排，恢复 v0.5.1 的页面设计；本轮只保留顶栏 Power / Spectrum / Beam / Scope 四个蓝色采集动态图标的无框自然嵌入，以及 Power 四条窄柱不互遮。后台驱动、通道逻辑和数据平面不回退。真实硬件仍必须经过目标 Windows + 实机验证后才能提升 stable。

## 当前能力

- Windows x64 Portable 软件，配置和数据跟随程序目录，不把产品状态拆到 AppData。
- `LaserBench.exe` 为 NativeAOT 轻量启动器，负责 .NET 8 Desktop Runtime x64 与 Microsoft Edge WebView2 Evergreen Runtime 检测；`LaserBench.App.exe` 为 framework-dependent WinForms/WebView2 主程序。
- 启动过程写入 `logs/startup.log`，未处理异常写入 `logs/crash.log`，支持 `LaserBench.App.exe --safe`。
- 内置 Power、Spectrum、Beam、Scope 四类 Simulator，无真实硬件也可完整验证 Dashboard、Test、保存、截图和录像链路。
- Dashboard 使用原生 Windows 标题栏、极窄顶栏和窄折叠导航；四象限中图占绝对主体。模块标题行与壳体同底色并稍微放宽高度，刻度字号提高一级，避免下半区过度拥挤。
- Dashboard 壳体统一冷深蓝灰；**只有真实 Plot / 图像绘图区使用白底**，模块容器、标题区和页面底板不再使用白色卡片。
- Beam 光斑视图去掉色条/比例尺，支持滚轮缩放、左键拖动、双击复位；左边界和上下边界与相邻 Plot 数据区对齐。
- 顶部四个采集选择图标使用内联 SVG + CSS 动画，并用蓝青色表示“本次采集选中”。v0.5.3 只对这里做视觉改动：四个图标无边框、无背景、无角落 ✓，自然嵌入顶栏；Power 四条动画柱缩为 2.7 px 并去除 stroke，避免互相粘连。Dashboard 与各子页其余布局、文字和分隔视觉回到 v0.5.1。模块左上角静态图标继续表示运行健康状态：绿色正常、黄色连接/警告、灰色离线、红色错误。
- 所有绘图内部网格为虚线；major tick 与 grid line 由同一组坐标值生成，不再出现网格与刻度错位。时间轴按显示跨度自动选择 ≥10 s 的合理间隔，小于 10 s 时只保留一个时间标签，避免同一分钟出现重复 HH:mm。独立页轴端数字可点击直接输入范围，Power 纵轴还可在轴旁直接切换 kW/W/mW；Dashboard 仍不常显 X/Y 轴标题。
- Power 独立页把 power1–power4 / math1–math4 组织成顶部 4×2 通道矩阵；点击通道即切换右栏上下文。每个现有 Power 通道可独立设置显示名称、kW/W/mW 显示单位与纵轴范围，Math 通道可自定义显示单位；移动平均、Offset、Scale、Normalize、Power density、Zero、当前值归一化和 Pass/Fail 继续保留。Dashboard 共用物理功率 Y 轴始终保持 provider canonical kW，避免不同通道选择 W/mW 后破坏共享曲线比例；单位切换只作用于读数与 Power 独立页显示轴。Dashboard 显示选择与 Test 采集选择严格分离，数学通道继续使用独立右轴。
- Spectrum 独立页保留 Center/Span、RBW、Sensitivity、Average、Sweep、采样点数、Trace mode、空气/真空基准等已经有 AQ6370D 命令映射的采集参数；本地平滑、参考光谱和峰值标记被明确归入 LaserBench 本地显示处理；波长偏移则在 AQ6370D 真机模式下通过官方 `:SENSE:CORRECTION:WAVELENGTH:SHIFT` 下发，Simulator 才本地模拟，避免重复偏移。v0.4.27 曾加入但没有 AQ6370D 官方命令依据的 VBW 与未映射峰值阈值已从当前操作面板移除，避免“能改 UI、不能改仪器”的假控制。
- Beam 独立页左侧在正方形 2D 光斑上方增加低高度 Frame Quality 条，Simulator 可给出过亮/正常/偏暗提示；真实 BeamSquared 尚未映射厂商 frame-quality API 时只显示中性“等待映射”，不伪造真机质量。左/右工作区按共同上下基线重新约束；Simulator 下仍保留 Z / 播放 / Attenuation 以及 D4σ/FWHM、outlier 等实验工作流。**真实 BeamSquared 接口启用后，这些尚未映射/可能引发机械运动的控制会自动锁定**；v0.5.0 的 bridge 只读取 RunStatus、BeamWidth 与 M²，Run / rail / Ultracal 和厂商分析算法继续由 BeamSquared 管理。X/Y 曲线显示属于 LaserBench 本地显示控制。
- Scope Dashboard 与独立页保持 **FFT 在上、时域在下**；独立页 CH1/CH2 改为顶部可点击通道入口，右栏随当前通道切换显示名称、显示开关、独立 Volts/div、Offset、Coupling。MSO44 真机 Driver 同样分别下发 CH1/CH2 SCALE/OFFSET/COUPLING；触发与 Acquisition 参数仍为公共设置。
- Dashboard 关键结果可点击进入 **Big Readout**，不同指标允许同时弹出多个读数窗；同一指标只保留一个实例并可再次点击提到最前。每个窗独立拖动、等比例缩放和黑/白显示；左上状态/名称常显，右上控制与右下缩放手柄默认隐藏，hover 时才显示。**Big Readout 只在 Dashboard 显示，切到任何独立模块页时全部隐藏，返回 Dashboard 后恢复。**
- 四个模块可从侧栏进入独立工作页；v0.4.26 将标题图标/名称/关键读数合并成更高的工作站标题区，右侧参数面板可折叠，并拆为“设置 / 结果”两个页签。设置参数使用中文，结果页同时列出测量结果、当前测试参数和接口状态。独立页坐标刻度、轴标题与 Legend 放大，坐标 gutter 与壳体同色，只有真实 Plot 矩形白底；Beam 光斑视窗保持正方形并与 caustic 图上下边框对齐。Power 独立页下方范围条继续与 Dashboard 复用同一对左右手柄与同一显示窗口状态。旧 WinForms 的拖出浮窗/拖回嵌入交互尚未在 Web UI 生产版恢复。
- 顶栏实验工作流为“文件夹 → 当前目录名 → Label → Power / Spectrum / Beam / Scope 采集源 → Run”。文件夹图标使用暖橙棕色，右侧无边框文本只显示最后一级目录名（根目录时显示盘符/根名），仍只有文件夹图标可打开 Windows 原生 FolderBrowserDialog。Dashboard 数值 chip 使用对称上下 padding，数字与单位严格按文字 baseline 对齐。
- v0.5.0 将真实仪器从“控制层骨架”推进到**实际通信数据平面**。Power 使用 Ophir StarLab 安装的 `OphirLMMeasurement.CoLMMeasurement` COM（STA thread：ScanUSB → OpenUSBDevice → StartStream → GetData）；Spectrum 直接通过 AQ6370D Ethernet socket/SCPI（10001、LAN authentication、TRA X/Y）；Scope 直接通过 MSO44 raw TCP/SCPI（4000、WFMOutpre/CURVe?）读取真实时域并在 LaserBench 本地 FFT；BeamSquared 因官方 Automation 依赖 .NET Framework/.NET Remoting，使用独立 net48 `LaserBench.BeamSquaredBridge.exe` 与 .NET 8 主进程隔离。
- 四个模块采用**独立混合数据平面**：某模块真实接口关闭时才使用该模块 Simulator；一旦用户启用真实接口，在实际设备 ready 前该模块不会静默回退 Simulator。Power 真机可与 Spectrum Simulator 同时运行，反之亦然。
- 右侧“设备接口”区现在显示 connecting/authenticating/streaming/ready/faulted/dependency-missing 等运行时状态、设备身份、最后真实样本时间和失败计数，并支持“立即重新探测”。Test 对已启用但未 ready 的真实模块会阻止保存，避免把 Simulator/空数据伪装成真实实验数据。
- 单次 Test 可独立选择 Power、Spectrum、Beam、Scope，Label 在点击 Test 瞬间冻结。
- 截图直接写入 `data/pic/`，录像直接写入 `data/video/`，两者都不创建日期子目录。
- 实验数据写入 `data/exp/<日期或自定义实验文件夹>/`，该目录下一层直接是数据文件。
- 所有保存执行 never-overwrite，重名自动追加 `_1`、`_2`。
- Data 页显示当前实验目录、最近采集摘要、文件统计，并支持按文件名/Label 筛选；实验目录切换位于 Settings。

## Portable 目录

```text
LaserBench/
├─ LaserBench.exe
├─ LaserBench.App.exe
├─ config/
├─ data/
│  ├─ exp/
│  │  └─ YYYY-MM-DD/ 或用户自定义目录/
│  │     └─ HHmmss_<channel>_<label>.csv
│  ├─ pic/
│  │  └─ HHmmss_<page>_<label>.png
│  └─ video/
│     └─ HHmmss_screen_<label>.avi
├─ logs/
├─ runtime/
├─ tools/
└─ OFFLINE-DEPENDENCIES.txt
```

只有 `data/exp/` 使用日期或用户自定义实验目录；`data/pic/` 与 `data/video/` 下直接保存文件。

## 文件命名与安全保存

默认：

```text
HHmmss_<channel-or-device>_<label>.<ext>
```

公开示例：

```text
221836_power1_demo.csv
221836_osa1_demo.csv
221836_beam_demo.csv
221836_scope_time_demo.csv
```

设置 Alias 后，前台显示和新文件名优先使用 Alias。目标文件存在时永远不覆盖，例如：

```text
221836_power_out_demo.csv
221836_power_out_demo_1.csv
221836_power_out_demo_2.csv
```

## 技术路线

```text
C# / .NET 8 / WinForms Host / Windows x64
+ Vue 3 / TypeScript / Vite / WebView2 工作台
+ Canvas 高频绘图
+ NativeAOT 依赖启动器
+ Simulator / Device Abstraction
+ 无 Electron
+ 无第三方图表库
```

主程序为 framework-dependent 单文件，避免每个更新包重复携带完整 .NET Runtime。基础外部运行依赖为 .NET 8 Desktop Runtime x64 与 WebView2 Evergreen Runtime；Portable 包提供两者的在线安装脚本和离线说明。

## 分支

```text
日常开发：p107-exp
稳定候选：p107-stable
正式主线：main
```

普通开发只生成限期 CI Artifact。正式标签和 GitHub Release 必须继续满足仓库人工授权门。

## 当前硬件边界

v0.5.0 已实现四条真实通信路径，但 **CI 只能验证代码、协议解析、bridge、构建和无硬件启动；不能替代实验室实机验收**。

1. **Ophir Juno**：安装 StarLab / OphirLMMeasurement 后，LaserBench 通过 COM 扫描 USB、打开设备，先读取可用 measurement modes 并显式切到标准 **Power** 模式，再 StartStream / `GetData`；`AUTO` 使用发现到的设备，也可填写序列号。若传感器不提供 Power 模式，LaserBench 会拒绝把 Energy/Exposure 数据当成功率。
2. **Yokogawa AQ6370D**：仪器网络设置启用 socket remote，填写 IP 或 TCPIP 地址；LaserBench 直接连接 TCP 10001，执行 LAN authentication、`*IDN?`、扫描参数，并按 `:STAT:OPER:EVEN?` 的 sweep-complete 事件同步后再读取 TRA X/Y，不要求 NI-VISA。SINGLE 每轮取得新扫描，REPEAT 按完成事件逐帧读取，避免旧 TRA/半帧。
3. **BeamSquared / SP920**：安装 BeamSquared 且 Automation 组件可用。Portable 内自带 LaserBench 的 net48 bridge，但不复制厂商 `M2.Automation.dll`；默认从 BeamSquared 安装目录寻找，也可填写自定义安装目录/DLL 路径。
4. **Tektronix MSO44**：仪器 LAN remote/socket 可用后填写 IP；LaserBench 直接连接 raw TCP 4000，显式进入连续采集 RUNSTOP/RUN，读取 CH1/CH2 waveform preamble + CURVe?，根据真实 `XINCR/XZERO/PT_OFF/YMULT/YOFF/YZERO` 还原波形并本地计算 FFT。

真实 Driver 只能接设备抽象层，不允许重写 Dashboard 或绕开统一安全保存层。每台实机最终验收必须记录：依赖版本、设备身份、固件、枚举/握手、连续读取、拔插/断网重连、时间戳、Test 保存与长时间稳定性。

## 构建与验证

P107 Windows CI 会执行：

1. P107 范围门禁。
2. .NET 8 主程序构建与发布。
3. NativeAOT 依赖启动器发布。
4. 无 UI self-test，验证 Simulator、选择性采集、目录规则和 never-overwrite。
5. 真实 GUI 启动 smoke，至少验证工作区能够进入 `workspace-ready`。
6. Portable Runtime 边界和启动器检查。
7. 生成候选 ZIP、manifest、SHA-256 并上传限期 Artifact。

UI、DPI、交互密度和真实仪器仍以 Windows 11 实机验收为准。