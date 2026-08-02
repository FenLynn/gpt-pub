using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace PersonalWorkbench;

/// <summary>
/// Single session-creation owner for workspace, development and project terminal
/// requests. It remembers only the last launch context and never restores a
/// process automatically; reopening always requires an explicit user action.
/// </summary>
public sealed class WorkspaceTerminalCoordinator
{
    private readonly MainWindow _window;
    private readonly WorkbenchFeaturePipeline _pipeline;
    private readonly AppSettings _settings;
    private readonly WorkspaceControl _workspace;
    private readonly DevelopmentControl _development;
    private readonly TerminalDrawerControl _terminal;
    private Button? _topTerminalButton;
    private bool _opening;

    private WorkspaceTerminalCoordinator(MainWindow window, WorkbenchFeaturePipeline pipeline)
    {
        _window = window;
        _pipeline = pipeline;
        _settings = pipeline.Settings;
        _workspace = ReadBaseField<WorkspaceControl>("_workspace")
                     ?? throw new InvalidOperationException("Workspace module is unavailable.");
        _development = ReadBaseField<DevelopmentControl>("_development")
                       ?? throw new InvalidOperationException("Development module is unavailable.");
        _terminal = ReadBaseField<TerminalDrawerControl>("_terminal")
                    ?? throw new InvalidOperationException("Terminal module is unavailable.");

        _workspace.OpenTerminalRequested += Workspace_OpenTerminalRequested;
        _development.OpenTerminalRequested += Development_OpenTerminalRequested;
        _window.AddHandler(
            Keyboard.PreviewKeyDownEvent,
            new KeyEventHandler(Window_PreviewKeyDown),
            handledEventsToo: true);
        LocateTopTerminalButton();
    }

    public static WorkspaceTerminalCoordinator Attach(MainWindow window, WorkbenchFeaturePipeline pipeline)
        => new(window, pipeline);

    private T? ReadBaseField<T>(string name) where T : class
        => _pipeline.Base.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)
            ?.GetValue(_pipeline.Base) as T;

    private async void Workspace_OpenTerminalRequested(object? sender, TerminalOpenRequestEventArgs e)
    {
        var directory = string.IsNullOrWhiteSpace(e.WorkingDirectory)
            ? _workspace.CurrentDirectory
            : e.WorkingDirectory;
        await OpenWorkspaceTerminalAsync(e.Shell, directory, e.Title);
    }

    private async void Development_OpenTerminalRequested(object? sender, TerminalOpenRequestEventArgs e)
    {
        if (e.Environment is null && !string.IsNullOrWhiteSpace(e.WorkingDirectory))
        {
            await OpenWorkspaceTerminalAsync(e.Shell, e.WorkingDirectory, e.Title);
            return;
        }

        var spec = TerminalLaunchSpec.Create(_settings, e.Shell, e.Environment, e.Title);
        await OpenRememberedAsync(spec, NormalizeShell(e.Shell));
    }

    public Task OpenProjectTerminalAsync(string rootPath, string? title = null)
        => OpenWorkspaceTerminalAsync(_settings.DefaultShell, rootPath, title);

    public async Task OpenDefaultAsync()
    {
        var directory = Directory.Exists(_workspace.CurrentDirectory)
            ? _workspace.CurrentDirectory
            : _settings.WorkspaceRoot;
        await OpenWorkspaceTerminalAsync(_settings.DefaultShell, directory, null);
    }

    public async Task ReopenLastAsync()
    {
        if (string.IsNullOrWhiteSpace(_settings.LastTerminalShell))
        {
            App.Log("Reopen last terminal ignored: no remembered terminal context");
            return;
        }

        var directory = Directory.Exists(_settings.LastTerminalWorkingDirectory)
            ? _settings.LastTerminalWorkingDirectory
            : Directory.Exists(_settings.WorkspaceRoot)
                ? _settings.WorkspaceRoot
                : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var spec = WorkspaceTerminalFactory.Create(
            _settings,
            _settings.LastTerminalShell,
            directory,
            string.IsNullOrWhiteSpace(_settings.LastTerminalTitle)
                ? "最近终端"
                : _settings.LastTerminalTitle);
        await OpenRememberedAsync(spec, _settings.LastTerminalShell);
    }

    private Task OpenWorkspaceTerminalAsync(string shell, string workingDirectory, string? title)
    {
        var spec = WorkspaceTerminalFactory.Create(_settings, shell, workingDirectory, title);
        return OpenRememberedAsync(spec, NormalizeShell(shell));
    }

    private async Task OpenRememberedAsync(TerminalLaunchSpec spec, string shell)
    {
        if (_opening)
            return;
        try
        {
            _opening = true;
            ShowTerminalHost();
            Remember(spec, shell);
            await _terminal.OpenAsync(spec);
        }
        catch (Exception ex)
        {
            App.Log("Workspace terminal continuity open failed: " + ex);
            MessageBox.Show(
                "无法打开终端：\n" + ex.Message,
                ProductIdentity.ProductName,
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
        finally
        {
            _opening = false;
        }
    }

    private void Remember(TerminalLaunchSpec spec, string shell)
    {
        _settings.LastTerminalShell = shell;
        _settings.LastTerminalWorkingDirectory = Directory.Exists(spec.WorkingDirectory)
            ? spec.WorkingDirectory
            : string.Empty;
        _settings.LastTerminalTitle = spec.Title;
        _settings.Save();
    }

    private void ShowTerminalHost()
    {
        try
        {
            _pipeline.Base.GetType()
                .GetMethod("ShowTerminal", BindingFlags.Instance | BindingFlags.NonPublic)
                ?.Invoke(_pipeline.Base, null);
        }
        catch (Exception ex)
        {
            App.Log("Show terminal host failed: " + ex.Message);
        }
    }

    private async void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        var modifiers = Keyboard.Modifiers;
        if (e.Key == Key.T
            && modifiers.HasFlag(ModifierKeys.Control)
            && modifiers.HasFlag(ModifierKeys.Shift))
        {
            e.Handled = true;
            await OpenDefaultAsync();
        }
        else if (e.Key == Key.R
                 && modifiers.HasFlag(ModifierKeys.Control)
                 && modifiers.HasFlag(ModifierKeys.Shift))
        {
            e.Handled = true;
            await ReopenLastAsync();
        }
    }

    private void LocateTopTerminalButton()
    {
        if (_window.FindName("PopoutButton") is not Button popout || popout.Parent is not StackPanel actions)
            return;
        _topTerminalButton = actions.Children
            .OfType<Button>()
            .FirstOrDefault(button => button.ToolTip?.ToString()?.Contains("终端", StringComparison.Ordinal) == true);
        if (_topTerminalButton is not null)
            _topTerminalButton.ToolTip = "显示终端（Ctrl+`） · 新建 Ctrl+Shift+T · 重开最近 Ctrl+Shift+R";
    }

    private static string NormalizeShell(string shell)
        => string.Equals(shell, "cmd", StringComparison.OrdinalIgnoreCase) ? "cmd" : "powershell";
}
