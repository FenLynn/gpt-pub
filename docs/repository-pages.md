# GPT-Pub 在线预览

GPT-Pub 的统一 Pages 现在只发布 P109 AttendScope 的在线预览：`https://fenlynn.github.io/gpt-pub/p109/`。发布来源为 `p109-exp` 的成功 CI 提交；构建仍采用运行文件白名单，排除真实考勤数据。

P108 FigureStudio 与 P111 GameStation 已迁至独立仓库，`/p108/` 和 `/p111/` 只保留轻量迁移提示，不再从 gpt-pub 的旧项目分支构建代码。独立仓库分别为 [FigureStudio](https://github.com/FenLynn/figurestudio) 和 [GameStation](https://github.com/FenLynn/game)。旧入口继续存在，但不代表旧版应用仍在这里运行。

本仓库只有 `.github/workflows/repository-pages.yml` 有 Pages 写入权限。P109 CI 只验证，不部署；不得建立第二个直接调用 `deploy-pages` 的项目工作流。每次发布应检查 `/p109/`、`/p108/`、`/p111/` 均可打开，并通过 `/preview-build.txt` 核对 P109 源码 SHA。
