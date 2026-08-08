# Mediova v4.5.2 工作记录

本文件只记录 v4.5.2 当前候选、完成标准、最新证据和尚缺内容。更早的实施细节由 Git、PR、CI 与历史提交保存，不在当前工作记录中重复堆叠。

## 当前状态

- 正式版本仍为 **Mediova v4.5.0**，正式标签与 Release 为 `p101-v4.5.0`；
- v4.5.2 仍是**用户验证候选**，不是正式 Release；
- 当前活动分支：`p101-v452-round12-list-structure`；
- 当前 Draft PR：#366，目标分支 `p101-stable`；
- 用户确认前不得合并到 `p101-stable` / `main`，不得建立标签或正式 Release；
- 当前最新产品代码候选 Head：`78b4217902743efb58924a90a2284f4ab2922b49`；
- 当前最新产品验证：P101 Mediova CI **#701** / Run `31242637671`，范围、Linux、Windows-native 全部通过；
- #701 原生 self-test：**126/126**，失败 0；
- 本轮 Round12 列表几何专题与剪裁预览稳定性专题均已取得自动化闭环，下一步只保留用户真实桌面验收，不再继续扩大代码范围。

## v4.5.2 阶段摘要

1. 第一至第五轮：完成顶部工具栏、双工作区状态、导入输出、队列生命周期、剪裁交互与真实 FFmpeg 处理矩阵等基础修复。
2. 第六轮：持续重绘和界面叠加方案被用户实机否决，未作为后续基线。
3. 第七轮：从稳定分支重新建立独立剪裁编辑器和主界面视觉基线。
4. 第八至第十一轮：执行 UI 控制权收口、真实鼠标交互、缩略图生命周期、滚动覆盖与主界面/剪裁编辑器防闪收口。
5. 第十二轮：完成 15 列任务结构、预览/文件名拆分、浅蓝选中、时间/画面剪裁列、列管理、视频/图片独立列配置、真实主页缩略图，以及本轮列表几何与剪裁预览稳定性专题。

## Round12 列表几何专题

用户实机反馈暴露了三项原自动验收未覆盖的问题：

1. `#` 表头存在，但任务编号 `1、2、3…` 不显示；
2. 首行缩略图可能向上侵入 Header，Header 底线不连续；
3. 隐藏“画面剪裁”列后仍可能残留孤立 `100%`。

根因不是单纯视觉样式，而是 ListView 第 0 列特殊几何、数据行纵向边界、Header 绘制所有权和隐藏列绘制条件混杂。最终规则为：

- 单元格几何只使用真实行/列边界；
- 第 0 列单独按真实列宽处理；
- 缩略图严格裁剪在“预览列 ∩ 数据行”内；
- 实际宽度为 0 的隐藏列禁止进入内容绘制；
- Header 只有一个 caption owner，并由唯一全宽 bottom separator 收口；
- 自动门禁必须直接检查编号、Header/首行边界与隐藏列残留，而不是只检查表头文字存在。

#701 最终动态证据继续通过：

```text
number_dark_pixels = [12, 19, 14]
first_row_top = 144
header_bottom = 144
header_row_overlap = false
hidden_picture_crop_residue_dark_pixels = 0
bottom_separator_continuous = true
bottom_separator_min_ratio ≈ 0.997389
selected_background = [231, 243, 255]
horizontal_viewports_validated = 3
```

因此编号、Header/缩略图侵入、隐藏列 `100%` 三项已纳入真实像素门禁，不再依赖人工猜测。

## Round12 真实主页缩略图

旧门禁只能证明占位绘制，不能证明真实媒体帧进入首页。当前门禁使用正常 Runtime 和 Windows 原生文件对话框导入真实 FFmpeg `testsrc2` MP4，再检查首页预览单元格。

#701 结果：

```text
normal_runtime = true
real_file_dialog_used = true
file_imported = true
item_count = 1
real_thumbnail_visible = true
unique_colors = 746
quantized_unique = 111
saturated_pixels = 3531
luma_span = 240
```

