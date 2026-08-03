namespace PersonalWorkbench;

public sealed record HomeTaskDescriptor(
    WorkbenchTaskState State,
    string Title,
    DateTimeOffset CreatedAt);

public sealed class HomeStatusSnapshot
{
    public string WorkspaceName { get; init; } = "尚未配置";
    public string WorkspacePath { get; init; } = "在设置中选择目录";
    public bool WorkspaceAvailable { get; init; }

    public bool DashboardConfigured { get; init; }
    public string DashboardHost { get; init; } = "Cloudflare Pages";

    public bool ZoteroConfigured { get; init; }
    public string ZoteroMode { get; init; } = "未连接";
    public string ZoteroDetail { get; init; } = "只读文献库";

    public int PinnedProjectCount { get; init; }
    public int RecentProjectCount { get; init; }
    public int MissingProjectCount { get; init; }

    public int ActiveTaskCount { get; init; }
    public int TaskHistoryCount { get; init; }
    public int ProblemTaskCount { get; init; }
    public string LatestTaskLabel { get; init; } = "尚无任务记录";

    public IReadOnlyList<string> RecentWorkspaceFiles { get; init; } = Array.Empty<string>();
}

public static class HomeSnapshotService
{
    public static Task<HomeStatusSnapshot> ReadAsync(
        AppSettings settings,
        IReadOnlyList<HomeTaskDescriptor>? liveTasks,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);

        var workspaceRoot = settings.WorkspaceRoot;
        var dashboardUrl = settings.DashboardUrl;
        var zoteroDbPath = settings.ZoteroDbPath;
        var zoteroLoadFullLibrary = settings.ZoteroLoadFullLibrary;
        var zoteroLimit = settings.EffectiveZoteroLimit;
        var pinnedProjects = settings.PinnedProjectPaths?.ToArray() ?? Array.Empty<string>();
        var recentProjects = settings.RecentProjectPaths?.ToArray() ?? Array.Empty<string>();
        var recentFiles = settings.RecentWorkspaceFiles?.ToArray() ?? Array.Empty<string>();
        var taskSnapshot = liveTasks?.ToArray();

        return Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();

            var workspaceAvailable = Directory.Exists(workspaceRoot);
            var dashboardConfigured = Uri.TryCreate(dashboardUrl, UriKind.Absolute, out var dashboardUri);
            var zoteroConfigured = File.Exists(zoteroDbPath);

            var pinnedAvailable = pinnedProjects
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count(Directory.Exists);
            var recentAvailable = recentProjects
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count(Directory.Exists);
            var missingProjects = pinnedProjects
                .Concat(recentProjects)
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count(path => !Directory.Exists(path));

            HomeTaskDescriptor[] tasks = taskSnapshot ?? WorkbenchTaskStore.Load(WorkbenchTaskService.HistoryPath)
                .Select(item => new HomeTaskDescriptor(item.State, item.Title, item.CreatedAt))
                .ToArray();
            var activeTasks = tasks.Count(item => item.State is WorkbenchTaskState.Queued or WorkbenchTaskState.Running);
            var problemTasks = tasks.Count(item => item.State is WorkbenchTaskState.Failed or WorkbenchTaskState.Cancelled);
            var latestTask = tasks.OrderByDescending(item => item.CreatedAt).FirstOrDefault();

            cancellationToken.ThrowIfCancellationRequested();
            return new HomeStatusSnapshot
            {
                WorkspaceAvailable = workspaceAvailable,
                WorkspaceName = workspaceAvailable
                    ? new DirectoryInfo(workspaceRoot).Name
                    : "尚未配置",
                WorkspacePath = workspaceAvailable ? workspaceRoot : "在设置中选择目录",
                DashboardConfigured = dashboardConfigured,
                DashboardHost = dashboardConfigured ? dashboardUri!.Host : "Cloudflare Pages",
                ZoteroConfigured = zoteroConfigured,
                ZoteroMode = zoteroConfigured
                    ? zoteroLoadFullLibrary ? "只读全量" : $"只读 {zoteroLimit} 条"
                    : "未连接",
                ZoteroDetail = zoteroConfigured
                    ? Path.GetFileName(zoteroDbPath) + " · 进入资料库后读取"
                    : "只读文献库",
                PinnedProjectCount = pinnedAvailable,
                RecentProjectCount = recentAvailable,
                MissingProjectCount = missingProjects,
                ActiveTaskCount = activeTasks,
                TaskHistoryCount = tasks.Length,
                ProblemTaskCount = problemTasks,
                LatestTaskLabel = latestTask is null
                    ? "尚无任务记录"
                    : latestTask.Title + " · " + StateLabel(latestTask.State),
                RecentWorkspaceFiles = recentFiles
                    .Where(File.Exists)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Take(7)
                    .ToArray()
            };
        }, cancellationToken);
    }

    private static string StateLabel(WorkbenchTaskState state) => state switch
    {
        WorkbenchTaskState.Queued => "等待中",
        WorkbenchTaskState.Running => "运行中",
        WorkbenchTaskState.Completed => "已完成",
        WorkbenchTaskState.Failed => "失败",
        _ => "已取消"
    };
}
