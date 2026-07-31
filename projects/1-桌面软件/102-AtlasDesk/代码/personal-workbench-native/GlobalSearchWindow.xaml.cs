using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace PersonalWorkbench;

public enum GlobalSearchResultKind { Navigation, Command, Workspace, Zotero }

public sealed class GlobalSearchResult
{
    public GlobalSearchResultKind Kind { get; init; }
    public string Category { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string Subtitle { get; init; } = string.Empty;
    public string Hint { get; init; } = "Enter";
    public string Action { get; init; } = string.Empty;
    public string Target { get; init; } = string.Empty;
    public object? Payload { get; init; }
    public string BadgeBackground => Kind switch
    {
        GlobalSearchResultKind.Navigation => "#EAF2FF",
        GlobalSearchResultKind.Command => "#E8F8F3",
        GlobalSearchResultKind.Workspace => "#FFF1E5",
        GlobalSearchResultKind.Zotero => "#F0ECFF",
        _ => "#EEF2F7"
    };
    public string BadgeForeground => Kind switch
    {
        GlobalSearchResultKind.Navigation => "#326FD6",
        GlobalSearchResultKind.Command => "#158764",
        GlobalSearchResultKind.Workspace => "#C36B21",
        GlobalSearchResultKind.Zotero => "#7155C7",
        _ => "#637289"
    };
}

public sealed class GlobalSearchInvokedEventArgs : EventArgs
{
    public GlobalSearchInvokedEventArgs(GlobalSearchResult result) => Result = result;
    public GlobalSearchResult Result { get; }
}

public partial class GlobalSearchWindow : Window
{
    private readonly AppSettings _settings;
    private CancellationTokenSource? _searchCancellation;

    public event EventHandler<GlobalSearchInvokedEventArgs>? ResultInvoked;

    public GlobalSearchWindow(AppSettings settings)
    {
        _settings = settings;
        InitializeComponent();
        Loaded += async (_, _) =>
        {
            QueryBox.Focus();
            await RefreshResultsAsync(string.Empty);
        };
    }

    private async void QueryBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        PlaceholderText.Visibility = string.IsNullOrEmpty(QueryBox.Text) ? Visibility.Visible : Visibility.Collapsed;
        _searchCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _searchCancellation = cancellation;
        try
        {
            await Task.Delay(120, cancellation.Token);
            await RefreshResultsAsync(QueryBox.Text, cancellation.Token);
        }
        catch (OperationCanceledException) { }
    }

