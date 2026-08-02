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
    private readonly WorkspaceControl _workspace;
    private readonly ZoteroLibraryControl _zotero;
    private readonly DevelopmentControl _development;
    private readonly SettingsControl _settingsControl;
    private readonly TerminalDrawerControl _terminal;
    private readonly RowDefinition _terminalSplitterRow;
    private readonly RowDefinition _terminalRow;
    private readonly GridSplitter _splitter;
    private Border? _modulePlaceholder;
    private TextBlock? _modulePlaceholderTitle;
    private TextBlock? _modulePlaceholderDescription;
    private bool _terminalVisible;

    private WorkbenchEnhancer(MainWindow window)
    {
        _window = window;
        _settings = ResolveSettings(window);
        _workspace = new WorkspaceControl(_settings);
        _zotero = new ZoteroLibraryControl(_settings);
        _development = new DevelopmentControl(_settings);
        _settingsControl = new SettingsControl(_settings);
        _terminal = new TerminalDrawerControl(_settings);

        ReplaceFeatureViews();
        InstallPlaceholderModules();
        (_terminalSplitterRow, _terminalRow, _splitter) = InstallTerminalDrawer();
        InstallTopTerminalButton();
        InstallTopLockButton();
        ApplyVisualPolish();
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
        {
            settingsView.Content = _settingsControl;
            settingsView.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        }
    }

    private void InstallPlaceholderModules()
    {
        if (_window.FindName("PlaceholderView") is not Grid placeholder) return;
        placeholder.Children.Clear();
        placeholder.Margin = new Thickness(0);

        _modulePlaceholderTitle = new TextBlock
        {
            Text = "模块准备中", FontSize = 22, FontWeight = FontWeights.SemiBold,
            HorizontalAlignment = HorizontalAlignment.Center
        };
        _modulePlaceholderDescription = new TextBlock
        {
            Text = "这里将用于后续本地工具与任务编排。", FontSize = 13,
            Foreground = new SolidColorBrush(Color.FromRgb(104, 120, 142)),
            TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 7, 0, 0)
        };
        _modulePlaceholder = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(250, 252, 255)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(224, 231, 240)),
            BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(16),
            Margin = new Thickness(18), Padding = new Thickness(30)
        };
        var stack = new StackPanel { Width = 470, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var icon = new Border
        {
            Width = 58, Height = 58, CornerRadius = new CornerRadius(18),
            Background = new SolidColorBrush(Color.FromRgb(237, 243, 255)),
            HorizontalAlignment = HorizontalAlignment.Center
        };
        icon.Child = new Viewbox
        {
            Width = 27, Height = 27,
            Child = new System.Windows.Shapes.Path
            {
                Data = Geometry.Parse("M5,7 H19 M5,12 H19 M5,17 H15 M7,4 V20"),
                Stroke = new SolidColorBrush(Color.FromRgb(75, 126, 232)), StrokeThickness = 1.8,
                Fill = Brushes.Transparent, StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round
            }
        };
        stack.Children.Add(icon);
        stack.Children.Add(_modulePlaceholderTitle);
        stack.Children.Add(_modulePlaceholderDescription);
        _modulePlaceholder.Child = stack;

        _workspace.Visibility = Visibility.Collapsed;
        _modulePlaceholder.Visibility = Visibility.Visible;
        placeholder.Children.Add(_workspace);
        placeholder.Children.Add(_modulePlaceholder);
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

    private void InstallTopLockButton()
    {
        if (_window.FindName("PopoutButton") is not Button popout || popout.Parent is not StackPanel actions)
            return;
        var button = new Button
        {
            Style = Application.Current.TryFindResource("IconButton") as Style,
            ToolTip = "临时锁定 AtlasDesk"
        };
        var viewbox = new Viewbox { Width = 16, Height = 16 };
        viewbox.Child = new System.Windows.Shapes.Path
        {
            Data = Geometry.Parse("M7,10 V7 C7,4.8 8.8,3 11,3 H13 C15.2,3 17,4.8 17,7 V10 M5,10 H19 V21 H5 Z M12,14 V17"),
            Stroke = new SolidColorBrush(Color.FromRgb(95,112,135)), StrokeThickness = 1.8,
            Fill = Brushes.Transparent, StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round
        };
        button.Content = viewbox;
        button.Click += (_, _) => ShowTemporaryLock();
        actions.Children.Insert(Math.Max(0, actions.Children.Count - 1), button);
    }

    private void ShowTemporaryLock()
    {
        if (!SecurityService.IsPinEnabled)
        {
            NavigateToSettings();
            MessageBox.Show("尚未设置四位临时密码。可在“设置 → 安全与隐私”中启用。",
                ProductIdentity.ProductName, MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        new TemporaryLockWindow { Owner = _window }.ShowDialog();
    }

    private void ApplyVisualPolish()
    {
        _window.Background = new SolidColorBrush(Color.FromRgb(247, 248, 250));
        if (_window.FindName("RootGrid") is Grid root)
        {
            root.Margin = new Thickness(0);
            root.Background = new SolidColorBrush(Color.FromRgb(247, 248, 250));
            if (root.ColumnDefinitions.Count > 1)
                root.ColumnDefinitions[1].Width = new GridLength(1);

            var divider = root.Children.OfType<Border>()
                .FirstOrDefault(border => Equals(border.Tag, "shell-divider"));
            if (divider is null)
            {
                divider = new Border
                {
                    Tag = "shell-divider",
                    Background = new SolidColorBrush(Color.FromRgb(226, 229, 234)),
                    IsHitTestVisible = false
                };
                Grid.SetColumn(divider, 1);
                root.Children.Add(divider);
            }

            var content = root.Children.OfType<Border>()
                .FirstOrDefault(border => Grid.GetColumn(border) == 2);
            if (content is not null)
            {
                content.CornerRadius = new CornerRadius(0);
                content.BorderThickness = new Thickness(0);
                content.BorderBrush = Brushes.Transparent;
                content.Background = Brushes.White;
                content.Effect = null;
                content.ClipToBounds = true;
            }
        }
        if (_window.FindName("Sidebar") is Border sidebar)
        {
            sidebar.CornerRadius = new CornerRadius(0);
            sidebar.BorderThickness = new Thickness(0);
            sidebar.BorderBrush = Brushes.Transparent;
            sidebar.Background = new SolidColorBrush(Color.FromRgb(248, 249, 251));
            sidebar.Effect = null;
        }
        if (_window.FindName("TopBarRow") is RowDefinition topBarRow) topBarRow.Height = new GridLength(42);
        if (_window.FindName("TopBar") is Grid topBar)
        {
            topBar.Background = Brushes.White;
            if (!topBar.Children.OfType<Border>().Any(border => Equals(border.Tag, "polish-divider")))
            {
                var divider = new Border
                {
                    Tag = "polish-divider", Height = 1, Background = new SolidColorBrush(Color.FromRgb(229, 232, 237)),
                    VerticalAlignment = VerticalAlignment.Bottom, IsHitTestVisible = false
                };
                Grid.SetColumnSpan(divider, 3);
                topBar.Children.Add(divider);
            }
        }
        if (_window.FindName("PageTitle") is TextBlock title) title.FontSize = 14;
        if (_window.FindName("PageSubtitle") is TextBlock subtitle) subtitle.FontSize = 11;
        if (_window.FindName("UserCard") is Border userCard)
        {
            userCard.Background = Brushes.Transparent;
            userCard.BorderBrush = Brushes.Transparent;
            userCard.BorderThickness = new Thickness(0);
            userCard.CornerRadius = new CornerRadius(0);
        }
    }

    private void WireEvents()
    {
        _workspace.OpenSettingsRequested += (_, _) => NavigateToSettings();
        _zotero.OpenSettingsRequested += (_, _) => NavigateToSettings();
        _settingsControl.SettingsSaved += (_, args) => OnSettingsSaved(args);
        _settingsControl.ClearAccessRequested += (_, _) => InvokeLegacy("ClearSession_Click", _window, new RoutedEventArgs());
        _terminal.CollapseRequested += (_, _) => HideTerminal();
        _window.PreviewKeyDown += Window_PreviewKeyDown;
        _window.Closed += async (_, _) => await _terminal.DisposeAsync();

        if (_window.FindName("WorkspaceNav") is RadioButton workspaceNav)
            workspaceNav.Checked += async (_, _) => await ShowWorkspaceAsync();
        if (_window.FindName("LibraryNav") is RadioButton libraryNav)
            libraryNav.Checked += async (_, _) => await ShowZoteroAsync();
        if (_window.FindName("ToolsNav") is RadioButton toolsNav)
            toolsNav.Checked += (_, _) => ShowModulePlaceholder("工具", "后续用于组合本地软件、批处理脚本和常用转换动作。工作区与终端稳定后再逐项接入，避免堆出不可用入口。");
        if (_window.FindName("TasksNav") is RadioButton tasksNav)
            tasksNav.Checked += (_, _) => ShowModulePlaceholder("任务", "后续用于统一展示长任务、转换进度、失败重试和历史记录；当前版本先不制造模拟任务。");
    }

    private async Task ShowWorkspaceAsync()
    {
        if (_modulePlaceholder is not null) _modulePlaceholder.Visibility = Visibility.Collapsed;
        _workspace.Visibility = Visibility.Visible;
        await _workspace.EnsureLoadedAsync();
    }

    private async Task ShowZoteroAsync()
    {
        await _zotero.EnsureLoadedAsync();
    }

    private void ShowModulePlaceholder(string title, string description)
    {
        _workspace.Visibility = Visibility.Collapsed;
        if (_modulePlaceholderTitle is not null) _modulePlaceholderTitle.Text = title;
        if (_modulePlaceholderDescription is not null) _modulePlaceholderDescription.Text = description;
        if (_modulePlaceholder is not null) _modulePlaceholder.Visibility = Visibility.Visible;
    }

    private void SuppressLegacyFeatureLoaders()
    {
        SetPrivateField("_zoteroInitialized", true);
        SetPrivateField("_pythonInitialized", true);
    }

    private void OnSettingsSaved(SettingsSavedEventArgs args)
    {
        if (args.WorkspaceChanged)
        {
            _workspace.InvalidateWorkspace();
            _workspace.ApplySettings();
        }
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

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Oem3 && Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
        {
            ToggleTerminal();
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
