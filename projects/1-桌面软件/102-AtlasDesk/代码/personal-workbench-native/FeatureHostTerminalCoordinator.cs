using System.Reflection;
using System.Windows;
using System.Windows.Controls;

namespace PersonalWorkbench;

/// <summary>
/// Long-term owner for the Library/Development feature hosts and the global
/// bottom terminal placement. This replaces the v0.6.9 hotfix layer without
/// changing the current visual surface or terminal session model.
/// </summary>
public sealed class FeatureHostTerminalCoordinator
{
    private readonly MainWindow _window;
    private readonly WorkbenchEnhancer _shell;
    private readonly WorkspaceControl _workspace;
    private readonly ZoteroLibraryControl _zotero;
    private readonly DevelopmentControl _development;
    private readonly TerminalDrawerControl _terminal;
    private readonly Grid _bottomShell;
    private readonly int _bottomTerminalRowIndex;
    private Button? _topTerminalButton;
    private bool _movingTerminal;

    private FeatureHostTerminalCoordinator(MainWindow window, WorkbenchFeaturePipeline pipeline)
    {
        _window = window;
        _shell = pipeline.Base;
        _workspace = ReadField<WorkspaceControl>(_shell, "_workspace")
                     ?? throw new InvalidOperationException("Workspace module is unavailable.");
        _zotero = ReadField<ZoteroLibraryControl>(_shell, "_zotero")
                  ?? throw new InvalidOperationException("Zotero module is unavailable.");
        _development = ReadField<DevelopmentControl>(_shell, "_development")
                       ?? throw new InvalidOperationException("Development module is unavailable.");
        _terminal = ReadField<TerminalDrawerControl>(_shell, "_terminal")
                    ?? throw new InvalidOperationException("Terminal module is unavailable.");
        _bottomShell = _terminal.Parent as Grid
                       ?? throw new InvalidOperationException("Terminal shell is unavailable.");
        _bottomTerminalRowIndex = Grid.GetRow(_terminal);

        NormalizeFeatureHosts();
        LocateTopTerminalButton();
        WireTerminalLifecycle();

        if (_window.IsLoaded)
            _window.Dispatcher.BeginInvoke(async () => await SynchronizeForCurrentPageAsync());
        else
            _window.Loaded += async (_, _) => await SynchronizeForCurrentPageAsync();
    }

    public static FeatureHostTerminalCoordinator Attach(MainWindow window, WorkbenchFeaturePipeline pipeline)
        => new(window, pipeline);

    private static T? ReadField<T>(object instance, string name) where T : class
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) as T;

    private void NormalizeFeatureHosts()
    {
        if (_window.FindName("LibraryView") is Grid library)
        {
            library.Children.Clear();
            library.RowDefinitions.Clear();
            library.ColumnDefinitions.Clear();
            library.Margin = new Thickness(0);
            _zotero.HorizontalAlignment = HorizontalAlignment.Stretch;
            _zotero.VerticalAlignment = VerticalAlignment.Stretch;
            library.Children.Add(_zotero);
        }

        if (_window.FindName("DevelopmentView") is Grid development)
        {
            development.Children.Clear();
            development.RowDefinitions.Clear();
            development.ColumnDefinitions.Clear();
            development.Margin = new Thickness(0);
            _development.HorizontalAlignment = HorizontalAlignment.Stretch;
            _development.VerticalAlignment = VerticalAlignment.Stretch;
            _development.Visibility = Visibility.Visible;
            development.Children.Add(_development);
        }

        _terminal.SetHostMode(TerminalHostMode.Bottom);
    }

    private void LocateTopTerminalButton()
    {
        if (_window.FindName("PopoutButton") is not Button popout || popout.Parent is not StackPanel actions)
            return;
        _topTerminalButton = actions.Children
            .OfType<Button>()
            .FirstOrDefault(button => button.ToolTip?.ToString()?.Contains("终端", StringComparison.Ordinal) == true);
    }

    private void WireTerminalLifecycle()
    {
        _terminal.DockBottomRequested += (_, _) => DockTerminalBottom(show: _terminal.HasSessions);
        _terminal.EmbedDevelopmentRequested += (_, _) =>
        {
            if (_window.FindName("DevelopmentNav") is RadioButton developmentNav
                && developmentNav.IsChecked != true)
                developmentNav.IsChecked = true;
            DockTerminalBottom(show: true);
        };
        _terminal.SessionCountChanged += (_, _) =>
        {
            if (_terminal.HostMode == TerminalHostMode.Bottom && !_terminal.HasSessions)
                InvokeShell("HideTerminal");
        };

        if (_window.FindName("DevelopmentNav") is RadioButton development)
            development.Checked += async (_, _) => await Development_CheckedAsync();

        foreach (var name in new[]
                 {
                     "HomeNav", "WorkspaceNav", "LibraryNav", "ToolsNav",
                     "DashboardNav", "TasksNav", "SettingsNav"
                 })
        {
            if (_window.FindName(name) is RadioButton navigation)
                navigation.Checked += (_, _) => NonDevelopment_Checked();
        }
    }

    private async Task SynchronizeForCurrentPageAsync()
    {
        if (_window.FindName("DevelopmentNav") is RadioButton development && development.IsChecked == true)
            await Development_CheckedAsync();
        else
            DockTerminalBottom(show: false);
    }

    private async Task Development_CheckedAsync()
    {
        DockTerminalBottom(show: _terminal.HasSessions);
        _development.Visibility = Visibility.Visible;
        await _development.EnsureLoadedAsync();
    }

    private void NonDevelopment_Checked()
    {
        if (_movingTerminal)
            return;
        if (_terminal.HostMode == TerminalHostMode.Development)
            DockTerminalBottom(show: _terminal.HasSessions);
        else
            UpdateTopTerminalButtonVisibility();
    }

    private void DockTerminalBottom(bool show)
    {
        if (_movingTerminal)
            return;
        try
        {
            _movingTerminal = true;
            RemoveFromParent(_terminal);
            if (!_bottomShell.Children.Contains(_terminal))
                _bottomShell.Children.Add(_terminal);
            Grid.SetRow(_terminal, _bottomTerminalRowIndex);
            _terminal.HorizontalAlignment = HorizontalAlignment.Stretch;
            _terminal.VerticalAlignment = VerticalAlignment.Stretch;
            _terminal.SetHostMode(TerminalHostMode.Bottom);
            _development.Visibility = Visibility.Visible;

            if (show && _terminal.HasSessions)
                InvokeShell("ShowTerminal");
            else
                InvokeShell("HideTerminal");
            UpdateTopTerminalButtonVisibility();
        }
        catch (Exception ex)
        {
            App.Log("Feature host terminal synchronization failed: " + ex);
        }
        finally
        {
            _movingTerminal = false;
        }
    }

    private void UpdateTopTerminalButtonVisibility()
    {
        if (_topTerminalButton is not null)
            _topTerminalButton.Visibility = Visibility.Visible;
    }

    private static void RemoveFromParent(FrameworkElement element)
    {
        if (element.Parent is Panel panel)
            panel.Children.Remove(element);
        else if (element.Parent is Decorator decorator)
            decorator.Child = null;
        else if (element.Parent is ContentControl content)
            content.Content = null;
    }

    private void InvokeShell(string method)
    {
        try
        {
            _shell.GetType().GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(_shell, null);
        }
        catch (Exception ex)
        {
            App.Log("Invoke feature-host terminal method failed: " + ex.Message);
        }
    }
}
