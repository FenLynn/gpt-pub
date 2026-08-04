using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace PersonalWorkbench;

public sealed class HomeNavigationEventArgs : EventArgs
{
    public HomeNavigationEventArgs(string target) => Target = target;
    public string Target { get; }
}

public sealed class RecentFileRequestedEventArgs : EventArgs
{
    public RecentFileRequestedEventArgs(string path) => Path = path;
    public string Path { get; }
}

public partial class HomeDashboardControl : UserControl
{
    private const double CompactWidth = 930;
    private const double DenseWidth = 720;

    private readonly AppSettings _settings;
    private CancellationTokenSource? _refreshCancellation;
    private long _refreshGeneration;

    public event EventHandler<HomeNavigationEventArgs>? NavigateRequested;
    public event EventHandler? GlobalSearchRequested;
    public event EventHandler? TerminalRequested;
    public event EventHandler<RecentFileRequestedEventArgs>? RecentFileRequested;

    public HomeDashboardControl() : this(AppSettings.Load()) { }

    public HomeDashboardControl(AppSettings settings)
    {
        _settings = settings;
        InitializeComponent();
        ConfigureMetricCard(PythonValue, "PROJECTS", "P");
        ConfigureMetricCard(WorkspaceValue, "TASKS", "T");
        Loaded += HomeDashboard_Loaded;
        SizeChanged += HomeDashboard_SizeChanged;
        IsVisibleChanged += (_, _) =>
        {
            if (IsVisible)
            {
                ApplyResponsiveLayout();
                _ = RefreshAsync();
            }
            else
            {
                CancelRefresh();
            }
        };
        Unloaded += (_, _) => CancelRefresh();
    }

    public async Task RefreshAsync()
    {
        CancelRefresh();
        var cancellation = new CancellationTokenSource();
        _refreshCancellation = cancellation;
        var generation = Interlocked.Increment(ref _refreshGeneration);

        try
        {
            GreetingText.Text = BuildGreeting();
            DateText.Text = DateTime.Now.ToString(
                "yyyy 年 M 月 d 日  ·  dddd",
                System.Globalization.CultureInfo.GetCultureInfo("zh-CN"));

            var liveTasks = WorkbenchTaskHub.Current?.Tasks
                .Select(item => new HomeTaskDescriptor(item.State, item.Title, item.CreatedAt))
                .ToArray();
            var snapshot = await HomeSnapshotService.ReadAsync(_settings, liveTasks, cancellation.Token);
            if (generation != _refreshGeneration || cancellation.IsCancellationRequested)
                return;

            WorkspaceNameText.Text = snapshot.WorkspaceName;
            WorkspacePathText.Text = snapshot.WorkspacePath;

            DashboardValue.Text = snapshot.DashboardConfigured ? "已连接" : "未配置";
            DashboardDetail.Text = snapshot.DashboardHost;

            ZoteroValue.Text = snapshot.ZoteroMode;
            ZoteroDetail.Text = snapshot.ZoteroDetail;

            PythonValue.Text = snapshot.PinnedProjectCount == 0 && snapshot.RecentProjectCount == 0
                ? "尚无常用项目"
                : $"{snapshot.PinnedProjectCount} 收藏 · {snapshot.RecentProjectCount} 最近";
            PythonDetail.Text = snapshot.MissingProjectCount > 0
                ? $"{snapshot.MissingProjectCount} 个保存路径失效"
                : "项目状态来自已保存入口";

            WorkspaceValue.Text = snapshot.ActiveTaskCount > 0
                ? $"{snapshot.ActiveTaskCount} 个进行中"
                : snapshot.TaskHistoryCount > 0 ? "当前空闲" : "尚无任务";
            WorkspaceDetail.Text = snapshot.TaskHistoryCount == 0
                ? "工具与任务共用历史"
                : snapshot.LatestTaskLabel;

            RecentFilesList.ItemsSource = snapshot.RecentWorkspaceFiles
                .Select(path => new RecentWorkspaceItem(path))
                .ToArray();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            App.Log("Home dashboard refresh failed: " + ex);
        }
        finally
        {
            if (ReferenceEquals(_refreshCancellation, cancellation))
            {
                _refreshCancellation = null;
                cancellation.Dispose();
            }
        }
    }

    private void HomeDashboard_Loaded(object sender, RoutedEventArgs e) => ApplyResponsiveLayout();

