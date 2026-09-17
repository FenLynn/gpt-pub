# P107 LaserBench HANDOFF

## 当前断点

P107 从 `main` 建立独立长期分支：

```text
p107-exp
p107-stable
```

当前开发版本：**v0.1.0 Product Preview**。

本阶段目标是先完成可以在无真实仪器环境运行的 Portable 骨架和 Simulator，不提前捆绑未验证的厂商 SDK。

## 先读

每次接续按顺序读取：

1. `/GPT_RULES.md`
2. `/目录.md`
3. `projects/1-桌面软件/开发约束.md`
4. `projects/1-桌面软件/107-LaserBench/开发约束.md`
5. 本文件
6. `README.md`
7. `阶段记录.md`
8. `工作记录.md`
9. 当前 P107 CI 与 `p107-exp` 最新提交

## 当前产品不变量

- 软件本体 Portable，配置与数据跟软件根目录走，不静默回退 AppData。
- `data/exp/` 下一层为日期或用户自定义实验目录，再下一层直接是数据文件。
- `data/pic/`、`data/video/` 直接存文件，不按日期分目录。
- 所有保存永不覆盖，冲突追加 `_1`、`_2`。
- Label、Alias 和本轮采集选择在 Test 点击瞬间冻结。
- Dashboard 只负责高密度观测，低频配置进入各模块独立页。
- 顶栏单行且极窄，Test 在最左，截图、录像和完整日期时间为全局功能。
- Legend 均为透明背景并放图内。
- Beam Dashboard 底部 Z、自动束腰、Att、M²x、M²y、M̄² 只能占一行。
- 基础 Runtime 不使用 Electron、WebView2、FFmpeg 或第三方图表库。

## v0.1.0 当前实现范围

```text
NativeAOT dependency launcher
+ framework-dependent WinForms main app
+ Power simulator
+ Spectrum simulator
+ Beam simulator
+ Scope simulator
+ Dashboard
+ module pages
+ floating/redock framework
+ Label and selective Test
+ safe data saving
+ screenshot
+ lightweight MJPEG AVI recording
+ data folder and Label scan
```

## 后续真实仪器顺序

真实硬件不要一次全部接入。建议逐个 Probe：

1. Ophir Juno / OphirLMMeasurement
2. Yokogawa AQ6370D
3. BeamSquared 3.1.0 / SP920
4. Tektronix MSO44

每个设备先验证最小闭环，再接 UI 和采集策略。

## 发布边界

用户要求每轮提供可测试 EXE，但这只授权 CI Artifact 和候选 Portable ZIP。没有当前会话针对明确版本的正式发布授权时，不创建 tag 或 GitHub Release。
