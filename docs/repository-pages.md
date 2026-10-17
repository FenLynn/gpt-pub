# GPT-Pub 统一 Pages 预览

## 根因与固定入口

GitHub Pages 的 deploy-pages 每次部署整个站点。P108 与 P109 以前各自只上传一个项目，后部署的项目就会使另一个项目变成 404。

现在 **只有** `.github/workflows/repository-pages.yml` 拥有 Pages 发布权限；P108 / P109 各自的项目 CI 不发布网站。

| 项目 | 页面 | 源码 | 项目独立 CI |
|---|---|---|---|
| P108 FigureStudio | `https://fenlynn.github.io/gpt-pub/p108/` | `p108-exp` | `P108 FigureStudio CI` |
| P109 AttendScope | `https://fenlynn.github.io/gpt-pub/p109/` | `p109-exp` | `P109 AttendScope CI` |

完整站点入口：`https://fenlynn.github.io/gpt-pub/`。

## 职责和触发器

- 项目保持自己的开发分支、既有校验、测试/构建；CI 只有 `contents: read`，没有 `pages: write`。
- 统一 Pages 工作流放在 `main`，监听 P108 / P109 CI 的**成功完成**（`workflow_run`），并支持 `workflow_dispatch`，以及统一工作流自身的 `main` 合并。
- 集中部署从两个项目各自的最新 `exp` checkout 源码，重新构建并验证，生成同一份网站 `_site/p108/` 与 `_site/p109/`，两者任一检查失败都会阻止部署。
- 单个 `concurrency` group 串行化发布；没有任何项目级别的 Pages 部署与之竞争。失败不会上传不完整站点。
- `/preview-build.txt` 记录当前整站使用的 P108/P109 精确源码提交 SHA，方便诊断缓存或覆盖。
- P109 使用**发布白名单**：仅 `index.html`、`project.json`、`src/`、`config/`。不发布考勤 raw/working/snapshots/branches/output、记录或工作目录；用户私有数据绝不进入发布包。
- P108 的 `vite.config.ts` 继续以 `/gpt-pub/p108/` 为静态资源基路径；P109 使用本地相对资源路径。

## 验收与停止条件

1. P108、P109 项目 CI 分别成功且不包含 `actions/deploy-pages`；
2. 统一工作流在精确运行 SHA 上验证 P108 build 与 P109 语法/离线源，再验证两个 `index.html`、P108 assets 和 P109 脚本；
3. GitHub Pages 的最后一次部署来源必须是 `GPT-Pub Unified Pages`；
4. 线上两个固定入口都返回 HTML，资源路径无 404；
5. 任一项目再次提交后，统一部署仍保持两个入口；
6. 项目源码、数据、其他 CI、正式 Release、tag 和生产版本均不更改。

如果网页访问仍受代理/缓存影响，用 `preview-build.txt` 与统一发布 workflow 的 SHA 比对，再检查访问实际 HTTP 状态；不能仅以 Actions 绿色宣称浏览器验收通过。

## 新增项目

如果未来 P110 等也需要 Pages，必须在**统一发布工作流**中添加明确来源和完整构建测试及新的 `/p110/` 目录。禁止重新建立会调用 `actions/deploy-pages` 的独立项目发布工作流。

## 最近预览同步

- 2026-10-16：P109 离线桌面端重新整理为单行工具栏、固定 31 列矩阵、四态柔和配色及统一分析区域。独立 P109 CI 通过含中文字体的 Chromium 离线功能与图形验收。
- 本次共享预览同步以统一工作流同时构建 P108 `p108-exp` 与 P109 `p109-exp`，不允许仅上传 P109 替代整站。预览实际使用的两者提交以发布后 `/preview-build.txt` 为准。

## 2026-10-16 P109 UI 候选预览同步

