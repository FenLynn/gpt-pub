using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace PersonalWorkbench;

public sealed class WorkbenchEnhancer
{
    private readonly MainWindow _window;
    private readonly AppSettings _settings;
    private readonly ZoteroLibraryControl _zotero;
    private readonly DevelopmentControl _development;
    private readonly SettingsControl _settingsControl;
    private readonly TerminalDrawerControl _terminal;
    private readonly RowDefinition _terminalSplitterRow;
    private readonly RowDefinition _terminalRow;
    private readonly GridSplitter _splitter;
    private bool _terminalVisible;

    private WorkbenchEnhancer(MainWindow window)
    {
        _window = window;
        _settings = ResolveSettings(window);
        _zotero = new ZoteroLibraryControl(_settings);
        _development = new DevelopmentControl(_settings);
        _settingsControl = new SettingsControl(_settings);
        _terminal = new TerminalDrawerControl(_settings);

        ReplaceFeatureViews();
        (_terminalSplitterRow, _terminalRow, _splitter) = InstallTerminalDrawer();
        InstallTopTerminalButton();
        WireEvents();
        SuppressLegacyFeatureLoaders();
        UpdateShellStatus();
    }

    public static WorkbenchEnhancer Attach(MainWindow window) => new(window);

    private static AppSettings ResolveSettings(MainWindow window)
    {
        var field = typeof(MainWindow).GetField("_settings", BindingFlags.Instance | BindingFlags.NonPublic);
        return field?.GetValue(window) as AppSettings ?? AppSettings.Load();
    }

    private void ReplaceFeatureViews()
    {
        if (_window.FindName("LibraryView") is Grid library)
        {
            library.Children.Clear();
            library.Margin = new Thickness(0);
            library.Children.Add(_zotero);
        }
        if (_window.FindName("DevelopmentView") is Grid development)
        {
            development.Children.Clear();
            development.Margin = new Thickness(0);
            development.Children.Add(_development);
        }
        if (_window.FindName("SettingsView") is ScrollViewer settingsView)
            settingsView.Content = _settingsControl;
    }

    private (RowDefinition SplitterRow, RowDefinition TerminalRow, GridSplitter Splitter) InstallTerminalDrawer()
    {
        if (_window.FindName("ContentGrid") is not Grid content || content.Parent is not Grid shell)
            throw new InvalidOperationException("Unable to locate the main shell grid.");

        var splitterRow = new RowDefinition { Height = new GridLength(0) };
        var terminalRow = new RowDefinition { Height = new GridLength(0) };
        shell.RowDefinitions.Add(splitterRow);
        shell.RowDefinitions.Add(terminalRow);

        var splitter = new GridSplitter
        {
            Height = 5, HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Center,
            Background = new SolidColorBrush(Color.FromRgb(198, 209, 223)), ResizeDirection = GridResizeDirection.Rows,
            ResizeBehavior = GridResizeBehavior.PreviousAndNext, Visibility = Visibility.Collapsed
        };
        Grid.SetRow(splitter, shell.RowDefinitions.Count - 2);
        Grid.SetRow(_terminal, shell.RowDefinitions.Count - 1);
        shell.Children.Add(splitter);
        shell.Children.Add(_terminal);
        _terminal.Visibility = Visibility.Collapsed;
        return (splitterRow, terminalRow, splitter);
    }

    private void InstallTopTerminalButton()
    {
        if (_window.FindName("PopoutButton") is not Button popout || popout.Parent is not StackPanel actions)
            return;
        var button = new Button
        {
            Style = Application.Current.TryFindResource("IconButton") as Style,
            ToolTip = "显示或收起终端（Ctrl+`）"
        };
        var viewbox = new Viewbox { Width = 16, Height = 16 };
        viewbox.Child = new System.Windows.Shapes.Path
        {
            Data = Geometry.Parse("M4,5 H20 V19 H4 Z M7,9 L10,12 L7,15 M12,15 H17"),
            Stroke = new SolidColorBrush(Color.FromRgb(95,112,135)), StrokeThickness = 1.8,
            Fill = Brushes.Transparent, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round,
            StrokeLineJoin = PenLineJoin.Round
        };
        button.Content = viewbox;
        button.Click += (_, _) => ToggleTerminal();
        actions.Children.Insert(Math.Max(0, actions.Children.Count - 1), button);
    }

