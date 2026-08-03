using Microsoft.Win32;
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

    private async Task RefreshAsync(string? selectPath = null)
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
            var discovered = new List<ProjectDescriptor>();
            if (!Directory.Exists(_settings.WorkspaceRoot))
            {
                StatusText.Text = "请先在设置中选择默认工作区";
            }
            else
            {
                StatusText.Text = "正在扫描工作区…";
                discovered.AddRange(await Task.Run(
                    () => ProjectCatalogService.Scan(_settings.WorkspaceRoot, 2, 300, cancellation.Token),
                    cancellation.Token));
                if (generation != _scanGeneration || cancellation.IsCancellationRequested) return;
                _loadedOnce = true;
            }

            ProjectUsageService.ApplyUsage(discovered, _settings);
            var missing = ProjectUsageService.BuildMissingSavedProjects(
                _settings,
                _settings.WorkspaceRoot,
                discovered.Select(project => project.RootPath));
            _projects = discovered
                .Concat(missing)
                .OrderByDescending(project => project.IsPinned)
                .ThenBy(project => project.RecentOrder)
                .ThenBy(project => project.IsMissing)
                .ThenByDescending(project => project.LastModified)
                .ThenBy(project => project.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToArray();

            var missingCount = _projects.Count(project => project.IsMissing);
            StatusText.Text = $"识别到 {discovered.Count} 个项目"
                              + (missingCount > 0 ? $" · {missingCount} 个路径待重新定位" : string.Empty)
                              + " · 扫描深度 2 层";
            if (generation == _scanGeneration)
                ApplyFilter(selectPath);
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

    private void ApplyFilter(string? selectPath = null)
    {
        var query = SearchBox.Text.Trim();
        var type = (TypeFilter.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "all";
        var usage = (UsageFilter.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "all";
        var filtered = _projects.Where(project => MatchesType(project, type)
            && MatchesUsage(project, usage)
            && (string.IsNullOrWhiteSpace(query)
                || project.Name.Contains(query, StringComparison.CurrentCultureIgnoreCase)
                || project.KindLabel.Contains(query, StringComparison.CurrentCultureIgnoreCase)
                || project.GitBranch.Contains(query, StringComparison.CurrentCultureIgnoreCase)
                || project.RelativePath.Contains(query, StringComparison.CurrentCultureIgnoreCase)))
            .ToArray();
        ProjectList.ItemsSource = filtered;
        EmptyState.Visibility = filtered.Length == 0 && !_loading ? Visibility.Visible : Visibility.Collapsed;
        if (filtered.Length == 0)
        {
            SelectProject(null);
            return;
        }

        var index = string.IsNullOrWhiteSpace(selectPath)
            ? 0
            : Array.FindIndex(filtered, project => string.Equals(project.RootPath, selectPath, StringComparison.OrdinalIgnoreCase));
        ProjectList.SelectedIndex = index >= 0 ? index : 0;
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

    private static bool MatchesUsage(ProjectDescriptor project, string usage) => usage switch
    {
        "pinned" => project.IsPinned,
        "recent" => project.IsRecent,
        "missing" => project.IsMissing,
        _ => true
    };

    private void SelectProject(ProjectDescriptor? project)
    {
        var changed = !string.Equals(_selected?.RootPath, project?.RootPath, StringComparison.OrdinalIgnoreCase);
        _selected = project;
        var available = project is not null && !project.IsMissing && Directory.Exists(project.RootPath);
        WorkspaceButton.IsEnabled = available;
        TerminalButton.IsEnabled = available;
        ExplorerButton.IsEnabled = available;
        CopyPathButton.IsEnabled = project is not null;
        PinButton.IsEnabled = project is not null;
        RelocateButton.IsEnabled = project?.IsMissing == true;
        PinButton.Content = project?.IsPinned == true ? "取消收藏" : "收藏";
        SelectionTitle.Text = project is null ? "选择一个项目" : project.Name + " · " + project.KindLabel;
        if (project is not null)
            StatusText.Text = project.IsMissing ? "原路径已失效，请重新定位 · " + project.RootPath : project.RootPath;
        if (changed)
            ProjectSelectionChanged?.Invoke(this, new ProjectSelectionChangedEventArgs { Project = available ? project : null });
    }

    private void CancelScan()
    {
        _scanCancellation?.Cancel();
        _scanCancellation?.Dispose();
        _scanCancellation = null;
    }

    private void SearchBox_TextChanged(object sender, TextChangedEventArgs e) => ApplyFilter(_selected?.RootPath);
    private void TypeFilter_SelectionChanged(object sender, SelectionChangedEventArgs e) { if (IsLoaded) ApplyFilter(_selected?.RootPath); }
    private void UsageFilter_SelectionChanged(object sender, SelectionChangedEventArgs e) { if (IsLoaded) ApplyFilter(_selected?.RootPath); }
    private async void Refresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync(_selected?.RootPath);
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

    private void Pin_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        var selectedPath = _selected.RootPath;
        ProjectUsageService.TogglePinned(_settings, selectedPath);
        ProjectUsageService.ApplyUsage(_projects.ToList(), _settings);
        ApplyFilter(selectedPath);
        StatusText.Text = _settings.PinnedProjectPaths.Contains(selectedPath, StringComparer.OrdinalIgnoreCase)
            ? "已收藏项目 · " + selectedPath
            : "已取消收藏 · " + selectedPath;
    }

    private async void Relocate_Click(object sender, RoutedEventArgs e)
    {
        if (_selected?.IsMissing != true) return;
        var oldPath = _selected.RootPath;
        var dialog = new OpenFolderDialog
        {
            Title = "重新定位项目目录",
            Multiselect = false
        };
        if (dialog.ShowDialog(Window.GetWindow(this)) != true)
            return;

        var descriptor = ProjectCatalogService.Detect(dialog.FolderName, _settings.WorkspaceRoot);
        if (descriptor is null)
        {
            MessageBox.Show(
                Window.GetWindow(this),
                "所选目录没有识别到 Git、Python、Node、.NET、LaTeX、Rust 或 Go 项目标记。",
                "重新定位项目",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            return;
        }

        ProjectUsageService.Relocate(_settings, oldPath, descriptor.RootPath);
        await RefreshAsync(descriptor.RootPath);
        StatusText.Text = "项目已重新定位 · " + descriptor.RootPath;
    }

    private void RaiseAction(string action)
    {
        if (_selected is null || _selected.IsMissing || !Directory.Exists(_selected.RootPath)) return;
        ProjectUsageService.RecordOpened(_settings, _selected.RootPath);
        var selectedPath = _selected.RootPath;
        ProjectUsageService.ApplyUsage(_projects.ToList(), _settings);
        ApplyFilter(selectedPath);
        ActionRequested?.Invoke(this, new ProjectActionEventArgs(action, _selected));
    }

    public void Dispose() => CancelScan();
}
