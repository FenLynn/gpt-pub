using System.Diagnostics;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace PersonalWorkbench;

/// <summary>
/// Owns the v1.1 productivity context layer: Command Center extensions, per-project
/// launch profiles, safe session continuation and read-only Zotero project links.
/// It stores only navigation/context metadata in Roaming Data and never persists
/// terminal output, commands that were typed ad hoc, browser credentials or Zotero data.
/// </summary>
public sealed class ProductivityContextCoordinator
{
    private static WeakReference<ProductivityContextCoordinator>? CurrentReference;

    private readonly MainWindow _window;
    private readonly WorkbenchFeaturePipeline _pipeline;
    private readonly WorkspaceControl _workspace;
    private readonly ZoteroLibraryControl _zotero;
    private readonly TerminalDrawerControl _terminal;
    private ProductivityContextState _state;
    private bool _restoreInProgress;
    private bool _disposed;

    private ProductivityContextCoordinator(MainWindow window, WorkbenchFeaturePipeline pipeline)
    {
        _window = window;
        _pipeline = pipeline;
        _workspace = ReadField<WorkspaceControl>(pipeline.Base, "_workspace")
                     ?? throw new InvalidOperationException("Workspace module is unavailable.");
        _zotero = ReadField<ZoteroLibraryControl>(pipeline.Base, "_zotero")
                  ?? throw new InvalidOperationException("Zotero module is unavailable.");
        _terminal = ReadField<TerminalDrawerControl>(pipeline.Base, "_terminal")
                    ?? throw new InvalidOperationException("Terminal module is unavailable.");
        _state = ProductivityContextStore.Load();
        CurrentReference = new WeakReference<ProductivityContextCoordinator>(this);

        InstallContextButton();
        InstallZoteroProjectLinkButton();
        WireNavigationTracking();
        _window.Closing += Window_Closing;
        _window.Closed += (_, _) => Dispose();
        _window.Dispatcher.BeginInvoke(
            new Action(() => _ = RestoreSessionAsync(manual: false)),
            DispatcherPriority.ContextIdle);
    }

    public static ProductivityContextCoordinator Attach(MainWindow window, WorkbenchFeaturePipeline pipeline)
        => new(window, pipeline);

    public static async Task<bool> TryExecuteAsync(MainWindow window, GlobalSearchResult result)
    {
        if (!result.Action.StartsWith("context-", StringComparison.Ordinal))
            return false;
        if (CurrentReference is null
            || !CurrentReference.TryGetTarget(out var coordinator)
            || !ReferenceEquals(coordinator._window, window)
            || coordinator._disposed)
        {
            App.Log("Productivity context action ignored because coordinator is unavailable: " + result.Action);
            return true;
        }

        await coordinator.ExecuteAsync(result);
        return true;
    }