    private async Task RefreshResultsAsync(string query, CancellationToken cancellationToken = default)
    {
        var text = query.Trim();
        var results = new List<GlobalSearchResult>();
        results.AddRange(BuildStaticResults(text));

        if (text.Length >= 1 && Directory.Exists(_settings.WorkspaceRoot))
        {
            var files = await Task.Run(
                () => SearchWorkspaceFiles(_settings.WorkspaceRoot, text, 22, _settings.WorkspaceShowHiddenFiles, cancellationToken),
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

        if (text.Length >= 2 && File.Exists(_settings.ZoteroDbPath))
        {
            try
            {
                var papers = await ZoteroLibrary.SearchAsync(_settings.ZoteroDbPath, new ZoteroSearchRequest
                {
                    Query = text,
                    Scope = ZoteroScopeKind.All,
                    Sort = ZoteroSortMode.ModifiedDescending,
                    Limit = 14
                });
                cancellationToken.ThrowIfCancellationRequested();
                results.AddRange(papers.Select(paper => new GlobalSearchResult
                {
                    Kind = GlobalSearchResultKind.Zotero,
                    Category = "文献",
                    Title = paper.DisplayTitle,
                    Subtitle = string.Join(" · ", new[] { paper.Authors, paper.Year, paper.Publication }.Where(value => !string.IsNullOrWhiteSpace(value))),
                    Hint = paper.HasPdf ? "定位 / PDF" : "定位",
                    Action = "zotero-item",
                    Target = paper.Title,
                    Payload = paper
                }));
            }
            catch (Exception ex) { App.Log("Global Zotero search failed: " + ex.Message); }
        }

        cancellationToken.ThrowIfCancellationRequested();
        var ordered = results
            .GroupBy(item => item.Kind + "|" + item.Action + "|" + item.Target, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First()).Take(50).ToArray();
        ResultsList.ItemsSource = ordered;
        EmptyState.Visibility = ordered.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        StatusText.Text = string.IsNullOrWhiteSpace(text) ? $"快速入口 · {ordered.Length} 项" : $"搜索“{text}” · {ordered.Length} 项";
        if (ordered.Length > 0) ResultsList.SelectedIndex = 0;
    }

    private IEnumerable<GlobalSearchResult> BuildStaticResults(string query)
    {
        var items = new[]
        {
            Nav("首页", "本地状态、最近文件与快速入口", "home"),
            Nav("Dashboard", "Cloudflare Pages 工作台", "dashboard"),
            Nav("工作区", "文件、Markdown 编辑与预览", "workspace"),
            Nav("Zotero 资料库", "只读文献检索和元信息", "library"),
            Nav("开发", "Conda、uv 与 Python 环境", "development"),
            Nav("设置", "路径、终端和服务配置", "settings"),
            Command("新建 PowerShell 终端", "在当前工作目录启动内置终端", "new-terminal", "powershell"),
            Command("新建 CMD 终端", "在当前工作目录启动内置终端", "new-terminal", "cmd"),
            Command("打开工作根目录", _settings.WorkspaceRoot, "open-root", _settings.WorkspaceRoot),
            Command("刷新首页状态", "重新读取本地连接和最近文件", "refresh-home", string.Empty)
        };
        if (string.IsNullOrWhiteSpace(query)) return items;
        return items.Where(item => item.Title.Contains(query, StringComparison.OrdinalIgnoreCase)
                                   || item.Subtitle.Contains(query, StringComparison.OrdinalIgnoreCase)
                                   || item.Category.Contains(query, StringComparison.OrdinalIgnoreCase));
    }

    private static IReadOnlyList<string> SearchWorkspaceFiles(
        string root, string query, int limit, bool showHidden, CancellationToken cancellationToken)
    {
        var results = new List<string>();
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0 && results.Count < limit)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var directory = stack.Pop();
            try
            {
                foreach (var path in Directory.EnumerateFileSystemEntries(directory))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (!showHidden && WorkspaceFileItem.IsHidden(path)) continue;
                    if (Directory.Exists(path))
                    {
                        if (!WorkspaceFileItem.IsIgnoredDirectory(path))
                        {
                            stack.Push(path);
                            if (Path.GetFileName(path).Contains(query, StringComparison.CurrentCultureIgnoreCase))
                                results.Add(path);
                        }
                    }
                    else if (Path.GetFileName(path).Contains(query, StringComparison.CurrentCultureIgnoreCase))
                    {
                        results.Add(path);
                    }
                    if (results.Count >= limit) break;
                }
            }
            catch { }
        }
        return results;
    }

    private static GlobalSearchResult Nav(string title, string subtitle, string target) => new()
    {
        Kind = GlobalSearchResultKind.Navigation, Category = "页面", Title = title, Subtitle = subtitle, Action = "navigate", Target = target
    };

    private static GlobalSearchResult Command(string title, string subtitle, string action, string target) => new()
    {
        Kind = GlobalSearchResultKind.Command, Category = "命令", Title = title, Subtitle = subtitle, Action = action, Target = target
    };

    private void ExecuteSelected()
    {
        if (ResultsList.SelectedItem is not GlobalSearchResult result) return;
        ResultInvoked?.Invoke(this, new GlobalSearchInvokedEventArgs(result));
        Close();
    }

    private void QueryBox_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Down)
        {
            ResultsList.SelectedIndex = Math.Min(ResultsList.Items.Count - 1, ResultsList.SelectedIndex + 1);
            ResultsList.ScrollIntoView(ResultsList.SelectedItem); e.Handled = true;
        }
        else if (e.Key == Key.Up)
        {
            ResultsList.SelectedIndex = Math.Max(0, ResultsList.SelectedIndex - 1);
            ResultsList.ScrollIntoView(ResultsList.SelectedItem); e.Handled = true;
        }
        else if (e.Key == Key.Enter) { ExecuteSelected(); e.Handled = true; }
    }

    private void Window_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape) Close();
    }

    private void ResultsList_MouseDoubleClick(object sender, MouseButtonEventArgs e) => ExecuteSelected();
}
