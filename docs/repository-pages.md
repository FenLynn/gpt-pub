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