    private static T? ReadField<T>(object instance, string name) where T : class =>
        instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) as T;

    private void InstallContextButton()
    {
        if (_window.FindName("CommandButton") is not Button commandButton
            || commandButton.Parent is not Panel host)
        {
            return;
        }

        if (host.Children.OfType<Button>().Any(button => Equals(button.Tag, "productivity-context")))
            return;

        var button = new Button
        {
            Tag = "productivity-context",
            ToolTip = "当前项目上下文 · 配置命令、常用文件、会话恢复和关联文献",
            Width = 34,
            Height = 32,
            Margin = new Thickness(4, 0, 0, 0),
            Padding = new Thickness(0),
            Background = Brushes.Transparent,
            BorderBrush = new SolidColorBrush(Color.FromRgb(214, 222, 233)),
            BorderThickness = new Thickness(1),
            Content = new TextBlock
            {
                Text = "◎",
                FontSize = 17,
                Foreground = new SolidColorBrush(Color.FromRgb(74, 101, 137)),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            }
        };
        button.Click += (_, _) => OpenCurrentProjectEditor();
        host.Children.Add(button);
    }

    private void InstallZoteroProjectLinkButton()
    {
        if (_zotero.FindName("CopyDoiButton") is not Button copyDoi
            || copyDoi.Parent is not Panel host)
        {
            return;
        }

        if (host.Children.OfType<Button>().Any(button => Equals(button.Tag, "link-project-context")))
            return;

        var button = new Button
        {
            Tag = "link-project-context",
            Content = "关联项目",
            ToolTip = "将当前文献关联到项目；只写入 AtlasDesk，不修改 Zotero",
            Height = 29,
            MinWidth = 76,
            Padding = new Thickness(9, 0, 9, 0),
            Margin = new Thickness(6, 0, 0, 0),
            Background = Brushes.White,
            Foreground = new SolidColorBrush(Color.FromRgb(62, 81, 105)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(205, 215, 228)),
            BorderThickness = new Thickness(1)
        };
        button.Click += (_, _) => LinkSelectedZoteroRecord();
        host.Children.Add(button);
    }

    private void WireNavigationTracking()
    {
        foreach (var name in NavigationMap.Values)
        {
            if (_window.FindName(name) is not RadioButton navigation)
                continue;
            navigation.Checked += (_, _) =>
            {
                if (_restoreInProgress)
                    return;
                _state.Session.LastView = NavigationMap.FirstOrDefault(pair => pair.Value == name).Key ?? "home";
            };
        }
    }

    private async Task ExecuteAsync(GlobalSearchResult result)
    {
        try
        {
            switch (result.Action)
            {
                case "context-edit-current":
                    OpenProjectEditor(result.Target);
                    break;
                case "context-toggle-restore":
                    _state.RestoreLastSession = !_state.RestoreLastSession;
                    ProductivityContextStore.Save(_state);
                    MessageBox.Show(
                        _window,
                        _state.RestoreLastSession
                            ? "已开启工作会话恢复。下次仅恢复页面、项目和文件位置，不会重新执行终端命令。"
                            : "已关闭自动工作会话恢复。仍可从 Command Center 手动恢复。",
                        "AtlasDesk 会话恢复",
                        MessageBoxButton.OK,
                        MessageBoxImage.Information);
                    break;
                case "context-restore-session":
                    await RestoreSessionAsync(manual: true);
                    break;
                case "context-open-project":
                    await OpenProjectAsync(result.Target);
                    break;
                case "context-open-terminal":
                    await OpenProjectTerminalAsync(result.Payload as ProjectContextProfile
                                                   ?? ProductivityContextStore.FindProfile(_state, result.Target)
                                                   ?? ProductivityContextStore.GetOrCreateProfile(_state, result.Target));
                    break;
                case "context-open-dashboard":
                    OpenDashboard(result.Target);
                    break;
                case "context-run-command":
                    if (result.Payload is ProjectContextCommandInvocation invocation)
                        await RunProjectCommandAsync(invocation);
                    break;
                case "context-open-favorite":
                    await OpenWorkspacePathAsync(result.Target);
                    break;
                case "context-open-research":
                    if (result.Payload is ProjectResearchInvocation research)
                        await OpenResearchAsync(research);
                    else
                        await LocateZoteroAsync(result.Target);
                    break;
            }
        }
        catch (Exception ex)
        {
            App.Log("Productivity context action failed: " + ex);
            MessageBox.Show(
                _window,
                "无法完成该上下文操作：\n\n" + ex.Message,
                "AtlasDesk",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
    }

    private void OpenCurrentProjectEditor()
    {
        _state = ProductivityContextStore.Load();
        var root = ResolveCurrentProjectRoot();
        OpenProjectEditor(root);
    }

    private void OpenProjectEditor(string? requestedRoot)
    {
        _state = ProductivityContextStore.Load();
        var root = Directory.Exists(requestedRoot)
            ? requestedRoot!
            : ResolveCurrentProjectRoot();
        if (!Directory.Exists(root))
        {
            MessageBox.Show(
                _window,
                "请先在项目中心选择一个项目，或在工作区打开一个有效目录。",
                "项目上下文",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            return;
        }

        var profile = ProductivityContextStore.GetOrCreateProfile(_state, root);
        profile.UpdatedUtc = DateTime.UtcNow;
        _state.Session.ProjectRoot = root;
        ProductivityContextStore.Save(_state);
        var dialog = new ProjectContextWindow(_state, profile) { Owner = _window };
        dialog.ShowDialog();
        _state = ProductivityContextStore.Load();
    }

    private string ResolveCurrentProjectRoot()
    {
        var selected = _pipeline.ProjectWorkflow.SelectedProject;
        if (selected is not null && Directory.Exists(selected.RootPath))
            return selected.RootPath;
        if (Directory.Exists(_workspace.CurrentDirectory))
            return _workspace.CurrentDirectory;
        return ProductivityContextStore.ResolveCurrentProjectRoot(_state, _pipeline.Settings);
    }

    private async Task OpenProjectAsync(string root)
    {
        if (!Directory.Exists(root))
            throw new DirectoryNotFoundException("项目目录不存在：" + root);
        _state.Session.ProjectRoot = root;
        _state.Session.LastView = "workspace";
        ProductivityContextStore.Save(_state);
        await OpenWorkspacePathAsync(root);
    }

    private async Task OpenWorkspacePathAsync(string path)
    {
        if (!Directory.Exists(path) && !File.Exists(path))
            throw new FileNotFoundException("文件或目录不存在。", path);
        NavigateTo("workspace");
        await _window.Dispatcher.InvokeAsync(() => { }, DispatcherPriority.Loaded);
        await _workspace.OpenFromGlobalSearchAsync(path);
        _state.Session.WorkspacePath = path;
        ProductivityContextStore.Save(_state);
    }

    private async Task OpenProjectTerminalAsync(ProjectContextProfile profile)
    {
        if (!Directory.Exists(profile.ProjectRoot))
            throw new DirectoryNotFoundException("项目目录不存在：" + profile.ProjectRoot);
        ShowTerminalPage();
        await _pipeline.WorkspaceTerminal.OpenProjectTerminalAsync(profile.ProjectRoot, profile.EffectiveName);
        _state.Session.ProjectRoot = profile.ProjectRoot;
        _state.Session.LastView = "development";
        ProductivityContextStore.Save(_state);
    }

    private async Task RunProjectCommandAsync(ProjectContextCommandInvocation invocation)
    {
        var profile = invocation.Profile;
        var command = invocation.Command;
        if (!Directory.Exists(profile.ProjectRoot))
            throw new DirectoryNotFoundException("项目目录不存在：" + profile.ProjectRoot);
        if (string.IsNullOrWhiteSpace(command.Command))
            return;

        var workingDirectory = ResolveWorkingDirectory(profile.ProjectRoot, command.WorkingDirectory);
        var baseSpec = WorkspaceTerminalFactory.Create(
            _pipeline.Settings,
            profile.DefaultShell,
            workingDirectory,
            string.IsNullOrWhiteSpace(command.Name) ? profile.EffectiveName : command.Name);
        var spec = new TerminalLaunchSpec
        {
            Title = baseSpec.Title,
            Executable = baseSpec.Executable,
            Arguments = baseSpec.Arguments,
            WorkingDirectory = baseSpec.WorkingDirectory,
            InitialInput = baseSpec.InitialInput + command.Command.Trim() + "\r"
        };
        ShowTerminalPage();
        await _terminal.OpenAsync(spec);
        _state.Session.ProjectRoot = profile.ProjectRoot;
        _state.Session.LastView = "development";
        ProductivityContextStore.Save(_state);
    }

    private static string ResolveWorkingDirectory(string projectRoot, string configured)
    {
        if (string.IsNullOrWhiteSpace(configured))
            return projectRoot;
        try
        {
            var candidate = Path.IsPathRooted(configured)
                ? Path.GetFullPath(configured)
                : Path.GetFullPath(Path.Combine(projectRoot, configured));
            return Directory.Exists(candidate) ? candidate : projectRoot;
        }
        catch
        {
            return projectRoot;
        }
    }

    private void ShowTerminalPage()
    {
        var method = _pipeline.ProjectWorkflow.GetType()
            .GetMethod("ShowTerminalPage", BindingFlags.Instance | BindingFlags.NonPublic);
        method?.Invoke(_pipeline.ProjectWorkflow, null);
    }

    private static void OpenDashboard(string target)
    {
        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https"))
        {
            throw new InvalidOperationException("项目 Dashboard 地址无效。");
        }
        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    private async Task OpenResearchAsync(ProjectResearchInvocation invocation)
    {
        _state.Session.ProjectRoot = invocation.Profile.ProjectRoot;
        _state.Session.ZoteroQuery = invocation.Link.Title;
        ProductivityContextStore.Save(_state);
        await LocateZoteroAsync(invocation.Link.Title);
    }

    private async Task LocateZoteroAsync(string query)
    {
        NavigateTo("library");
        await _window.Dispatcher.InvokeAsync(() => { }, DispatcherPriority.Loaded);
        await _zotero.ApplyExternalSearchAsync(query);
    }

    private void LinkSelectedZoteroRecord()
    {
        var record = _zotero.SelectedRecord;
        if (record is null)
        {
            MessageBox.Show(
                _window,
                "请先在资料库中选择一篇文献。",
                "关联项目",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            return;
        }

        _state = ProductivityContextStore.Load();
        var root = ResolveCurrentProjectRoot();
        if (!Directory.Exists(root))
        {
            MessageBox.Show(
                _window,
                "当前没有有效项目。请先在项目中心选择项目，或打开项目工作区。",
                "关联项目",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            return;
        }

        var profile = ProductivityContextStore.GetOrCreateProfile(_state, root);
        profile.ResearchLinks.RemoveAll(link => link.ItemId == record.ItemId
                                                || (!string.IsNullOrWhiteSpace(link.ItemKey)
                                                    && string.Equals(link.ItemKey, record.Key, StringComparison.OrdinalIgnoreCase)));
        profile.ResearchLinks.Insert(0, new ProjectResearchLink
        {
            ItemId = record.ItemId,
            ItemKey = record.Key,
            CitationKey = _zotero.CurrentCitationKey,
            Title = record.DisplayTitle,
            Doi = record.Doi,
            PdfPath = record.ResolvedPdfPath,
            LinkedUtc = DateTime.UtcNow
        });
        profile.UpdatedUtc = DateTime.UtcNow;
        _state.Session.ProjectRoot = root;
        _state.Session.ZoteroQuery = record.Title;
        ProductivityContextStore.Save(_state);
        MessageBox.Show(
            _window,
            "已关联到项目：" + profile.EffectiveName + "\n\n" + record.DisplayTitle
            + "\n\n关联信息只保存在 AtlasDesk，Zotero 数据库没有被修改。",
            "关联项目",
            MessageBoxButton.OK,
            MessageBoxImage.Information);
    }

    private async Task RestoreSessionAsync(bool manual)
    {
        if (_restoreInProgress || _disposed)
            return;
        _state = ProductivityContextStore.Load();
        if (!manual && (!_state.RestoreLastSession || App.IsSafeMode))
            return;
        var session = _state.Session;
        if (session.SavedAtUtc == default
            && string.IsNullOrWhiteSpace(session.WorkspacePath)
            && string.IsNullOrWhiteSpace(session.ProjectRoot)
            && string.IsNullOrWhiteSpace(session.ZoteroQuery))
        {
            if (manual)
            {
                MessageBox.Show(
                    _window,
                    "尚无可恢复的工作会话。",
                    "AtlasDesk 会话恢复",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
            }
            return;
        }

        try
        {
            _restoreInProgress = true;
            var view = NavigationMap.ContainsKey(session.LastView) ? session.LastView : "home";
            NavigateTo(view);
            await _window.Dispatcher.InvokeAsync(() => { }, DispatcherPriority.Loaded);

            if (view == "workspace")
            {
                var path = File.Exists(session.WorkspacePath) || Directory.Exists(session.WorkspacePath)
                    ? session.WorkspacePath
                    : Directory.Exists(session.ProjectRoot)
                        ? session.ProjectRoot
                        : string.Empty;
                if (!string.IsNullOrWhiteSpace(path))
                    await _workspace.OpenFromGlobalSearchAsync(path);
            }
            else if (view == "library" && !string.IsNullOrWhiteSpace(session.ZoteroQuery))
            {
                await _zotero.ApplyExternalSearchAsync(session.ZoteroQuery);
            }

            if (manual)
            {
                MessageBox.Show(
                    _window,
                    "已恢复上次页面与可用上下文。终端命令不会自动重新执行。",
                    "AtlasDesk 会话恢复",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
            }
        }
        catch (Exception ex)
        {
            App.Log("Restore productivity session failed: " + ex);
            if (manual)
            {
                MessageBox.Show(
                    _window,
                    "会话只恢复了可用部分：\n\n" + ex.Message,
                    "AtlasDesk 会话恢复",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning);
            }
        }
        finally
        {
            _restoreInProgress = false;
        }
    }

    private void Window_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        try
        {
            _state = ProductivityContextStore.Load();
            _state.Session.LastView = GetCurrentView();
            var selected = _pipeline.ProjectWorkflow.SelectedProject;
            if (selected is not null && Directory.Exists(selected.RootPath))
                _state.Session.ProjectRoot = selected.RootPath;
            else
            {
                var root = ResolveCurrentProjectRoot();
                if (Directory.Exists(root))
                    _state.Session.ProjectRoot = root;
            }

            var workspacePath = File.Exists(_pipeline.Settings.LastWorkspaceFile)
                ? _pipeline.Settings.LastWorkspaceFile
                : Directory.Exists(_workspace.CurrentDirectory)
                    ? _workspace.CurrentDirectory
                    : string.Empty;
            _state.Session.WorkspacePath = workspacePath;
            _state.Session.ZoteroQuery = _zotero.CurrentSearchQuery;
            _state.Session.SavedAtUtc = DateTime.UtcNow;
            ProductivityContextStore.Save(_state);
        }
        catch (Exception ex)
        {
            App.Log("Save productivity session failed: " + ex);
        }
    }

    private string GetCurrentView()
    {
        foreach (var pair in NavigationMap)
        {
            if (_window.FindName(pair.Value) is RadioButton { IsChecked: true })
                return pair.Key;
        }
        return "home";
    }

    private void NavigateTo(string target)
    {
        if (NavigationMap.TryGetValue(target, out var name)
            && _window.FindName(name) is RadioButton navigation)
        {
            navigation.IsChecked = true;
        }
    }

    private void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _window.Closing -= Window_Closing;
    }

    private static readonly IReadOnlyDictionary<string, string> NavigationMap =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["home"] = "HomeNav",
            ["dashboard"] = "DashboardNav",
            ["workspace"] = "WorkspaceNav",
            ["library"] = "LibraryNav",
            ["development"] = "DevelopmentNav",
            ["tools"] = "ToolsNav",
            ["tasks"] = "TasksNav",
            ["settings"] = "SettingsNav"
        };
}
