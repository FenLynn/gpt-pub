# GPT-Pub 主线整合与发布流程

本仓库包含多个相互独立的桌面软件项目。`main` 是跨项目源码基线；每个项目只在自己的项目目录、自己的 CI 和必要的状态文档中开发。旧分支保留用于追溯，不作为自动合并来源。

## 一次整合的固定步骤

1. 在本地建立快照：保存 `git bundle --all`、工作区补丁和不含构建产物的源码副本。
2. 更新远端引用：

   ```powershell
   git fetch origin "+refs/heads/*:refs/remotes/origin/*" --prune
   ```

3. 对每个候选分支先做祖先关系和路径审计。只有“项目专属路径 + 项目 CI + 必要项目记录”的变化才允许进入整合；发现删除其他项目文件、跨项目源码修改或无法解释的分叉时，暂停该项目，不使用强制推送。
4. 从远端 `main` 创建一次性的整合分支，在独立 worktree 中按项目逐个执行 `git merge --no-ff`。共享目录文档只做保留双方信息的人工合并。
5. 逐项目执行可用的测试、静态检查和构建门禁；不能在本机执行的 Windows/.NET/Rust 门禁必须交给 GitHub Actions，不以“本地未安装工具链”冒充通过。
6. 检查 `git diff origin/main..HEAD` 的路径范围、禁止二进制、超大文件和工作区清洁度。确认无误后只做快进推送：

   ```powershell
   git push origin HEAD:main
   ```

   禁止 `--force` 和 `--force-with-lease` 覆盖已有主线。

## 项目分支规则

- 新一轮开发从最新 `main` 创建新的项目分支；旧的 `pNNN-exp`、`pNNN-stable` 分支不强推、不删除，作为历史证据保存。
- 项目分支不得互相合并。稳定候选通过审查和 CI 后再进入 `main`。
- `p103-localsub-*` 属于 LocalSub 旧编号迁移历史；P103 永久属于 DavBridge，LocalSub 的正式入口是 P105。
- 分支名、项目编号和路径必须保持一一对应，发现命名与路径不一致时先记录迁移关系，再决定是否合并。

## 二进制与 Release 边界

- EXE、ZIP、7z、RAR、MSI、MSIX 等永远不提交 Git；根目录 `.gitignore` 和仓库门禁会拒绝它们。
- GitHub Release 的标签指向已通过门禁的 `main` 提交。GitHub 自动提供该标签的源码压缩包；Windows Runtime、FFmpeg、ExifTool 等大文件只作为 Release 资产上传。
- Release 资产上传前必须检查：版本、平台、SHA-256、Runtime 清单、无用户配置/历史/日志/缩略图等私有数据。过期资产在 Release 中删除或替换，不复制回仓库。

## 回滚与审计

- 每次整合前保留本地 bundle、工作区 patch 和快照目录，并记录原始 `main`、整合分支、候选分支和测试结果。
- 主线发布后不重写历史。发现问题时优先暂停 Release、修复后追加提交；确需撤回时使用可审计的 revert 提交，原整合提交和标签保留。
- 任何候选分支的差异都可以用 `git diff --name-status origin/main...<branch>` 复核；任何项目都不能仅凭“提交日期更新”认定为最新版。
