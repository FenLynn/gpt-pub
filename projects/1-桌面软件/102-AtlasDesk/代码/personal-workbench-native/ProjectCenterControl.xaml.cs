using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace PersonalWorkbench;

public sealed class ProjectSelectionChangedEventArgs : EventArgs
{
    public ProjectDescriptor? Project { get; init; }
}

public partial class ProjectCenterControl : UserControl, IDisposable
{
    private readonly AppSettings _settings;
    private IReadOnlyList<ProjectDescriptor> _projects = Array.Empty<ProjectDescriptor>();
    private ProjectDescriptor? _selected;
    private CancellationTokenSource? _scanCancellation;
    private long _scanGeneration;
    private bool _loading;
    private bool _loadedOnce;

    public event EventHandler<ProjectActionEventArgs>? ActionRequested;
    public event EventHandler<ProjectSelectionChangedEventArgs>? ProjectSelectionChanged;
    public ProjectDescriptor? SelectedProject => _selected;

    public ProjectCenterControl(AppSettings settings)
    {
        _settings = settings;
        InitializeComponent();
        // Project discovery is intentionally not bound to Loaded or visibility.
        // ProjectWorkflowCoordinator calls RefreshIfNeededAsync only after the user
        // explicitly opens Development → Project, and Refresh remains user initiated.
        Unloaded += (_, _) => CancelScan();
        UpdateRootBadge();
    }

    public async Task RefreshIfNeededAsync()
    {
        UpdateRootBadge();
        if (!_loadedOnce) await RefreshAsync();
    }

    public void Invalidate()
    {
        _loadedOnce = false;
        UpdateRootBadge();
    }

    public void ShowContextLoading(ProjectDescriptor project)
    {
        if (!IsSelected(project.RootPath)) return;
        SelectionTitle.Text = project.Name + " · " + project.KindLabel;
        StatusText.Text = "正在读取项目上下文…";
    }

    public void ApplyContext(ProjectWorkflowContext context)
    {
        if (!IsSelected(context.ProjectRoot) || _selected is null) return;
        SelectionTitle.Text = _selected.Name + " · " + _selected.KindLabel + context.TitleSuffix;
        StatusText.Text = string.IsNullOrWhiteSpace(context.DetailSummary)
            ? _selected.RootPath
            : context.DetailSummary;
    }

    private bool IsSelected(string rootPath)
        => _selected is not null
           && string.Equals(_selected.RootPath, rootPath, StringComparison.OrdinalIgnoreCase);

    private void UpdateRootBadge()
    {
        RootBadgeText.Text = Directory.Exists(_settings.WorkspaceRoot) ? _settings.WorkspaceRoot : "未配置工作区";
    }

    private async Task RefreshAsync()
    {
        CancelScan();
        var cancellation = new CancellationTokenSource();
        _scanCancellation = cancellation;
        var generation = Interlocked.Increment(ref _scanGeneration);
        _loading = true;
        LoadingPanel.Visibility = Visibility.Visible;
        ProjectList.Visibility = Visibility.Collapsed;
        EmptyState.Visibility = Visibility.Collapsed;

        try
        {
            UpdateRootBadge();
            if (!Directory.Exists(_settings.WorkspaceRoot))
            {
                _projects = Array.Empty<ProjectDescriptor>();
                StatusText.Text = "请先在设置中选择默认工作区";
            }
            else
            {
                StatusText.Text = "正在扫描工作区…";
                var projects = await Task.Run(
                    () => ProjectCatalogService.Scan(_settings.WorkspaceRoot, 2, 300, cancellation.Token),
                    cancellation.Token);
                if (generation != _scanGeneration || cancellation.IsCancellationRequested) return;
                _projects = projects;
                _loadedOnce = true;
                StatusText.Text = $"识别到 {_projects.Count} 个项目 · 扫描深度 2 层";
            }
            if (generation == _scanGeneration) ApplyFilter();
        }
        catch (OperationCanceledException)
        {
            if (generation == _scanGeneration) StatusText.Text = "扫描已取消";
        }
        catch (Exception ex)
        {
            App.Log("Integrated project center refresh failed: " + ex);
            if (generation == _scanGeneration) StatusText.Text = "扫描失败：" + ex.Message;
        }
        finally
        {
            if (generation == _scanGeneration)
            {
                LoadingPanel.Visibility = Visibility.Collapsed;
                ProjectList.Visibility = Visibility.Visible;
                _loading = false;
            }
            if (ReferenceEquals(_scanCancellation, cancellation))
            {
                _scanCancellation = null;
                cancellation.Dispose();
            }
        }
    }

