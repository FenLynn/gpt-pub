using System.Reflection;
using System.Windows;
using System.Windows.Controls;

namespace PersonalWorkbench;

/// <summary>
/// v0.6.9 corrective layer. It deliberately repairs only the three areas
/// reported against v0.6.8: feature-host sizing, terminal placement, and the
/// transition between the development canvas and the global bottom drawer.
/// </summary>
public sealed class V068HotfixEnhancer
{
    private readonly MainWindow _window;
    private readonly WorkbenchFeaturePipeline _pipeline;
    private readonly WorkbenchEnhancer _base;
    private readonly AppSettings _settings;
    private readonly WorkspaceControl _workspace;
    private readonly ZoteroLibraryControl _zotero;
    private readonly DevelopmentControl _development;
    private readonly TerminalDrawerControl _terminal;
    private readonly Grid _bottomShell;
    private readonly RowDefinition _terminalSplitterRow;
    private readonly RowDefinition _terminalRow;
    private readonly GridSplitter _splitter;
    private readonly int _bottomTerminalRowIndex;
    private readonly Grid _developmentStage = new();
    private Button? _topTerminalButton;
    private bool _preferBottomDock;
    private bool _movingTerminal;

    private V068HotfixEnhancer(MainWindow window, WorkbenchFeaturePipeline pipeline)
    {
        _window = window;
        _pipeline = pipeline;
        _base = pipeline.Base;
        _settings = pipeline.Settings;
        _workspace = ReadField<WorkspaceControl>(_base, "_workspace")
                     ?? throw new InvalidOperationException("Workspace module is unavailable.");
        _zotero = ReadField<ZoteroLibraryControl>(_base, "_zotero")
                  ?? throw new InvalidOperationException("Zotero module is unavailable.");
        _development = ReadField<DevelopmentControl>(_base, "_development")
                       ?? throw new InvalidOperationException("Development module is unavailable.");
        _terminal = ReadField<TerminalDrawerControl>(_base, "_terminal")
                    ?? throw new InvalidOperationException("Terminal module is unavailable.");
        _terminalSplitterRow = ReadField<RowDefinition>(_base, "_terminalSplitterRow")
                               ?? throw new InvalidOperationException("Terminal splitter row is unavailable.");
        _terminalRow = ReadField<RowDefinition>(_base, "_terminalRow")
                       ?? throw new InvalidOperationException("Terminal row is unavailable.");
        _splitter = ReadField<GridSplitter>(_base, "_splitter")
                    ?? throw new InvalidOperationException("Terminal splitter is unavailable.");
        _bottomShell = _terminal.Parent as Grid
                       ?? throw new InvalidOperationException("Terminal shell is unavailable.");
        _bottomTerminalRowIndex = Grid.GetRow(_terminal);

        RepairFeatureHosts();
        LocateTopTerminalButton();
        WireEvents();

        if (_window.IsLoaded)
            _window.Dispatcher.BeginInvoke(async () => await SynchronizeForCurrentPageAsync());
        else
            _window.Loaded += async (_, _) => await SynchronizeForCurrentPageAsync();
    }

    public static V068HotfixEnhancer Attach(MainWindow window, WorkbenchFeaturePipeline pipeline)
        => new(window, pipeline);

