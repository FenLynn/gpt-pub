# P107 LaserBench HANDOFF

## 当前断点

长期分支：

```text
p107-exp
p107-stable
main
```

当前开发版本：**v0.2.0 Dashboard Refactor 候选**。

v0.1.x 已经完成 Portable、Simulator、统一 Test、数据安全保存、截图录像、启动诊断和真实 GUI 启动 smoke。v0.2.0 集中解决主页面仍显工程原型、信息层级和仪器感不足的问题。

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

## 当前产品不变量

- 软件本体 Portable，配置与数据跟软件根目录走，不静默回退 AppData。
- `data/exp/` 下一层为日期或用户自定义实验目录，再下一层直接是数据文件。
- `data/pic/`、`data/video/` 直接存文件，不按日期分目录。
- 所有保存永不覆盖，冲突追加 `_1`、`_2`。
- Label、Alias 和本轮采集选择在 Test 点击瞬间冻结。
- Dashboard 负责高密度观测，低频设置进入模块独立页。
- Windows 原生标题栏保留，不自造窗口控制条。
- 顶栏保持单行极窄，Test 在最左，截图、录像和完整日期时间为全局功能。
- 左侧导航默认可折叠，版本只在展开时显示。
- Power、Spectrum、Beam、Scope 继续使用四象限结构，只用中央细虚线分隔，不使用大卡片、阴影和宽边距。
- 绘图区白底；壳体使用浅蓝灰；内部网格统一虚线，绘图区边界统一实线。
- Legend 透明、无边框、放在图内。
- Power 时间总览条只属于左侧曲线区；右侧只显示当前值和少量统计槽。
- Beam 的 Z 条只浏览不同轴向位置的光斑，不改变右侧 caustic。右图允许显示当前位置参考线。
- Beam 底部 Z、播放浏览、Att、M²x、M²y、M̄² 必须同一行。
- Scope Dashboard 只显示最多两个通道时域和 FFT。
- 基础 Runtime 不使用 Electron、WebView2、FFmpeg 或第三方图表库。

## v0.2.0 主页面目标

```text
极窄顶栏
+ 极窄折叠导航
+ Power / Spectrum
+ Beam / Scope
```

重点：

- 图占主面积，不添加大标题或卡片装饰。
- Power 物理功率与数学百分比通道使用独立纵轴。
- Power 右侧读数用颜色短线、Alias、大号数值和单位形成清楚层级。
- OSA 顶部单行显示 λc、3 dB、RMS、功率和当前 OSA。
- Simulator 光谱必须显示真实峰形，不使用反向凹谷占位。
- Beam 左侧光斑、右侧 caustic 比例约 4:6，Z 浏览只联动左图和右图参考线。
- Scope 保持上下两图，不增加“时域”“FFT”等冗余大标题。

## 真实仪器顺序

v0.2.0 主页面实机验收后再继续真机 Probe：

1. Ophir Juno / OphirLMMeasurement
2. Yokogawa AQ6370D
3. BeamSquared 3.1.0 / SP920
4. Tektronix MSO44

每个设备先验证依赖、枚举、最小读取和真实 Windows 行为，再接正式模块。

## 发布边界

用户要求每轮提供可测试 EXE，只授权 CI Artifact 和候选 Portable ZIP。没有当前会话针对明确版本的正式发布授权时，不创建 tag 或 GitHub Release。