    private void HomeDashboard_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (Math.Abs(e.NewSize.Width - e.PreviousSize.Width) >= 1)
            ApplyResponsiveLayout();
    }

    private void ApplyResponsiveLayout()
    {
        var width = ActualWidth;
        if (width <= 0 && Parent is FrameworkElement parent)
            width = parent.ActualWidth;
        if (width <= 0)
            return;

        var compact = width < CompactWidth;
        var dense = width < DenseWidth;

        HomeLayoutRoot.Margin = dense
            ? new Thickness(10, 9, 10, 14)
            : compact ? new Thickness(13, 11, 13, 16) : new Thickness(18, 14, 18, 18);

        StatusGrid.Columns = compact ? 2 : 4;
        var columns = StatusGrid.Columns;
        for (var index = 0; index < StatusGrid.Children.Count; index++)
        {
            if (StatusGrid.Children[index] is not Border cell)
                continue;

            var lastInRow = (index + 1) % columns == 0;
            var hasFollowingRow = index < StatusGrid.Children.Count - columns;
            cell.Margin = new Thickness(
                0,
                0,
                lastInRow ? 0 : 8,
                hasFollowingRow ? 8 : 0);
            cell.MinHeight = compact ? 60 : 62;
        }

        if (dense)
        {
            HeaderHorizontalSpacer.Width = new GridLength(0);
            WorkspaceSummaryColumn.Width = new GridLength(1, GridUnitType.Star);
            HeaderVerticalSpacer.Height = new GridLength(8);
            Grid.SetColumn(WorkspaceSummary, 0);
            Grid.SetRow(WorkspaceSummary, 2);
        }
        else
        {
            HeaderHorizontalSpacer.Width = new GridLength(compact ? 12 : 20);
            WorkspaceSummaryColumn.Width = new GridLength(compact ? 240 : 300);
            HeaderVerticalSpacer.Height = new GridLength(0);
            Grid.SetRow(WorkspaceSummary, 0);
            Grid.SetColumn(WorkspaceSummary, 2);
        }

        HomeActionPanel.ItemHeight = 30;
        RecentWorkCard.MinHeight = compact ? 138 : 150;
    }

    private static void ConfigureMetricCard(TextBlock valueText, string label, string glyph)
    {
        if (valueText.Parent is not StackPanel textStack)
            return;
        var labelText = textStack.Children.OfType<TextBlock>().FirstOrDefault();
        if (labelText is not null)
            labelText.Text = label;
        if (textStack.Parent is not Grid grid)
            return;
        var iconText = grid.Children.OfType<Border>()
            .Select(border => border.Child)
            .OfType<TextBlock>()
            .FirstOrDefault();
        if (iconText is not null)
            iconText.Text = glyph;
    }

    private void CancelRefresh()
    {
        Interlocked.Increment(ref _refreshGeneration);
        _refreshCancellation?.Cancel();
        _refreshCancellation?.Dispose();
        _refreshCancellation = null;
    }

    private string BuildGreeting()
    {
        var greeting = DateTime.Now.Hour switch
        {
            < 6 => "夜深了",
            < 11 => "早上好",
            < 14 => "中午好",
            < 18 => "下午好",
            _ => "晚上好"
        };
        var name = string.IsNullOrWhiteSpace(_settings.UserName) ? "Fenlynn" : _settings.UserName;
        return greeting + "，" + name;
    }

    private void OpenDashboard_Click(object sender, RoutedEventArgs e) => NavigateRequested?.Invoke(this, new HomeNavigationEventArgs("dashboard"));
    private void OpenWorkspace_Click(object sender, RoutedEventArgs e) => NavigateRequested?.Invoke(this, new HomeNavigationEventArgs("workspace"));
    private void OpenLibrary_Click(object sender, RoutedEventArgs e) => NavigateRequested?.Invoke(this, new HomeNavigationEventArgs("library"));
    private void OpenDevelopment_Click(object sender, RoutedEventArgs e) => NavigateRequested?.Invoke(this, new HomeNavigationEventArgs("development"));
    private void OpenSettings_Click(object sender, RoutedEventArgs e) => NavigateRequested?.Invoke(this, new HomeNavigationEventArgs("settings"));
    private void GlobalSearch_Click(object sender, RoutedEventArgs e) => GlobalSearchRequested?.Invoke(this, EventArgs.Empty);
    private void OpenTerminal_Click(object sender, RoutedEventArgs e) => TerminalRequested?.Invoke(this, EventArgs.Empty);

    private void RecentFile_Click(object sender, MouseButtonEventArgs e)
    {
        if (sender is Border { DataContext: RecentWorkspaceItem item } && File.Exists(item.FullPath))
            RecentFileRequested?.Invoke(this, new RecentFileRequestedEventArgs(item.FullPath));
    }
}
