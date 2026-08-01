using System.IO;

namespace PersonalWorkbench;

public static class CommandCenterCatalog
{
    public const int MaxProjectResults = 14;
    public const int MaxWorkspaceResults = 18;
    public const int MaxTaskResults = 10;
    public const int MaxZoteroResults = 14;
    public const int MaxTotalResults = 60;
    public const int MaxVisitedDirectories = 240;
    public const int MaxExaminedEntries = 5000;

    public static async Task<IReadOnlyList<GlobalSearchResult>> SearchAsync(
        AppSettings settings,
        string? query,
        CancellationToken cancellationToken = default)
    {
        var text = query?.Trim() ?? string.Empty;
        var results = new List<GlobalSearchResult>();
        results.AddRange(BuildStaticResults(settings, text));
        results.AddRange(BuildRecentFileResults(settings, text));
        results.AddRange(BuildTaskResults(text));

        if (Directory.Exists(settings.WorkspaceRoot))
        {
            var projects = await Task.Run(
                () => ProjectCatalogService.Scan(settings.WorkspaceRoot, 2, 120, cancellationToken),
                cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            results.AddRange(projects
                .Where(project => MatchesProject(project, text))
                .Take(MaxProjectResults)
                .Select(project => new GlobalSearchResult
                {
                    Kind = GlobalSearchResultKind.Project,
                    Category = "项目",
                    Title = project.Name,
                    Subtitle = string.Join(" · ", new[]
                    {
                        project.KindLabel,
                        project.BranchLabel,
                        project.RelativePath
                    }.Where(value => !string.IsNullOrWhiteSpace(value))),
                    Hint = "在工作区打开",
                    Action = "project-item",
                    Target = project.RootPath,
                    Payload = project
                }));

            if (text.Length >= 2)
            {
                var files = await Task.Run(
                    () => SearchWorkspaceFilesBounded(settings.WorkspaceRoot, text, settings.WorkspaceShowHiddenFiles, cancellationToken),
                    cancellationToken);
                results.AddRange(files.Select(path => new GlobalSearchResult
                {
                    Kind = GlobalSearchResultKind.Workspace,
                    Category = Directory.Exists(path) ? "目录" : "文件",
                    Title = Path.GetFileName(path),
                    Subtitle = path,
                    Hint = Directory.Exists(path) ? "打开目录" : "在工作区打开",
                    Action = "workspace-item",
                    Target = path
                }));
            }
        }

        if (text.Length >= 2 && File.Exists(settings.ZoteroDbPath))
        {
            try
            {
                var papers = await ZoteroLibrary.SearchAsync(settings.ZoteroDbPath, new ZoteroSearchRequest
                {
                    Query = text,
                    Scope = ZoteroScopeKind.All,
                    Sort = ZoteroSortMode.ModifiedDescending,
                    Limit = MaxZoteroResults
                });
                cancellationToken.ThrowIfCancellationRequested();
                results.AddRange(papers.Select(paper => new GlobalSearchResult
                {
                    Kind = GlobalSearchResultKind.Zotero,
                    Category = "文献",
                    Title = paper.DisplayTitle,
                    Subtitle = string.Join(" · ", new[] { paper.Authors, paper.Year, paper.Publication }
                        .Where(value => !string.IsNullOrWhiteSpace(value))),
                    Hint = paper.HasPdf ? "定位 / PDF" : "定位",
                    Action = "zotero-item",
                    Target = paper.Title,
                    Payload = paper
                }));
            }
            catch (Exception ex)
            {
                App.Log("Command Center Zotero search failed: " + ex.Message);
            }
        }

        cancellationToken.ThrowIfCancellationRequested();
        return results
            .GroupBy(item => item.Kind + "|" + item.Action + "|" + item.Target, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Take(MaxTotalResults)
            .ToArray();
    }

    public static IReadOnlyList<GlobalSearchResult> BuildStaticResults(AppSettings settings, string? query)
    {
        var items = new[]
        {
            Nav("首页", "本地状态、最近文件与快速入口", "home"),
            Nav("Dashboard", "Cloudflare Pages 工作台", "dashboard"),
            Nav("工作区", "文件、Markdown 编辑与预览", "workspace"),
            Nav("Zotero 资料库", "只读文献检索和元信息", "library"),
            Nav("开发", "项目中心、Conda、uv 与 Python 环境", "development"),
            Nav("工具", "文件完整性和本地工具目录", "tools"),
            Nav("任务", "统一队列、进度与历史", "tasks"),
            Nav("设置", "路径、终端和服务配置", "settings"),
            Tool("项目中心", "识别 Git、Python、Node、.NET、LaTeX、Rust 和 Go 项目", "development"),
            Tool("文件完整性", "生成、校验 SHA-256 清单并比较文件", "tools"),
            Tool("任务中心", "查看哈希和目录统计任务的进度与历史", "tasks"),
            Command("新建 PowerShell 终端", "在当前工作目录启动内置终端", "new-terminal", "powershell"),
            Command("新建 CMD 终端", "在当前工作目录启动内置终端", "new-terminal", "cmd"),
            Command("打开工作根目录", settings.WorkspaceRoot, "open-root", settings.WorkspaceRoot),
            Command("打开配置目录", App.AppDataDirectory, "open-config", App.AppDataDirectory),
            Command("打开日志目录", App.LogDirectory, "open-logs", App.LogDirectory),
            Command("刷新首页状态", "重新读取本地连接和最近文件", "refresh-home", string.Empty)
        };
        var text = query?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(text)) return items;
        return items.Where(item => Matches(item, text)).ToArray();
    }

    public static IReadOnlyList<string> SearchWorkspaceFilesBounded(
        string root,
        string query,
        bool showHidden,
        CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(root) || string.IsNullOrWhiteSpace(query)) return Array.Empty<string>();
        var results = new List<string>();
        var queue = new Queue<(string Path, int Depth)>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        queue.Enqueue((Path.GetFullPath(root), 0));
        var examined = 0;

        while (queue.Count > 0
               && results.Count < MaxWorkspaceResults
               && visited.Count < MaxVisitedDirectories
               && examined < MaxExaminedEntries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var (directory, depth) = queue.Dequeue();
            string normalized;
            try { normalized = Path.GetFullPath(directory); }
            catch { continue; }
            if (!visited.Add(normalized)) continue;

            try
            {
                foreach (var path in Directory.EnumerateFileSystemEntries(normalized))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    examined++;
                    if (examined > MaxExaminedEntries) break;
                    if (!showHidden && WorkspaceFileItem.IsHidden(path)) continue;

                    var isDirectory = Directory.Exists(path);
                    if (isDirectory)
                    {
                        if (WorkspaceFileItem.IsIgnoredDirectory(path) || depth >= 4) continue;
                        try
                        {
                            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) continue;
                        }
                        catch { continue; }
                        queue.Enqueue((path, depth + 1));
                    }

                    if (Path.GetFileName(path).Contains(query, StringComparison.CurrentCultureIgnoreCase))
                        results.Add(path);
                    if (results.Count >= MaxWorkspaceResults) break;
                }
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex) { App.Log("Command Center workspace search skipped a directory: " + ex.Message); }
        }
        return results;
    }

    private static IEnumerable<GlobalSearchResult> BuildRecentFileResults(AppSettings settings, string query)
        => settings.RecentWorkspaceFiles
            .Where(path => !string.IsNullOrWhiteSpace(path) && (File.Exists(path) || Directory.Exists(path)))
            .Where(path => string.IsNullOrWhiteSpace(query)
                           || Path.GetFileName(path).Contains(query, StringComparison.CurrentCultureIgnoreCase)
                           || path.Contains(query, StringComparison.CurrentCultureIgnoreCase))
            .Take(10)
            .Select(path => new GlobalSearchResult
            {
                Kind = GlobalSearchResultKind.Workspace,
                Category = "最近",
                Title = Path.GetFileName(path),
                Subtitle = path,
                Hint = Directory.Exists(path) ? "打开目录" : "在工作区打开",
                Action = "workspace-item",
                Target = path
            });

    private static IEnumerable<GlobalSearchResult> BuildTaskResults(string query)
        => WorkbenchTaskStore.Load(WorkbenchTaskService.HistoryPath)
            .Where(task => string.IsNullOrWhiteSpace(query)
                           || task.Title.Contains(query, StringComparison.CurrentCultureIgnoreCase)
                           || task.TargetPath.Contains(query, StringComparison.CurrentCultureIgnoreCase)
                           || task.TypeLabel.Contains(query, StringComparison.CurrentCultureIgnoreCase)
                           || task.StateLabel.Contains(query, StringComparison.CurrentCultureIgnoreCase))
            .Take(MaxTaskResults)
            .Select(task => new GlobalSearchResult
            {
                Kind = GlobalSearchResultKind.Task,
                Category = "任务",
                Title = task.Title,
                Subtitle = string.Join(" · ", new[] { task.TypeLabel, task.StateLabel, task.CreatedLabel, task.TargetPath }
                    .Where(value => !string.IsNullOrWhiteSpace(value))),
                Hint = "打开任务中心",
                Action = "task-item",
                Target = task.Id.ToString(),
                Payload = task
            });

    private static bool MatchesProject(ProjectDescriptor project, string query)
        => string.IsNullOrWhiteSpace(query)
           || project.Name.Contains(query, StringComparison.CurrentCultureIgnoreCase)
           || project.KindLabel.Contains(query, StringComparison.CurrentCultureIgnoreCase)
           || project.GitBranch.Contains(query, StringComparison.CurrentCultureIgnoreCase)
           || project.RelativePath.Contains(query, StringComparison.CurrentCultureIgnoreCase);

    private static bool Matches(GlobalSearchResult item, string query)
        => item.Title.Contains(query, StringComparison.CurrentCultureIgnoreCase)
           || item.Subtitle.Contains(query, StringComparison.CurrentCultureIgnoreCase)
           || item.Category.Contains(query, StringComparison.CurrentCultureIgnoreCase);

    private static GlobalSearchResult Nav(string title, string subtitle, string target) => new()
    {
        Kind = GlobalSearchResultKind.Navigation,
        Category = "页面",
        Title = title,
        Subtitle = subtitle,
        Action = "navigate",
        Target = target
    };

    private static GlobalSearchResult Tool(string title, string subtitle, string target) => new()
    {
        Kind = GlobalSearchResultKind.Tool,
        Category = "工具",
        Title = title,
        Subtitle = subtitle,
        Action = "navigate",
        Target = target
    };

    private static GlobalSearchResult Command(string title, string subtitle, string action, string target) => new()
    {
        Kind = GlobalSearchResultKind.Command,
        Category = "命令",
        Title = title,
        Subtitle = subtitle,
        Action = action,
        Target = target
    };
}
