using Microsoft.Win32;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace PersonalWorkbench;

public sealed class ProjectSelectionChangedEventArgs : EventArgs
{
    public ProjectDescriptor? Project { get; init; }
}

public sealed class ProjectContextActionEventArgs : EventArgs
{
    public ProjectContextActionEventArgs(GlobalSearchResult result) => Result = result;
    public GlobalSearchResult Result { get; }
}

public sealed class ProjectFavoriteView
{
    public required string Name { get; init; }
    public required string FullPath { get; init; }
    public required string ParentPath { get; init; }
}

public partial class ProjectCenterControl : UserControl, IDisposable
{
    private readonly AppSettings _settings;
    private IReadOnlyList<ProjectDescriptor> _projects = Array.Empty<ProjectDescriptor>();
    private ProjectDescriptor? _selected;
    private ProjectContextProfile? _selectedProfile;
    private ProjectWorkflowContext? _selectedContext;
    private CancellationTokenSource? _scanCancellation;
    private long _scanGeneration;
    private bool _loading;
    private bool _loadedOnce;

    public event EventHandler<ProjectActionEventArgs>? ActionRequested;
    public event EventHandler<ProjectSelectionChangedEventArgs>? ProjectSelectionChanged;
    public event EventHandler<ProjectContextActionEventArgs>? ContextActionRequested;
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
        ClearOverview();
    }

    public async Task RefreshIfNeededAsync()
    {
        UpdateRootBadge();
        if (!_loadedOnce) await RefreshAsync();
        else ReloadSelectedOverview();
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
        GitValueText.Text = project.Kind.HasFlag(ProjectKind.Git) ? "读取中" : "非 Git 项目";
        GitDetailText.Text = project.Kind.HasFlag(ProjectKind.Git) ? "正在读取分支和变化" : "无需 Git 状态";
        EnvironmentValueText.Text = "读取中";
        RecentValueText.Text = "读取中";
    }

    public void ApplyContext(ProjectWorkflowContext context)
    {
        if (!IsSelected(context.ProjectRoot) || _selected is null) return;
        _selectedContext = context;
        SelectionTitle.Text = _selected.Name + " · " + _selected.KindLabel + context.TitleSuffix;
        StatusText.Text = string.IsNullOrWhiteSpace(context.DetailSummary)
            ? _selected.RootPath
            : context.DetailSummary;
        ApplyContextOverview(_selected, context);
    }

    public void ReloadSelectedOverview()
    {
        if (_selected is null)
        {
            ClearOverview();
            return;
        }
        LoadOverview(_selected);
        if (_selectedContext is not null && IsSelected(_selectedContext.ProjectRoot))
            ApplyContextOverview(_selected, _selectedContext);
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
        _selectedContext = null;
        var available = project is not null && !project.IsMissing && Directory.Exists(project.RootPath);
        WorkspaceButton.IsEnabled = available;
        TerminalButton.IsEnabled = available;
        ExplorerButton.IsEnabled = available;
        CopyPathButton.IsEnabled = project is not null;
        ContextButton.IsEnabled = available;
        PinButton.IsEnabled = project is not null;
        RelocateButton.IsEnabled = project?.IsMissing == true;
        PinButton.Content = project?.IsPinned == true ? "取消收藏" : "收藏";
        SelectionTitle.Text = project is null ? "选择一个项目" : project.Name + " · " + project.KindLabel;
        if (project is not null)
            StatusText.Text = project.IsMissing ? "原路径已失效，请重新定位 · " + project.RootPath : project.RootPath;

        if (available && project is not null)
            LoadOverview(project);
        else
            ClearOverview(project);

        if (changed)
            ProjectSelectionChanged?.Invoke(this, new ProjectSelectionChangedEventArgs { Project = available ? project : null });
    }

    private void LoadOverview(ProjectDescriptor project)
    {
        OverviewPlaceholder.Visibility = Visibility.Collapsed;
        OverviewScroll.Visibility = Visibility.Visible;
        OverviewTitle.Text = project.Name;
        OverviewPath.Text = project.RootPath;
        OverviewKind.Text = project.KindLabel;
        GitValueText.Text = project.Kind.HasFlag(ProjectKind.Git)
            ? string.IsNullOrWhiteSpace(project.GitBranch) ? "Git" : "分支 " + project.GitBranch
            : "非 Git 项目";
        GitDetailText.Text = project.Kind.HasFlag(ProjectKind.Git) ? "等待读取变化" : "无需 Git 状态";
        EnvironmentValueText.Text = BuildEnvironmentLabel(project);
        EnvironmentDetailText.Text = project.MarkerSummary;
        RecentValueText.Text = "等待读取";

        var state = ProductivityContextStore.Load();
        _selectedProfile = ProductivityContextStore.FindProfile(state, project.RootPath);
        DashboardButton.IsEnabled = _selectedProfile is not null
                                    && Uri.TryCreate(_selectedProfile.DashboardUrl, UriKind.Absolute, out var dashboard)
                                    && dashboard.Scheme is "http" or "https";

        if (_selectedProfile is null)
        {
            ContextValueText.Text = "尚未配置";
            ContextDetailText.Text = "点击“编辑上下文”创建显式索引";
            FavoriteList.ItemsSource = Array.Empty<ProjectFavoriteView>();
            CommandList.ItemsSource = Array.Empty<ProjectContextCommand>();
            ResearchList.ItemsSource = Array.Empty<ProjectResearchLink>();
            return;
        }

        var profile = _selectedProfile;
        var favorites = profile.FavoriteFiles
            .Where(path => File.Exists(path) || Directory.Exists(path))
            .Select(ToFavoriteView)
            .Take(8)
            .ToArray();
        var commands = profile.Commands
            .Where(command => !string.IsNullOrWhiteSpace(command.Command))
            .Take(8)
            .ToArray();
        var research = profile.ResearchLinks
            .OrderByDescending(link => link.LinkedUtc)
            .Take(8)
            .ToArray();

        FavoriteList.ItemsSource = favorites;
        CommandList.ItemsSource = commands;
        ResearchList.ItemsSource = research;
        ContextValueText.Text = $"{favorites.Length} 文件 · {commands.Length} 命令 · {research.Length} 文献";
        ContextDetailText.Text = string.Join(" · ", new[]
        {
            profile.DefaultShell.Equals("cmd", StringComparison.OrdinalIgnoreCase) ? "CMD" : "PowerShell",
            string.IsNullOrWhiteSpace(profile.PythonEnvironment) ? string.Empty : profile.PythonEnvironment,
            DashboardButton.IsEnabled ? "Dashboard 已配置" : string.Empty
        }.Where(value => !string.IsNullOrWhiteSpace(value)));
        if (string.IsNullOrWhiteSpace(ContextDetailText.Text))
            ContextDetailText.Text = "私人 Data · 显式索引";
    }

    private void ApplyContextOverview(ProjectDescriptor project, ProjectWorkflowContext context)
    {
        GitValueText.Text = project.Kind.HasFlag(ProjectKind.Git)
            ? string.IsNullOrWhiteSpace(context.GitSummary) ? "Git" : context.GitSummary
            : "非 Git 项目";
        GitDetailText.Text = string.IsNullOrWhiteSpace(context.Status)
            ? project.Kind.HasFlag(ProjectKind.Git) ? "状态不可用" : "无需 Git 状态"
            : context.Status;
        EnvironmentValueText.Text = string.IsNullOrWhiteSpace(context.EnvironmentSummary)
            ? BuildEnvironmentLabel(project)
            : context.EnvironmentSummary;
        RecentValueText.Text = string.IsNullOrWhiteSpace(context.RecentFilesSummary)
            ? "无最近文件"
            : context.RecentFilesSummary;
    }

    private void ClearOverview(ProjectDescriptor? project = null)
    {
        _selectedProfile = null;
        _selectedContext = null;
        DashboardButton.IsEnabled = false;
        FavoriteList.ItemsSource = Array.Empty<ProjectFavoriteView>();
        CommandList.ItemsSource = Array.Empty<ProjectContextCommand>();
        ResearchList.ItemsSource = Array.Empty<ProjectResearchLink>();
        OverviewScroll.Visibility = Visibility.Collapsed;
        OverviewPlaceholder.Visibility = Visibility.Visible;
        if (project?.IsMissing == true)
        {
            OverviewPlaceholder.Children.OfType<TextBlock>().FirstOrDefault(text => text.Text == "选择一个项目")!.Text = "项目路径失效";
        }
    }

    private static string BuildEnvironmentLabel(ProjectDescriptor project)
    {
        var labels = new List<string>();
        if (project.Kind.HasFlag(ProjectKind.Python)) labels.Add("Python");
        if (project.Kind.HasFlag(ProjectKind.Node)) labels.Add("Node");
        if (project.Kind.HasFlag(ProjectKind.DotNet)) labels.Add(".NET");
        if (project.Kind.HasFlag(ProjectKind.Latex)) labels.Add("LaTeX");
        if (project.Kind.HasFlag(ProjectKind.Rust)) labels.Add("Rust");
        if (project.Kind.HasFlag(ProjectKind.Go)) labels.Add("Go");
        return labels.Count == 0 ? "无运行环境标记" : string.Join(" / ", labels);
    }

    private static ProjectFavoriteView ToFavoriteView(string path)
    {
        var trimmed = path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var name = Path.GetFileName(trimmed);
        if (string.IsNullOrWhiteSpace(name)) name = path;
        var parent = Path.GetDirectoryName(trimmed) ?? path;
        return new ProjectFavoriteView { Name = name, FullPath = path, ParentPath = parent };
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
        CopyText(_selected.RootPath, "路径已复制");
    }

    private void Context_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        RaiseContextAction(new GlobalSearchResult
        {
            Kind = GlobalSearchResultKind.Project,
            Category = "项目",
            Title = "编辑项目上下文",
            Subtitle = _selected.RootPath,
            Hint = "编辑",
            Action = "context-edit-current",
            Target = _selected.RootPath,
            Payload = _selectedProfile
        });
    }

    private void Dashboard_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedProfile is null || !DashboardButton.IsEnabled) return;
        RaiseContextAction(new GlobalSearchResult
        {
            Kind = GlobalSearchResultKind.Command,
            Category = "项目",
            Title = "打开项目 Dashboard",
            Subtitle = _selectedProfile.DashboardUrl,
            Hint = "打开",
            Action = "context-open-dashboard",
            Target = _selectedProfile.DashboardUrl,
            Payload = _selectedProfile
        });
    }

    private ProjectFavoriteView? SelectedFavorite => FavoriteList.SelectedItem as ProjectFavoriteView;
    private ProjectContextCommand? SelectedCommand => CommandList.SelectedItem as ProjectContextCommand;
    private ProjectResearchLink? SelectedResearch => ResearchList.SelectedItem as ProjectResearchLink;

    private void FavoriteList_MouseDoubleClick(object sender, MouseButtonEventArgs e) => OpenSelectedFavorite();
    private void FavoriteOpen_Click(object sender, RoutedEventArgs e) => OpenSelectedFavorite();
    private void FavoriteCopy_Click(object sender, RoutedEventArgs e)
    {
        if (SelectedFavorite is { } favorite)
            CopyText(favorite.FullPath, "常用路径已复制");
    }

    private void OpenSelectedFavorite()
    {
        if (_selectedProfile is null || SelectedFavorite is not { } favorite) return;
        RaiseContextAction(new GlobalSearchResult
        {
            Kind = GlobalSearchResultKind.Workspace,
            Category = "项目常用",
            Title = favorite.Name,
            Subtitle = favorite.FullPath,
            Hint = "在工作区打开",
            Action = "context-open-favorite",
            Target = favorite.FullPath,
            Payload = new ProjectContextFavoriteInvocation(_selectedProfile, favorite.FullPath)
        });
    }

    private void CommandList_MouseDoubleClick(object sender, MouseButtonEventArgs e) => RunSelectedCommand();
    private void CommandRun_Click(object sender, RoutedEventArgs e) => RunSelectedCommand();

    private void RunSelectedCommand()
    {
        if (_selectedProfile is null || SelectedCommand is not { } command) return;
        RaiseContextAction(new GlobalSearchResult
        {
            Kind = GlobalSearchResultKind.Command,
            Category = "项目命令",
            Title = string.IsNullOrWhiteSpace(command.Name) ? command.Command : command.Name,
            Subtitle = command.Command,
            Hint = "在项目终端运行",
            Action = "context-run-command",
            Target = _selectedProfile.ProjectRoot,
            Payload = new ProjectContextCommandInvocation(_selectedProfile, command)
        });
    }

    private void ResearchList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (SelectedResearch is { } research && File.Exists(research.PdfPath))
            OpenResearchPdf(research);
        else
            LocateSelectedResearch();
    }

    private void ResearchLocate_Click(object sender, RoutedEventArgs e) => LocateSelectedResearch();
    private void ResearchPdf_Click(object sender, RoutedEventArgs e)
    {
        if (SelectedResearch is { } research)
            OpenResearchPdf(research);
    }

    private void ResearchCopy_Click(object sender, RoutedEventArgs e)
    {
        if (SelectedResearch is not { } research) return;
        var value = !string.IsNullOrWhiteSpace(research.CitationKey)
            ? research.CitationKey
            : !string.IsNullOrWhiteSpace(research.ItemKey)
                ? research.ItemKey
                : research.Title;
        CopyText(value, "引用键已复制");
    }

    private void LocateSelectedResearch()
    {
        if (_selectedProfile is null || SelectedResearch is not { } research) return;
        RaiseContextAction(new GlobalSearchResult
        {
            Kind = GlobalSearchResultKind.Zotero,
            Category = "项目文献",
            Title = research.Title,
            Subtitle = string.Join(" · ", new[] { research.CitationKey, research.Doi }.Where(value => !string.IsNullOrWhiteSpace(value))),
            Hint = "在 Zotero 定位",
            Action = "context-open-research",
            Target = research.Title,
            Payload = new ProjectResearchInvocation(_selectedProfile, research)
        });
    }

    private void OpenResearchPdf(ProjectResearchLink research)
    {
        if (!File.Exists(research.PdfPath))
        {
            StatusText.Text = "当前关联没有可用的本地 PDF";
            return;
        }
        try
        {
            Process.Start(new ProcessStartInfo(research.PdfPath) { UseShellExecute = true });
            StatusText.Text = "已打开 PDF · " + research.Title;
        }
        catch (Exception ex)
        {
            StatusText.Text = "打开 PDF 失败：" + ex.Message;
        }
    }

    private void RaiseContextAction(GlobalSearchResult result)
        => ContextActionRequested?.Invoke(this, new ProjectContextActionEventArgs(result));

    private void CopyText(string value, string success)
    {
        try
        {
            Clipboard.SetText(value);
            StatusText.Text = success + " · " + value;
        }
        catch (Exception ex)
        {
            StatusText.Text = "复制失败：" + ex.Message;
        }
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
