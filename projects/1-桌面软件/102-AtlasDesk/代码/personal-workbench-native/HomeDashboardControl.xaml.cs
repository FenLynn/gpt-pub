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
    private readonly AppSettings _settings;
    private bool _loading;

    public event EventHandler<HomeNavigationEventArgs>? NavigateRequested;
    public event EventHandler? GlobalSearchRequested;
    public event EventHandler? TerminalRequested;
    public event EventHandler<RecentFileRequestedEventArgs>? RecentFileRequested;

    public HomeDashboardControl() : this(AppSettings.Load()) { }

    public HomeDashboardControl(AppSettings settings)
    {
        _settings = settings;
        InitializeComponent();
        IsVisibleChanged += async (_, _) => { if (IsVisible) await RefreshAsync(); };
    }

    public async Task RefreshAsync()
    {
        if (_loading) return;
        try
        {
            _loading = true;
            GreetingText.Text = BuildGreeting();
            DateText.Text = DateTime.Now.ToString("yyyy 年 M 月 d 日  ·  dddd", System.Globalization.CultureInfo.GetCultureInfo("zh-CN"));
            var root = _settings.WorkspaceRoot;
            WorkspaceNameText.Text = Directory.Exists(root) ? new DirectoryInfo(root).Name : "尚未配置";
            WorkspacePathText.Text = Directory.Exists(root) ? root : "在设置中选择目录";

            if (Uri.TryCreate(_settings.DashboardUrl, UriKind.Absolute, out var dashboardUri))
            {
                DashboardValue.Text = "已连接";
                DashboardDetail.Text = dashboardUri.Host;
            }
            else
            {
                DashboardValue.Text = "未配置";
                DashboardDetail.Text = "Cloudflare Pages";
            }

            if (File.Exists(_settings.ZoteroDbPath))
            {
                ZoteroValue.Text = _settings.ZoteroLoadFullLibrary ? "全量模式" : $"校准 {_settings.EffectiveZoteroLimit} 条";
                ZoteroDetail.Text = "数据库已连接";
                try
                {
                    var snapshot = await ZoteroLibrary.ReadSnapshotAsync(_settings.ZoteroDbPath);
                    ZoteroDetail.Text = $"文献库 {snapshot.ItemCount:N0} 条";
                }
                catch { }
            }
            else
            {
                ZoteroValue.Text = "未连接";
                ZoteroDetail.Text = "只读文献库";
            }

            var python = new List<string>();
            if (!string.IsNullOrWhiteSpace(_settings.CondaPath) && File.Exists(_settings.CondaPath)) python.Add("Conda");
            if (!string.IsNullOrWhiteSpace(_settings.UvPath) && File.Exists(_settings.UvPath)) python.Add("uv");
            PythonValue.Text = python.Count == 0 ? "待检测" : string.Join(" + ", python);
            PythonDetail.Text = python.Count == 0 ? "Conda / uv" : "环境工具已配置";

            _settings.RecentWorkspaceFiles ??= new List<string>();
            var recent = _settings.RecentWorkspaceFiles.Where(File.Exists).Take(7).Select(path => new RecentWorkspaceItem(path)).ToList();
            RecentFilesList.ItemsSource = recent;
            WorkspaceValue.Text = $"{recent.Count:N0} 个最近文件";
            WorkspaceDetail.Text = Directory.Exists(root) ? "Markdown / 代码 / 图片" : "等待选择目录";
        }
        catch (Exception ex) { App.Log("Home dashboard refresh failed: " + ex); }
        finally { _loading = false; }
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