- P109 设计调整：MATQ 式信息层级、DavBridge / LocalSub 蓝白视觉、固定 31 列矩阵、右侧完整日分析工作台；双时间轴方向修正，模拟加班改为稳定但不产生斜线的分布。
- 源代码：`p109-exp@4dc41699d813149f007789c69a4d56026058ff00`。
- 实测依据：`P109 AttendScope CI #38848874386`，包含无网络 file:// Chromium、中文字体、1920/1600/1366 布局、单人时间轴、证据下钻和多上下文 ECharts 测试；结论 success。
- 固定线上入口：`https://fenlynn.github.io/gpt-pub/p109/`。统一发布依然要同时保留 P108；应从发布成功日志中验证 P109_SHA 等于上述源码提交，再称该网页已更新。
- 本次只是源码候选的共享预览，不做正式标签或 Release，不提升 P109 exp 到 stable/main。

## 2026-10-16 P109 可读性改版预览同步

- 源码目标：`p109-exp@baf7d4ab4cedf352cae45357250e9587f32f728c`，对应 P109 CI [#38851017828](https://github.com/FenLynn/gpt-pub/actions/runs/38851017828) 成功。
- 矩阵大屏 554→721px（增加约 30.1%），字体、姓名和日期显示提升；右侧精简重复说明，保持时间轴/证据交互。
- 此记录仅触发完整共享站点重建，依照统一部署核验 `P109_SHA` 和 P108/P109 双入口后才可宣称上线。没有独立 Pages 发布、正式标签或 Release。

## 2026-10-16 P109 R12 月份工作台重构

- 源码验证目标：`p109-exp@4d23b6b6f2b432c51a5bcfec9832abc42c1d9c45`，最终以通过的 P109 离线 Chrome CI 与 Pages 日志的 `P109_SHA` 一致为准。
- 月份移至顶栏，支持新建空白月份并按 YYYY/MM 记录原始与 working；组别可修改并保存在 working/快照。
- 固定矩阵日期表头与姓名列，整行/整列连续选中光晕、单格浮起。右侧单行上下文标题，图表四 Tab 与指标联动，下部 Tabulator 可分页、弹出拖拽与缩放。
- 仍按唯一共享 Pages 发布 P108/P109，保留离线工作和原始文件不可变，不发布 Release。

## 2026-10-16 P109 AttendScope R13 视觉与工作流更新

- P109 经离线 Chromium 验证的精确提交：`8d8beb8e360037b52939001a53a3f35670278248`。
- 运行 [P109 CI #38876552977](https://github.com/FenLynn/gpt-pub/actions/runs/38876552977) 完成（0 网络请求、0 页面错误）。
- R13：默认红黄绿状态下拉、紫色选中框、人员与日期上下文联动、筛选动画、朝线箭头与全天缩略图、个人逐日状态颜色、3774 条极端模拟打卡、五种原始数据 Tab 的无分页虚拟滚动、设置与月份操作区。
- 统一 Pages 仍将 `p109-exp` 源代码以离线静态资源发布在 `/p109/`；同时保留 P108，验证发布日志中的精确 `P108_SHA`/`P109_SHA`，不创建正式 Release。

## 2026-10-16 P109 R14 三轮目测验收

- P109 精确提交：`932356cd18c2e0d1297d5ebcc3ab92c34038c4cb`，离线 Chromium [#38898985270](https://github.com/FenLynn/gpt-pub/actions/runs/38898985270) success。
- 三轮实际截图验收：1. 设置中心与矩阵整体；2. 单一缩放条和全天密度、首末打卡跨度、设置预览；3. 字体、加粗事件箭头、蓝色 hover 十字及紫色选中框。保持默认仅红黄绿主状态、其余业务色独立。
- 原始表格：本地 Tabulator 虚拟滚动、考勤/出差/请假/外出/加班五接口；支持设置中心每类列可见性与宽度。时间轴有法定工作、实际在岗、首末跨度、打卡事件与可选业务轨道。
- 唯一 Pages 工作流完整构建 P108/P109 并校验 `P109_SHA` 等于上述精确值，不创建正式 Release。

## 2026-10-16 P109 R15 选择及判断/行为正交验收

- 精确待发布源 SHA：`20c97b2437817cebc5d5c2c9d69bc7d33ccb01d8`。
- 离线 Chromium [#38907189228](https://github.com/FenLynn/gpt-pub/actions/runs/38907189228) SUCCESS。
- 姓名全行选择与日期全列选择不受已有另一维影响；单格及非工作日紫色浮起，姓名和日期边框完整，姓名恢复正常字重。
- 判断和行为两套数据维度：正常绿、异常黄、缺勤红；出差蓝、请假橙、外出青、加班粉。默认仅红黄绿，行为筛选独立；右侧图表同源颜色。
- R15 音轨顺序：上方法定工作轨、中间打卡基线/事件箭头、下方实际在岗/首末跨度/业务轨。单一宽幅缩放条、全天打卡点缩略，原始表格始终保留固定姓名列。
- 唯一共享 Pages 发布包含 P108 和 P109；`P109_SHA` 必须等于以上 SHA，不发布正式 Release。

## 2026-10-16 P109 R16 screenshot-refined matrix and timeline

- Source: `583a38dab97a4a138a0b26b53403c2a0cf648e82`; offline Chromium [#38918553846](https://github.com/FenLynn/gpt-pub/actions/runs/38918553846) SUCCESS.
- Visual review used the actual CI screenshots after the user's R15 screenshot. Name/date anchors now have complete violet boxes; soft violet row/column crosshair remains for cell focus. Employee text remains normal weight.
- Canonical filter is rendered as a colored dropdown: regular = green/yellow/red judgments, while trip/leave/outing/overtime remain four independent behavior colors. Judgment and behavior dimensions are not merged.
- Timeline keeps one broad 0:00–24:00 zoom control, scheduled rail above, punch rail in the middle, actual/behavior rails below. Overlapping punches are clustered per minute/direction and shown as grouped punch dots.
- Raw grid keeps the employee column visible. Shared Pages must retain P108 and publish exact P109_SHA above. No Release.

## 2026-10-17 P109 R17 unified violet selection language

- P109 source SHA: `065f1555bc6aab7b387ec125100f9c7f40732e28`.
- Offline Chromium CI: [#38930382047](https://github.com/FenLynn/gpt-pub/actions/runs/38930382047) SUCCESS.
- Removed the nested violet borders on the selected employee/date anchors. Name/date now use a violet tint only; the row/column crosshair supplies the single outer violet outline.
- The tint and outline deliberately use different violet strengths to preserve hierarchy without double framing. Existing single-cell float/glow, judgment/behavior palettes and timeline remain unchanged.
- Shared Pages must preserve P108 and publish exact P109_SHA above.

## 2026-10-17 P109 R18 filter-linked analysis, manual judgment, adaptive audio timeline

- P109 source SHA: `2192410aa2720c8c1bba07d942257c7e1e47865a`.
- Offline Chromium CI: [#38996237062](https://github.com/FenLynn/gpt-pub/actions/runs/38996237062) SUCCESS.
- Left status/behavior filter now drives the right overview, statistics and raw-data category. The inspector header is 33 px and the right summary rail is reduced to about 122 px.
- Judgment and behavior remain orthogonal. Manual red/yellow/green overrides are month-persistent, can switch between initial/manual views, and optionally show a ✓ marker (enabled by default).
- Timeline uses maximum horizontal width: scheduled reference above, punch baseline in the middle, attendance/behavior bars below. Nearby punches merge adaptively into thicker arrows at broad zoom and split when zoomed in; the 0:00–24:00 overview uses separate in/out vertical bars.
- Trip/leave/outing/overtime colors are distinct; punch colors use a separate neutral palette. Actual attendance bar follows the active judgment color.
- Chart/timeline evidence links to Tabulator rows with automatic scrolling and highlighted raw records. Demo data includes a single E011 day with all four behavior rails and denser behavior samples overall.
- Shared Pages must preserve P108 and publish exact P109_SHA above. No Release.