因此真实文件导入、probe、主页缩略图生成与可见绘制链仍保持通过。

## Round12 剪裁预览稳定性专题

### 问题

用户实机曾出现“预览帧生成失败”，后续压力门禁又确认：

- 精确跳到视频终点可能没有得到有效新帧；
- 快速连续跳转时，不同 seek target 可能短暂复用旧视觉帧；
- 原实现每次 `generatePreviewFrame()` 都启动新的 FFmpeg worker，只用 `previewSeq` 在回调阶段丢弃旧结果，但不会取消旧 FFmpeg 进程。

### 排除的错误路线

曾尝试通过新的 `SetWindowSubclass` 导航 owner 抢占 `WM_COMMAND`、键盘和时间轴消息，并让 Round12 成为最后安装的子类。该方案在部分 CI 可通过，但不同 runner 上仍会出现精确终点不更新。

结论：不能把正确性建立在多个 Win32 subclass 的相对回调顺序上。最终不再让 Round12 拦截导航消息。

### 最终架构

**Round7 保持唯一输入所有者；Round12 只观察真实预览请求序列。**

所有跳转、±1 秒、±1 帧、左右键和时间轴操作仍由 Round7 正常更新 `currentAt` 并触发 `trimDialog.previewSeq`。Round12 watcher 只观察这个单调递增事实：

1. 发现新的 legacy preview sequence；
2. 立即推进同一个 `previewSeq`，使旧 fast-seek worker 的回调自动失效；
3. 取消上一条 Round12 robust FFmpeg 请求；
4. 为当前 `targetAt` 启动唯一 robust 请求；
5. 最终位图安装必须同时匹配 `generation + ownSeq + targetAt + currentAt`；
6. 对话框关闭立即取消活动 FFmpeg；
7. idle 时只在后台观察原子序列，序列不变化时不向 UI 线程持续投递刷新。

精确终点与 fallback 也改为按实际 FPS 工作：

- 一帧步长为 `1 / fps`，限制在合理范围；
- 请求落到精确终点时收敛到 `duration - 1 frame`；
- 顺序尝试 fast seek、accurate seek；
- 仍失败时只向前退 **1 帧** 做准确 seek；
- 不再使用旧的固定 `0.25 s / 2 帧` 粗回退，避免多个近终点目标被压成同一画面；
- 每次 FFmpeg 尝试有 10 s 上限。

为避免重新引入子类竞争，本轮建立过的 exclusive owner / finalizer 已退化为无副作用兼容壳：不注册 hook、不拦截导航、不启动 worker，也不参与运行时正确性。

## #701 最终剪裁预览证据

真实 Windows 链：

```text
正常 Runtime
→ Windows 原生文件对话框导入真实 MP4
→ 打开 MWRound7Editor
→ 首帧稳定
→ 精确跳转 00:00:02.000
→ 00:00:00.250
→ 00:00:01.750
→ 00:00:00.600
→ 00:00:01.950
→ 00:00:01.100
```

最终报告：

```text
real_file_imported = true
editor_class = MWRound7Editor
minimum_visual_change_ratio = 0.03
stable_matches_required = 3
stable_max_drift_ratio = 0.01
seek_sequence_count = 6
unique_visual_hashes = 6
required_distinct_visual_hashes = 6
failure_texts = []
exact_end_preview_recovered = true
continuous_seek_preview_stable = true
```

精确终点 `00:00:02.000` 相对初始帧实际变化：

```text
initial visual_hash = ef9f95d7075dccba8a124a592ec5a2db5ed0a3cd694461733a53978bc465193e
exact-end visual_hash = dd711ed51fd5677cc759c000e47b8aebf4773472d33350d4b1c8bbb71c999f1a
visual_change_ratio = 0.1740451388888889
stable_matches = 3
```

连续 seek 的主要视觉 hash：

