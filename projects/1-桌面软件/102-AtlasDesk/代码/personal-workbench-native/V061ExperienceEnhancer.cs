using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace PersonalWorkbench;

public sealed class V061ExperienceEnhancer
{
    private readonly MainWindow _window;
    private readonly WorkbenchEnhancer _baseEnhancer;
    private readonly AppSettings _settings;
    private readonly WorkspaceControl _workspace;
    private readonly ZoteroLibraryControl _zotero;
    private readonly TerminalDrawerControl _terminal;
    private readonly SettingsControl _settingsControl;
    private readonly HomeDashboardControl _home;
    private GlobalSearchWindow? _searchWindow;

    private V061ExperienceEnhancer(MainWindow window, WorkbenchEnhancer baseEnhancer)
    {
        _window = window;
        _baseEnhancer = baseEnhancer;
        _settings = ReadField<AppSettings>(baseEnhancer, "_settings") ?? AppSettings.Load();
        _workspace = ReadField<WorkspaceControl>(baseEnhancer, "_workspace")
                     ?? throw new InvalidOperationException("Workspace module is unavailable.");
        _zotero = ReadField<ZoteroLibraryControl>(baseEnhancer, "_zotero")
                  ?? throw new InvalidOperationException("Zotero module is unavailable.");
        _terminal = ReadField<TerminalDrawerControl>(baseEnhancer, "_terminal")
                    ?? throw new InvalidOperationException("Terminal module is unavailable.");
        _settingsControl = ReadField<SettingsControl>(baseEnhancer, "_settingsControl")
                           ?? throw new InvalidOperationException("Settings module is unavailable.");
        _home = new HomeDashboardControl(_settings);

        _window.Title = "AtlasDesk";
        InstallHome();
        InstallSearchEntry();
        WireEvents();
        _ = _home.RefreshAsync();
    }

    public static V061ExperienceEnhancer Attach(MainWindow window, WorkbenchEnhancer baseEnhancer)
        => new(window, baseEnhancer);

    public HomeDashboardControl Home => _home;
    public SettingsControl SettingsPage => _settingsControl;

