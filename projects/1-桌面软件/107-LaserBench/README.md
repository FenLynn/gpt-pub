# P107｜LaserBench

LaserBench 是面向激光实验室的高密度多仪器观测、统一采集与实验数据整理桌面软件。

当前开发版本为 **v0.4.9 稳定候选**。0.4.x 已完成 Vue/WebView2 工作台、统一采集状态、模块独立页、数据中心、设置持久化、截图录像与 Portable 安全保存闭环；真实厂商硬件仍按设备抽象层逐项接入。

## 当前能力

- Windows x64 Portable 软件，配置和数据跟随程序目录，不把产品状态拆到 AppData。
- `LaserBench.exe` 为 NativeAOT 轻量启动器，负责 .NET 8 Desktop Runtime x64 检测；`LaserBench.App.exe` 为 framework-dependent WinForms 主程序。
- 启动过程写入 `logs/startup.log`，未处理异常写入 `logs/crash.log`，支持 `LaserBench.App.exe --safe`。
- 内置 Power、Spectrum、Beam、Scope 四类 Simulator，无真实硬件也可完整验证 Dashboard、Test、保存、截图和录像链路。
- Dashboard 使用原生 Windows 标题栏、单行极窄顶栏、窄折叠导航以及四象限高密度观测区。
- 四个模块之间只使用细虚线分隔，不使用大卡片、阴影或宽边距；绘图区保持白底，应用壳体使用浅蓝灰背景。
- 所有绘图内部网格为虚线，绘图区边界为实线；Legend 透明、无边框并放在图内。
- Power 左侧为多 Trace 时间图和底部时间总览条，右侧独立显示当前值与少量统计槽；数学通道使用独立右轴，不与物理功率共用纵坐标尺度。
- Spectrum 顶部单行显示中心波长、3 dB linewidth、RMS linewidth、功率与当前 OSA，曲线区域占主要空间。
- Beam 左侧显示当前 Z 位置光斑，右侧显示完整 caustic；Z 条只浏览已采集的轴向光斑，不改变右侧 caustic。底部一行保留 Z、播放浏览、Attenuation、M²x、M²y、M̄²。
- Scope Dashboard 只显示最多两个通道的时域和 FFT，详细通道纵轴设置进入独立页。
- 四个模块支持双击进入独立页；从左上模块图标拖出可形成可调整大小的浮动窗口，拖回主窗口后自动嵌回原槽位。
- 单次 Test 可独立选择 Power、Spectrum、Beam、Scope，Label 在点击 Test 瞬间冻结。
- 截图直接写入 `data/pic/`，录像直接写入 `data/video/`，两者都不创建日期子目录。
- 实验数据写入 `data/exp/<日期或自定义实验文件夹>/`，该目录下一层直接是数据文件。
- 所有保存执行 never-overwrite，重名自动追加 `_1`、`_2`。
- Data 页支持当前实验文件夹切换和按 Label 扫描已有数据。

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

主程序为 framework-dependent 单文件，避免每个更新包重复携带完整 .NET Runtime。

## 分支

```text
日常开发：p107-exp
稳定候选：p107-stable
正式主线：main
```

普通开发只生成限期 CI Artifact。正式标签和 GitHub Release 必须继续满足仓库人工授权门。

## 当前硬件边界

v0.4.9 仍默认启用 Simulator。真实仪器按最小闭环逐个接入：

1. Ophir Juno / OphirLMMeasurement
2. Yokogawa AQ6370D
3. Ophir Spiricon BeamSquared / SP920
4. Tektronix MSO44

真实驱动只能接设备抽象层，不允许重写 Dashboard 或绕开统一安全保存层。

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
