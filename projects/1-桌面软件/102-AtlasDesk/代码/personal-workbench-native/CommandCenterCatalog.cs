using System.IO;

namespace PersonalWorkbench;

public static class CommandCenterCatalog
{
    public const int MaxRecentResults = 8;
    public const int MaxTotalResults = 36;

    public static Task<IReadOnlyList<GlobalSearchResult>> SearchAsync(
        AppSettings settings,
        string? query,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var text = query?.Trim() ?? string.Empty;
        var results = BuildStaticResults(settings, text)
            .Concat(BuildRecentFileResults(settings, text))
            .GroupBy(
                item => item.Kind + "|" + item.Action + "|" + item.Target + "|" + item.Title,
                StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Take(MaxTotalResults)
            .ToArray();
        return Task.FromResult<IReadOnlyList<GlobalSearchResult>>(results);
    }

    public static IReadOnlyList<GlobalSearchResult> BuildStaticResults(AppSettings settings, string? query)
    {
        var items = new[]
        {
            Nav("首页", "本地状态、最近文件与快速入口", "home"),
            Nav("Dashboard", "打开 AtlasDesk 网页工作台", "dashboard"),
            Nav("工作区", "打开文件、目录和 Markdown 工作区", "workspace"),
            Nav("Zotero 资料库", "进入只读文献检索和元信息页面", "library"),
            Nav("开发", "进入项目、环境和终端", "development"),
            Nav("工具", "进入文件完整性和本地工具", "tools"),
            Nav("任务", "查看现有任务队列、进度与历史", "tasks"),
            Nav("设置", "配置路径、终端和本地服务", "settings"),
            Command("新建 PowerShell 终端", "在当前工作目录启动内置终端", "new-terminal", "powershell"),
            Command("新建 CMD 终端", "在当前工作目录启动内置终端", "new-terminal", "cmd"),
            Command("打开工作根目录", settings.WorkspaceRoot, "open-root", settings.WorkspaceRoot),
            Command("打开配置目录", App.AppDataDirectory, "open-config", App.AppDataDirectory),
            Command("打开日志目录", App.LogDirectory, "open-logs", App.LogDirectory),
            Command("刷新首页状态", "重新读取本地连接和最近文件", "refresh-home", string.Empty)
        };

        var text = query?.Trim() ?? string.Empty;
        return string.IsNullOrWhiteSpace(text)
            ? items
            : items.Where(item => Matches(item, text)).ToArray();
    }

    private static IEnumerable<GlobalSearchResult> BuildRecentFileResults(AppSettings settings, string query)
        => settings.RecentWorkspaceFiles
            .Where(path => !string.IsNullOrWhiteSpace(path) && (File.Exists(path) || Directory.Exists(path)))
            .Where(path => string.IsNullOrWhiteSpace(query)
                           || Path.GetFileName(path).Contains(query, StringComparison.CurrentCultureIgnoreCase)
                           || path.Contains(query, StringComparison.CurrentCultureIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(MaxRecentResults)
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
