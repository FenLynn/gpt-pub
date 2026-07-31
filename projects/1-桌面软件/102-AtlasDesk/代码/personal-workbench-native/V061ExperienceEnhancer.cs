using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;

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

        InstallHome();
        InstallSearchEntry();
        WireEvents();
        _ = _home.RefreshAsync();
    }

    public static V061ExperienceEnhancer Attach(MainWindow window, WorkbenchEnhancer baseEnhancer)
        => new(window, baseEnhancer);

    private static T? ReadField<T>(object instance, string name) where T : class
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) as T;

    private void InstallHome()
    {
        if (_window.FindName("HomeView") is not Panel homeView) return;
        homeView.Children.Clear();
        homeView.Children.Add(_home);
    }

    private void InstallSearchEntry()
    {
        if (_window.FindName("CommandButton") is not Button commandButton) return;
        commandButton.ToolTip = "全局搜索页面、工作区文件、Zotero 文献和命令";
        commandButton.PreviewMouseLeftButtonDown += (_, args) =>
        {
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
            return;
        }
        _searchWindow = new GlobalSearchWindow(_settings) { Owner = _window };
        _searchWindow.ResultInvoked += async (_, args) => await ExecuteSearchResultAsync(args.Result);
        _searchWindow.Closed += (_, _) => _searchWindow = null;
        _searchWindow.Show();
    }

    private async Task ExecuteSearchResultAsync(GlobalSearchResult result)
    {
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
            case "refresh-home":
                NavigateTo("home");
                await _home.RefreshAsync();
                break;
            case "workspace-item":
                await OpenWorkspaceItemAsync(result.Target);
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