    private static T? ReadField<T>(object instance, string name) where T : class
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) as T;

    private void InstallHome()
    {
        var host = _window.FindName("HomeView");
        if (host is null) return;
        DetachFromCurrentParent(_home);

        switch (host)
        {
            case Panel panel:
                panel.Children.Clear();
                panel.Children.Add(_home);
                break;
            case ContentControl content:
                content.Content = _home;
                break;
            default:
                throw new InvalidOperationException(
                    "HomeView must be a Panel or ContentControl, but was " + host.GetType().Name + ".");
        }
    }

    private static void DetachFromCurrentParent(FrameworkElement element)
    {
        switch (element.Parent)
        {
            case Panel panel:
                panel.Children.Remove(element);
                break;
            case ContentControl content when ReferenceEquals(content.Content, element):
                content.Content = null;
                break;
            case Decorator decorator when ReferenceEquals(decorator.Child, element):
                decorator.Child = null;
                break;
        }
    }

    private void InstallSearchEntry()
    {
        if (_window.FindName("CommandButton") is not Button commandButton) return;
        commandButton.ToolTip = "Ctrl+K · 搜索页面、当前项目、文件、命令和文献";
        commandButton.PreviewMouseLeftButtonDown += (_, args) =>
        {
            args.Handled = true;
            OpenGlobalSearch();
        };
        commandButton.PreviewKeyDown += (_, args) =>
        {
            if (args.Key is not (Key.Enter or Key.Space)) return;
            args.Handled = true;
            OpenGlobalSearch();
        };
    }

    private void WireEvents()
    {
        GlobalShortcutBootstrap.SearchRequested += GlobalShortcut_SearchRequested;
        _home.NavigateRequested += (_, args) => NavigateTo(args.Target);
        _home.GlobalSearchRequested += (_, _) => OpenGlobalSearch();
        _home.TerminalRequested += async (_, _) => await OpenTerminalAsync(_settings.DefaultShell, "工作台终端");
        _home.RecentFileRequested += async (_, args) => await OpenWorkspaceItemAsync(args.Path);
        _settingsControl.SettingsSaved += async (_, _) => await _home.RefreshAsync();
        _window.Closed += (_, _) => GlobalShortcutBootstrap.SearchRequested -= GlobalShortcut_SearchRequested;
    }

    private void GlobalShortcut_SearchRequested(object? sender, EventArgs e)
    {
        if (_window.IsActive || _window.IsKeyboardFocusWithin)
            _window.Dispatcher.BeginInvoke(() => OpenGlobalSearch());
    }

    private void OpenGlobalSearch()
    {
        if (_searchWindow is { IsVisible: true })
        {
            _searchWindow.Activate();
            _searchWindow.Focus();
            return;
        }
        _searchWindow = new GlobalSearchWindow(_settings) { Owner = _window };
        _searchWindow.ResultInvoked += async (_, args) => await ExecuteSearchResultAsync(args.Result);
        _searchWindow.Closed += (_, _) => _searchWindow = null;
        _searchWindow.Show();
    }

    private async Task ExecuteSearchResultAsync(GlobalSearchResult result)
    {
        if (await ProductivityContextCoordinator.TryExecuteAsync(_window, result))
            return;

        switch (result.Action)
        {
            case "navigate":
                NavigateTo(result.Target);
                break;
            case "new-terminal":
                await OpenTerminalAsync(result.Target, result.Title);
                break;
            case "open-root":
                if (!OpenExternal(_settings.WorkspaceRoot)) NavigateTo("settings");
                break;
            case "open-config":
            case "open-logs":
                OpenExternal(result.Target);
                break;
            case "refresh-home":
                NavigateTo("home");
                await _home.RefreshAsync();
                break;
            case "workspace-item":
            case "project-item":
                await OpenWorkspaceItemAsync(result.Target);
                break;
            case "task-item":
                NavigateTo("tasks");
                break;
            case "zotero-item":
                NavigateTo("library");
                if (result.Payload is ZoteroRecord paper)
                    await _zotero.ApplyExternalSearchAsync(paper.Title);
                break;
        }
    }

    private async Task OpenWorkspaceItemAsync(string path)
    {
        NavigateTo("workspace");
        await _window.Dispatcher.InvokeAsync(() => { }, System.Windows.Threading.DispatcherPriority.Loaded);
        await _workspace.OpenFromGlobalSearchAsync(path);
    }

    private async Task OpenTerminalAsync(string shell, string title)
    {
        InvokeBase("ShowTerminal");
        var directory = Directory.Exists(_workspace.CurrentDirectory)
            ? _workspace.CurrentDirectory
            : Directory.Exists(_settings.WorkspaceRoot)
                ? _settings.WorkspaceRoot
                : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        await _terminal.OpenAsync(WorkspaceTerminalFactory.Create(_settings, shell, directory, title));
    }

    private void NavigateTo(string target)
    {
        var name = target switch
        {
            "home" => "HomeNav",
            "workspace" => "WorkspaceNav",
            "library" => "LibraryNav",
            "development" => "DevelopmentNav",
            "tools" => "ToolsNav",
            "dashboard" => "DashboardNav",
            "tasks" => "TasksNav",
            "settings" => "SettingsNav",
            _ => string.Empty
        };
        if (!string.IsNullOrWhiteSpace(name) && _window.FindName(name) is RadioButton radio)
            radio.IsChecked = true;
    }

    private bool OpenExternal(string path)
    {
        try
        {
            if (!Directory.Exists(path) && !File.Exists(path)) return false;
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            return true;
        }
        catch (Exception ex)
        {
            App.Log("Open external path failed: " + ex.Message);
            return false;
        }
    }

    private void InvokeBase(string method)
    {
        try
        {
            _baseEnhancer.GetType().GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(_baseEnhancer, null);
        }
        catch (Exception ex) { App.Log("Invoke base enhancer failed: " + ex.Message); }
    }
}
