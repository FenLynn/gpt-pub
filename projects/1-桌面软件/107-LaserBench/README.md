# P107｜LaserBench

LaserBench 是面向激光实验室的高密度多仪器观测、统一采集与实验数据整理桌面软件。

当前 `v0.1.1` 是启动稳定性修复版。它继续保持 Portable、Simulator 和高密度 Dashboard 的基础设计，并针对真实 Windows 11 首次启动加入窗口优先显示、分阶段启动日志、全局异常记录与安全模式。

## 当前能力

- Windows x64 Portable 软件，配置和数据跟随程序目录，不使用 AppData 作为产品状态根目录。
- 轻量双层启动：原生 AOT `LaserBench.exe` 负责 .NET 8 Desktop Runtime 检查，`LaserBench.App.exe` 为 framework-dependent 主程序。
- 缺少 .NET 8 Desktop Runtime 时，启动器提供 Microsoft 在线安装路径和离线安装说明。
- `v0.1.1` 主窗口先显示，再初始化 Simulator、Dashboard、录像等工作区组件，避免组件初始化失败时静默无窗口退出。
- 启动过程写入 `logs/startup.log`；未处理异常写入 `logs/crash.log`。
- 支持 `LaserBench.App.exe --safe` 安全模式，安全模式跳过录像初始化但保留主窗口与 Simulator Dashboard。
- 如果工作区初始化仍失败，主窗口保持可见并直接显示异常与日志路径，而不是静默退出。
- 内置 Power、Spectrum、Beam、Scope 四类 Simulator，无真实硬件也可完整查看 Dashboard 和验证采集链。
- Dashboard 使用紧凑单行顶栏、折叠图标导航、四个无卡片观测区。
- Power 支持多 Trace、当前值、Channel 1 Max 与底部全局时间缩略条。
- Spectrum 显示实时光谱、中心波长、3 dB linewidth、RMS linewidth 与功率摘要。
- Beam 同屏显示光斑和 caustic，底部单行保留 Z、自动束腰、Attenuation 与 M²x / M²y / M̄²。
- Scope 同屏显示最多两个通道的时域与 FFT。
- 四个模块可双击进入独立页；从模块左上角图标拖出可形成浮动窗口，拖回主窗口时自动回到原槽位。
- 单次 Test 可独立选择 Power / Spectrum / Beam / Scope。
- Label 在点击 Test 时冻结到本轮采集上下文。
- 截图保存到 `data/pic/`，录像保存到 `data/video/`，两者都不建立日期子目录。
- 实验原始数据保存到 `data/exp/<日期或自定义文件夹>/`，该目录下一层直接是原始文件。
- 所有保存遵守永不覆盖规则，重名自动追加 `_1`、`_2`。
- 内置低码率 MJPEG AVI 应用窗口录像，不额外捆绑 FFmpeg。
- Data 页支持当前实验文件夹切换和按 Label 扫描现有数据版本。

## 目录规则

```text
LaserBench/
├─ LaserBench.exe
├─ LaserBench.App.exe
├─ config/
├─ data/
│  ├─ exp/
│  │  └─ 2026-09-17/ 或用户自定义目录/
│  │     └─ HHmmss_<channel>_<label>.csv
│  ├─ pic/
│  │  └─ HHmmss_<page>_<label>.png
│  └─ video/
│     └─ HHmmss_screen_<label>.avi
├─ logs/
│  ├─ startup.log
│  └─ crash.log
├─ runtime/
├─ tools/
└─ OFFLINE-DEPENDENCIES.txt
```

`pic` 与 `video` 不按日期继续分层。只有 `exp` 在没有自定义实验文件夹时自动使用当日日期目录。

## 文件命名

默认：

```text
HHmmss_<channel-or-device>_<label>.<ext>
```

例如：

```text
221836_power1_13A.csv
221836_osa1_13A.csv
221836_beam_13A.csv
221836_scope_time_13A.csv
```

设置 Alias 后，前台显示和新保存文件优先使用 Alias。文件名冲突时永远不覆盖：

```text
221836_power_out_13A.csv
221836_power_out_13A_1.csv
221836_power_out_13A_2.csv
```

## 技术路线

当前基础 Runtime 故意保持轻量：

```text
C# / .NET 8 / WinForms / Windows x64
+ 自绘图表与控件
+ 无 WebView2
+ 无 Electron
+ 无第三方图表库
```

主程序为 framework-dependent 单文件，避免把完整 .NET Runtime 重复塞进每个更新包。启动器使用 NativeAOT，因此在主 Runtime 缺失时仍能运行依赖检测。

## 分支

```text
日常开发：p107-exp
稳定候选：p107-stable
正式主线：main
```

正式 Release 必须继续遵守仓库人工授权门。普通开发和测试只生成限期 Artifact。

## 当前硬件边界

`v0.1.1` 仍只启用 Simulator。真实仪器接入按独立模块逐个验证，不在基础包中预装未使用 SDK：

- Ophir Juno / OphirLMMeasurement
- Yokogawa AQ6370D
- Ophir Spiricon BeamSquared / SP920
- Tektronix MSO44

每个真实驱动接入前先做硬件 Probe、依赖检测和真实 Windows 验收，UI 与数据格式继续复用同一设备抽象层。

## 构建

P107 Windows CI 会：

1. 做 P107 范围门禁。
2. 使用 .NET 8 构建主程序和 NativeAOT 启动器。
3. 执行无 UI self-test，核对 Portable 根目录、Simulator、采集、目录层级和永不覆盖规则。
4. 生成 `LaserBench_v0.1.1_portable.zip`、manifest 与 SHA-256。
5. 上传限期 GitHub Actions Artifact，不创建标签或正式 Release。

接续开发先读 `HANDOFF.md`。