```text
0.250 s → 0a059720405dcdde055842d20301d0b9fd429045635cb003f64c1af4593839c1
1.750 s → fafd05646440a12c70d8f75665b39d3619d1c295eac14c7e632eb5f87db3bc95
0.600 s → fbe58e9a6c0cba4740c4877a41f8ce571b5a598c57869b93ae06f600960cc514
1.950 s → dd711ed51fd5677cc759c000e47b8aebf4773472d33350d4b1c8bbb71c999f1a
1.100 s → 3894674ad317cbefa6ea2ebf0b2ab134179a1866516ea167df08ca3101b5f144
```

12 fps 测试视频中 `1.950 s` 与精确终点允许落到同一个最后可解码帧；其余刻意分离的目标全部满足独立视觉门禁。

## #701 完整验证

准确产品代码 Head：

```text
78b4217902743efb58924a90a2284f4ab2922b49
```

CI：

```text
P101 Mediova CI #701
Run ID：31242637671
scope：success
linux：success
windows-native：success
```

覆盖：

- P101 PR 路径范围门禁；
- Round12 33 项固定 SHA-256 清单；
- Linux Go 全测、全量 race、`go vet`、Windows 交叉测试/构建；
- Windows 隔离 Data 原生全测与全量 race；
- 固定来源真实 FFmpeg/FFprobe；
- v4.5.2 Verification Runtime 构建与 Runtime 清单；
- 四套 Windows 主界面截图；
- 原生 self-test **126/126**；
- 主窗口 180 次几何循环；
- Header 240 次循环；
- main/editor idle 40 帧稳定；
- 横纵悬浮滚动条延迟与隐藏；
- 15 列三视口、浅蓝选择、时间/画面剪裁列；
- 视频/图片列配置隔离；
- 真实文件对话框导入与真实主页缩略图；
- 真实剪裁首帧、精确终点和连续 seek 稳定性。

## #701 候选产物

```text
Mediova.exe
SHA-256：2171663fe8f9b9ab575722fa7d92eaef69e5c0965d034c2dbbe201fb2c36e205

Mediova-v4.5.2-Verification-Runtime.zip
SHA-256：4ea342d9afaa653213997a041f968370f95def98350dec01104c7833c80df056

CI Artifact ID：9017566341
Artifact size：120,932,028 bytes
Artifact archive digest：179a89319451108fc876193091a70632c903076593989d495907df4ed97d1ac9
```

该 Runtime 仍是内部验证候选，不是正式 Release。

## 当前待用户实机验证

自动化已经覆盖本轮四个重点问题，但真实桌面手感仍不能由 CI 代替。继续确认：

- 实际导入多条视频后编号 `1、2、3…`、Header 底线、首行缩略图边界和隐藏“画面剪裁”后的无残留；
- 视频和图片分别拖成明显不同列宽，切换、排序、导入、缩放窗口和重启后是否保持；
- 横纵悬浮滑块边缘命中范围、500 ms 延迟和真实拖动手感；
- AVI、WMV、MP4、H.264、H.265 与图片的首帧和处理后预览；
- 连续拖动时间轴、连续点击 ±1 秒/帧、直接输入终点时间时是否始终及时更新且不闪旧帧；
- 绿色画面选区连续拖动是否仍有肉眼可感知闪烁；
- 搁置、退出锁定、保存、归队和立即重启的完整任务状态链；
- 100%、125%、150%、175% DPI、多显示器、真实长文件名；
- 窗口连续缩放及右侧栏展开/收起时 footer 按钮是否始终稳定。

## 停止条件

当前代码专题到 #701 已满足自动化收口标准，因此不再为“继续优化”主动扩大范围。候选继续保持 Draft；正式版本仍为 v4.5.0。只有用户真实桌面反馈出现新的可复现问题时才继续修复；用户确认后再按 `p101-stable → main → 标签/Release` 流程处理正式发布。
