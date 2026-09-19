# P107｜LaserBench

LaserBench 是面向激光实验室的高密度多仪器观测、统一采集与实验数据整理桌面软件。

当前开发版本为 **v0.4.12（p107-exp）**，稳定候选仍为 v0.4.10，等待本轮 Windows 实机视觉验收后再决定是否提升。v0.4.12 继续收紧 v0.4.11 的“图优先”工作台：冷深蓝灰壳体、仅绘图区白底、模块标题/坐标标题/关键读数贴边悬浮，低频参数移入对应模块页，并新增单实例 Big Readout 远距监视。真实厂商硬件仍留给 0.5.x 按设备抽象层逐项接入。

## 当前能力

- Windows x64 Portable 软件，配置和数据跟随程序目录，不把产品状态拆到 AppData。
- `LaserBench.exe` 为 NativeAOT 轻量启动器，负责 .NET 8 Desktop Runtime x64 与 Microsoft Edge WebView2 Evergreen Runtime 检测；`LaserBench.App.exe` 为 framework-dependent WinForms/WebView2 主程序。
- 启动过程写入 `logs/startup.log`，未处理异常写入 `logs/crash.log`，支持 `LaserBench.App.exe --safe`。
- 内置 Power、Spectrum、Beam、Scope 四类 Simulator，无真实硬件也可完整验证 Dashboard、Test、保存、截图和录像链路。
- Dashboard 使用原生 Windows 标题栏、极窄顶栏和窄折叠导航；四象限中图占绝对主体，模块标题与关键读数以紧凑悬浮条贴近图边缘。
- Dashboard 壳体统一冷深蓝灰；**只有真实 Plot / 图像绘图区使用白底**，模块容器、标题区和页面底板不再使用白色卡片。
- 所有绘图内部网格为虚线；Legend 透明、无边框并放在数据区内。Dashboard 不显示 X/Y 轴标题文字，只保留必要刻度；刻度边缘保持深色，纯白只属于真实数据区。
- Power 独立页可逐个选择物理 Channel / Math Channel 是否进入 Dashboard；该显示选择与 Test 采集选择互不影响。数学百分比继续使用独立右轴。
- Spectrum 独立页承载扫描范围等低频参数；Dashboard 只保留曲线与中心波长、3 dB、RMS、功率等结果。
- Beam 左侧显示当前 Z 位置光斑，右侧显示完整 caustic；**Z / 播放 / Attenuation** 作为高频观察控制继续常驻 Dashboard，M² 结果贴边显示。
- Scope Dashboard 只显示最多两个通道的时域和 FFT；时间窗、FFT 范围和通道显示选择进入 Scope 独立页。
- Dashboard 关键结果可点击进入单实例 **Big Readout**；新指标复用同一窗口。窗口左上为绿色状态点 + 小字指标名，右上为黑/白显示切换与关闭，右下为拖拽缩放手柄；拖拽缩放时整个读数窗口等比例缩放。
- 四个模块可从侧栏进入独立聚焦页；旧 WinForms 的拖出浮窗/拖回嵌入交互尚未在 Web UI 生产版恢复，当前不把 Floating 描述为已完成功能。
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

v0.4.12 仍默认启用 Simulator。真实仪器从 0.5.x 起按最小闭环逐个接入：

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
