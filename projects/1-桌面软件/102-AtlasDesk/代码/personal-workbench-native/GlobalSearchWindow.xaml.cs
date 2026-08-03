using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace PersonalWorkbench;

public enum GlobalSearchResultKind
{
    Navigation,
    Command,
    Workspace,
    Project,
    Task,
    Tool,
    Zotero
}

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
        GlobalSearchResultKind.Project => "#E8F5FF",
        GlobalSearchResultKind.Task => "#FFF4DF",
        GlobalSearchResultKind.Tool => "#EAF7ED",
        GlobalSearchResultKind.Zotero => "#F0ECFF",
        _ => "#EEF2F7"
    };

    public string BadgeForeground => Kind switch
    {
        GlobalSearchResultKind.Navigation => "#326FD6",
        GlobalSearchResultKind.Command => "#158764",
        GlobalSearchResultKind.Workspace => "#C36B21",
        GlobalSearchResultKind.Project => "#2776A8",
        GlobalSearchResultKind.Task => "#A86812",
        GlobalSearchResultKind.Tool => "#277A47",
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
    private long _searchGeneration;

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
        Closed += (_, _) =>
        {
            _searchCancellation?.Cancel();
            _searchCancellation?.Dispose();
            _searchCancellation = null;
        };
    }

    private async void QueryBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        PlaceholderText.Visibility = string.IsNullOrEmpty(QueryBox.Text) ? Visibility.Visible : Visibility.Collapsed;
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        var cancellation = new CancellationTokenSource();
        _searchCancellation = cancellation;
        var generation = Interlocked.Increment(ref _searchGeneration);
        try
        {
            await Task.Delay(120, cancellation.Token);
            await RefreshResultsAsync(QueryBox.Text, cancellation.Token, generation);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            App.Log("Command Center refresh failed: " + ex);
            if (generation == _searchGeneration)
            {
                ResultsList.ItemsSource = Array.Empty<GlobalSearchResult>();
                EmptyState.Visibility = Visibility.Visible;
                StatusText.Text = "搜索失败 · 请查看日志";
            }
        }
    }

    private async Task RefreshResultsAsync(
        string query,
        CancellationToken cancellationToken = default,
        long generation = 0)
    {
        if (generation == 0) generation = Interlocked.Increment(ref _searchGeneration);
        var text = query.Trim();
        StatusText.Text = string.IsNullOrWhiteSpace(text) ? "正在读取快速入口…" : "正在搜索…";

        var catalogTask = CommandCenterCatalog.SearchAsync(_settings, text, cancellationToken);
        var contextTask = Task.Run(
            () => ProductivityContextStore.BuildSearchResults(_settings, text),
            cancellationToken);
        await Task.WhenAll(catalogTask, contextTask);
        cancellationToken.ThrowIfCancellationRequested();
        if (generation != _searchGeneration) return;

        var results = contextTask.Result
            .Concat(catalogTask.Result)
            .GroupBy(item => item.Kind + "|" + item.Action + "|" + item.Target + "|" + item.Title,
                StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Take(CommandCenterCatalog.MaxTotalResults)
            .ToArray();

        ResultsList.ItemsSource = results;
        EmptyState.Visibility = results.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        StatusText.Text = string.IsNullOrWhiteSpace(text)
            ? $"AtlasDesk 快速入口 · {results.Length} 项"
            : $"搜索“{text}” · {results.Length} 项";
        if (results.Length > 0) ResultsList.SelectedIndex = 0;
    }

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
            ResultsList.ScrollIntoView(ResultsList.SelectedItem);
            e.Handled = true;
        }
        else if (e.Key == Key.Up)
        {
            ResultsList.SelectedIndex = Math.Max(0, ResultsList.SelectedIndex - 1);
            ResultsList.ScrollIntoView(ResultsList.SelectedItem);
            e.Handled = true;
        }
        else if (e.Key == Key.Enter)
        {
            ExecuteSelected();
            e.Handled = true;
        }
    }

    private void Window_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape) Close();
    }

    private void ResultsList_MouseDoubleClick(object sender, MouseButtonEventArgs e) => ExecuteSelected();
}