    private static T? ReadField<T>(object instance, string name) where T : class
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) as T;

    private void RepairFeatureHosts()
    {
        // WorkbenchEnhancer replaced the child controls but retained the five legacy
        // row definitions. The new controls therefore landed in row 0 (Auto), which
        // caused the large blank area visible below Zotero and Development.
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
            _developmentStage.HorizontalAlignment = HorizontalAlignment.Stretch;
            _developmentStage.VerticalAlignment = VerticalAlignment.Stretch;
            _development.HorizontalAlignment = HorizontalAlignment.Stretch;
            _development.VerticalAlignment = VerticalAlignment.Stretch;
            _developmentStage.Children.Add(_development);
            development.Children.Add(_developmentStage);
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

    private void WireEvents()
    {
        _terminal.DockBottomRequested += (_, _) =>
        {
            _preferBottomDock = true;
            DockTerminalBottom(show: _terminal.HasSessions);
        };
        _terminal.EmbedDevelopmentRequested += async (_, _) =>
        {
            _preferBottomDock = false;
            if (_window.FindName("DevelopmentNav") is RadioButton developmentNav)
            {
                if (developmentNav.IsChecked != true)
                    developmentNav.IsChecked = true;
                else
                    await EmbedTerminalInDevelopmentAsync(openDefaultSession: true);
            }
        };
        _terminal.SessionCountChanged += (_, _) =>
        {
            if (_terminal.HostMode == TerminalHostMode.Bottom && !_terminal.HasSessions)
                InvokeBase("HideTerminal");
        };

        if (_window.FindName("DevelopmentNav") is RadioButton development)
            development.Checked += async (_, _) => await Development_CheckedAsync();

        foreach (var name in new[] { "HomeNav", "WorkspaceNav", "LibraryNav", "ToolsNav", "DashboardNav", "TasksNav", "SettingsNav" })
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
        if (_preferBottomDock)
        {
            DockTerminalBottom(show: _terminal.HasSessions);
            return;
        }
        await EmbedTerminalInDevelopmentAsync(openDefaultSession: true);
    }

    private void NonDevelopment_Checked()
    {
        if (_movingTerminal) return;
        if (_terminal.HostMode == TerminalHostMode.Development)
            DockTerminalBottom(show: _terminal.HasSessions);
        else
            UpdateTopTerminalButtonVisibility();
    }

    private async Task EmbedTerminalInDevelopmentAsync(bool openDefaultSession)
    {
        if (_movingTerminal) return;
        try
        {
            _movingTerminal = true;
            RemoveFromParent(_terminal);
            HideBottomRows();
            _development.Visibility = Visibility.Collapsed;
            _developmentStage.Children.Add(_terminal);
            Grid.SetRow(_terminal, 0);
            Grid.SetColumn(_terminal, 0);
            _terminal.HorizontalAlignment = HorizontalAlignment.Stretch;
            _terminal.VerticalAlignment = VerticalAlignment.Stretch;
            _terminal.Visibility = Visibility.Visible;
            _terminal.SetHostMode(TerminalHostMode.Development);
            UpdateTopTerminalButtonVisibility();

            if (openDefaultSession && !_terminal.HasSessions)
            {
                if (string.Equals(_settings.DefaultShell, "cmd", StringComparison.OrdinalIgnoreCase))
                    await _terminal.OpenAsync(TerminalReliability.CreateCmd(_settings, "开发终端"));
                else
                    await _terminal.OpenShellAsync(_settings.DefaultShell, title: "开发终端");
            }
        }
        catch (Exception ex)
        {
            App.Log("Embed development terminal failed: " + ex);
            DockTerminalBottom(show: _terminal.HasSessions);
        }
        finally
        {
            _movingTerminal = false;
        }
    }

    private void DockTerminalBottom(bool show)
    {
        if (_movingTerminal) return;
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
                InvokeBase("ShowTerminal");
            else
                InvokeBase("HideTerminal");
            UpdateTopTerminalButtonVisibility();
        }
        catch (Exception ex)
        {
            App.Log("Dock bottom terminal failed: " + ex);
        }
        finally
        {
            _movingTerminal = false;
        }
    }

    private void HideBottomRows()
    {
        _terminalSplitterRow.Height = new GridLength(0);
        _terminalRow.Height = new GridLength(0);
        _splitter.Visibility = Visibility.Collapsed;
        SetBaseField("_terminalVisible", false);
    }

    private void UpdateTopTerminalButtonVisibility()
    {
        if (_topTerminalButton is null) return;
        _topTerminalButton.Visibility = _terminal.HostMode == TerminalHostMode.Development
            ? Visibility.Collapsed
            : Visibility.Visible;
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

    private void InvokeBase(string method)
    {
        try
        {
            _base.GetType().GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(_base, null);
        }
        catch (Exception ex) { App.Log("Invoke terminal host method failed: " + ex.Message); }
    }

    private void SetBaseField(string name, object value)
    {
        try
        {
            _base.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.SetValue(_base, value);
        }
        catch (Exception ex) { App.Log("Set terminal host field failed: " + ex.Message); }
    }
}