    private void WireEvents()
    {
        _zotero.OpenSettingsRequested += (_, _) => NavigateToSettings();
        _development.OpenTerminalRequested += async (_, args) =>
        {
            ShowTerminal();
            await _terminal.OpenShellAsync(args.Shell, args.Environment, args.Title);
        };
        _settingsControl.SettingsSaved += (_, args) => OnSettingsSaved(args);
        _settingsControl.ClearAccessRequested += (_, _) => InvokeLegacy("ClearSession_Click", _window, new RoutedEventArgs());
        _terminal.CollapseRequested += (_, _) => HideTerminal();
        _window.PreviewKeyDown += Window_PreviewKeyDown;
        _window.Closed += async (_, _) => await _terminal.DisposeAsync();
    }

    private void SuppressLegacyFeatureLoaders()
    {
        SetPrivateField("_zoteroInitialized", true);
        SetPrivateField("_pythonInitialized", true);
    }

    private void OnSettingsSaved(SettingsSavedEventArgs args)
    {
        if (args.ZoteroChanged) _zotero.InvalidateLibrary();
        if (args.PythonChanged) _development.InvalidateEnvironments();
        if (args.TerminalChanged)
        {
            _terminal.ApplySettings();
            if (_terminalVisible) _terminalRow.Height = new GridLength(_settings.TerminalDrawerHeight);
        }
        if (args.DashboardChanged)
        {
            SetPrivateField("_dashboardHasNavigated", false);
            SetPrivateField("_dashboardRootUrl", string.Empty);
        }
        UpdateShellStatus();
    }

    private void UpdateShellStatus()
    {
        if (_window.FindName("UserNameText") is TextBlock userName)
            userName.Text = string.IsNullOrWhiteSpace(_settings.UserName) ? "Fenlynn" : _settings.UserName;
        if (_window.FindName("UserCard") is Border card)
            card.ToolTip = (string.IsNullOrWhiteSpace(_settings.UserName) ? "Fenlynn" : _settings.UserName) + " · 本地工作台";
        if (_window.FindName("HomeZoteroStatus") is TextBlock zoteroStatus)
            zoteroStatus.Text = File.Exists(_settings.ZoteroDbPath)
                ? (_settings.ZoteroLoadFullLibrary ? "已连接 · 全量模式" : $"已连接 · 校准 {_settings.EffectiveZoteroLimit} 条")
                : "等待首次定位";
        if (_window.FindName("HomePythonStatus") is TextBlock pythonStatus)
            pythonStatus.Text = string.IsNullOrWhiteSpace(_settings.CondaPath) && string.IsNullOrWhiteSpace(_settings.UvPath)
                ? "等待首次检测" : "Conda / uv 已配置";
    }

    private void NavigateToSettings()
    {
        _settingsControl.LoadFromSettings();
        if (_window.FindName("SettingsNav") is RadioButton settingsNav)
            settingsNav.IsChecked = true;
    }

    private async void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Oem3 && Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
        {
            ToggleTerminal();
            e.Handled = true;
        }
        else if (e.Key == Key.T && Keyboard.Modifiers.HasFlag(ModifierKeys.Control) && Keyboard.Modifiers.HasFlag(ModifierKeys.Shift))
        {
            ShowTerminal();
            await _terminal.OpenShellAsync(_settings.DefaultShell);
            e.Handled = true;
        }
    }

    private void ToggleTerminal()
    {
        if (_terminalVisible) HideTerminal(); else ShowTerminal();
    }

    private void ShowTerminal()
    {
        _terminalVisible = true;
        _terminal.Visibility = Visibility.Visible;
        _splitter.Visibility = Visibility.Visible;
        _terminalSplitterRow.Height = new GridLength(5);
        _terminalRow.Height = new GridLength(_settings.TerminalDrawerHeight);
    }

    private void HideTerminal()
    {
        _terminalVisible = false;
        _settings.TerminalDrawerHeight = (int)Math.Clamp(_terminal.ActualHeight > 100 ? _terminal.ActualHeight : _settings.TerminalDrawerHeight, 180, 700);
        _settings.Save();
        _terminalRow.Height = new GridLength(0);
        _terminalSplitterRow.Height = new GridLength(0);
        _splitter.Visibility = Visibility.Collapsed;
        _terminal.Visibility = Visibility.Collapsed;
    }

    private void SetPrivateField(string name, object value)
    {
        try { typeof(MainWindow).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.SetValue(_window, value); }
        catch (Exception ex) { App.Log($"Set private field {name} failed: {ex.Message}"); }
    }

    private void InvokeLegacy(string methodName, params object[] args)
    {
        try { typeof(MainWindow).GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(_window, args); }
        catch (Exception ex) { App.Log($"Invoke {methodName} failed: {ex}"); }
    }
}