    private void ApplyFilter()
    {
        var query = SearchBox.Text.Trim();
        var type = (TypeFilter.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "all";
        var filtered = _projects.Where(project => MatchesType(project, type)
            && (string.IsNullOrWhiteSpace(query)
                || project.Name.Contains(query, StringComparison.CurrentCultureIgnoreCase)
                || project.KindLabel.Contains(query, StringComparison.CurrentCultureIgnoreCase)
                || project.GitBranch.Contains(query, StringComparison.CurrentCultureIgnoreCase)
                || project.RelativePath.Contains(query, StringComparison.CurrentCultureIgnoreCase)))
            .ToArray();
        ProjectList.ItemsSource = filtered;
        EmptyState.Visibility = filtered.Length == 0 && !_loading ? Visibility.Visible : Visibility.Collapsed;
        if (filtered.Length > 0) ProjectList.SelectedIndex = 0;
        else SelectProject(null);
    }

    private static bool MatchesType(ProjectDescriptor project, string type) => type switch
    {
        "git" => project.Kind.HasFlag(ProjectKind.Git),
        "python" => project.Kind.HasFlag(ProjectKind.Python),
        "node" => project.Kind.HasFlag(ProjectKind.Node),
        "dotnet" => project.Kind.HasFlag(ProjectKind.DotNet),
        "latex" => project.Kind.HasFlag(ProjectKind.Latex),
        "native" => project.Kind.HasFlag(ProjectKind.Rust) || project.Kind.HasFlag(ProjectKind.Go),
        _ => true
    };

    private void SelectProject(ProjectDescriptor? project)
    {
        var changed = !string.Equals(_selected?.RootPath, project?.RootPath, StringComparison.OrdinalIgnoreCase);
        _selected = project;
        var enabled = project is not null && Directory.Exists(project.RootPath);
        WorkspaceButton.IsEnabled = enabled;
        TerminalButton.IsEnabled = enabled;
        ExplorerButton.IsEnabled = enabled;
        CopyPathButton.IsEnabled = enabled;
        SelectionTitle.Text = project is null ? "选择一个项目" : project.Name + " · " + project.KindLabel;
        if (project is not null) StatusText.Text = project.RootPath;
        if (changed)
            ProjectSelectionChanged?.Invoke(this, new ProjectSelectionChangedEventArgs { Project = project });
    }

    private void CancelScan()
    {
        _scanCancellation?.Cancel();
        _scanCancellation?.Dispose();
        _scanCancellation = null;
    }

    private void SearchBox_TextChanged(object sender, TextChangedEventArgs e) => ApplyFilter();
    private void TypeFilter_SelectionChanged(object sender, SelectionChangedEventArgs e) { if (IsLoaded) ApplyFilter(); }
    private async void Refresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync();
    private void ProjectList_SelectionChanged(object sender, SelectionChangedEventArgs e) => SelectProject(ProjectList.SelectedItem as ProjectDescriptor);
    private void ProjectList_MouseDoubleClick(object sender, MouseButtonEventArgs e) => RaiseAction("workspace");
    private void Workspace_Click(object sender, RoutedEventArgs e) => RaiseAction("workspace");
    private void Terminal_Click(object sender, RoutedEventArgs e) => RaiseAction("terminal");
    private void Explorer_Click(object sender, RoutedEventArgs e) => RaiseAction("explorer");

    private void CopyPath_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        try
        {
            Clipboard.SetText(_selected.RootPath);
            StatusText.Text = "路径已复制 · " + _selected.RootPath;
        }
        catch (Exception ex) { StatusText.Text = "复制失败：" + ex.Message; }
    }

    private void RaiseAction(string action)
    {
        if (_selected is null || !Directory.Exists(_selected.RootPath)) return;
        ActionRequested?.Invoke(this, new ProjectActionEventArgs(action, _selected));
    }

    public void Dispose() => CancelScan();
}
