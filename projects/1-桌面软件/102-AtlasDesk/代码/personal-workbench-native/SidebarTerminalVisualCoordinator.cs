using System.Reflection;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Threading;
using ShapePath = System.Windows.Shapes.Path;

namespace PersonalWorkbench;

/// <summary>
/// Final owner for sidebar placement, compact shell chrome and neutral terminal chrome.
/// It keeps the narrow sidebar genuinely icon-sized, removes noisy shortcut text,
/// applies an unambiguous settings glyph and neutralizes historical terminal overrides.
/// </summary>
public sealed class SidebarTerminalVisualCoordinator : IDisposable
{
    private static readonly SolidColorBrush TerminalButtonBackground = Brush(26, 26, 26);
    private static readonly SolidColorBrush TerminalButtonDisabledBackground = Brush(15, 15, 15);
    private static readonly SolidColorBrush TerminalButtonBorder = Brush(74, 74, 74);
    private static readonly SolidColorBrush TerminalButtonDisabledBorder = Brush(43, 43, 43);
    private static readonly SolidColorBrush TerminalButtonText = Brush(245, 245, 245);
    private static readonly SolidColorBrush TerminalButtonDisabledText = Brush(120, 120, 120);

    private readonly MainWindow _window;
    private readonly TerminalDrawerControl _terminal;
    private readonly ContentControl? _terminalHost;
    private readonly Button? _brandToggle;
    private readonly Button? _commandButton;
    private readonly Grid? _sidebarLayout;
    private readonly ColumnDefinition? _sidebarColumn;
    private readonly Border? _userCard;
    private readonly Border? _userAvatar;
    private readonly RowDefinition? _topBarRow;
    private readonly Grid? _topBar;
    private readonly TextBlock? _pageTitle;
    private readonly TextBlock? _pageSubtitle;
    private readonly TabControl? _developmentTabs;
    private readonly RadioButton[] _navigationButtons;
    private readonly HashSet<Button> _trackedTerminalButtons = new();
    private bool _themeQueued;
    private bool _shellQueued;
    private bool _disposed;

    private SidebarTerminalVisualCoordinator(MainWindow window, WorkbenchFeaturePipeline pipeline)
    {
        _window = window;
        _terminal = ReadField<TerminalDrawerControl>(pipeline.Base, "_terminal")
                    ?? throw new InvalidOperationException("Terminal module is unavailable.");
        _terminalHost = ReadField<ContentControl>(pipeline.ProjectWorkflow, "_terminalHost");
        _developmentTabs = ReadField<TabControl>(pipeline.ProjectWorkflow, "_tabs");
        _brandToggle = _window.FindName("BrandToggleButton") as Button;
        _commandButton = _window.FindName("CommandButton") as Button;
        _sidebarLayout = (_window.FindName("Sidebar") as Border)?.Child as Grid;
        _sidebarColumn = _window.FindName("SidebarColumn") as ColumnDefinition;
        _userCard = _window.FindName("UserCard") as Border;
        _userAvatar = _window.FindName("UserAvatar") as Border;
        _topBarRow = _window.FindName("TopBarRow") as RowDefinition;
        _topBar = _window.FindName("TopBar") as Grid;
        _pageTitle = _window.FindName("PageTitle") as TextBlock;
        _pageSubtitle = _window.FindName("PageSubtitle") as TextBlock;
        _navigationButtons = new[]
        {
            "HomeNav", "WorkspaceNav", "LibraryNav", "DevelopmentNav",
            "ToolsNav", "DashboardNav", "TasksNav", "SettingsNav"
        }
        .Select(name => _window.FindName(name) as RadioButton)
        .Where(button => button is not null)
        .Cast<RadioButton>()
        .ToArray();

        MoveProjectContextShortcut();
        _terminal.Loaded += Terminal_Loaded;
        _terminal.IsVisibleChanged += Terminal_IsVisibleChanged;
        _window.Loaded += Window_Loaded;
        _window.SizeChanged += Window_SizeChanged;
        if (_brandToggle is not null)
            _brandToggle.Click += BrandToggle_Click;
        _window.Closed += Window_Closed;
        QueueShellVisuals();
        QueueTerminalTheme();

        App.Log("Sidebar/terminal visual coordinator attached: narrow icon rail, compact top chrome, clean command entry and neutral black CMD terminal");
    }

    public static SidebarTerminalVisualCoordinator Attach(MainWindow window, WorkbenchFeaturePipeline pipeline)
        => new(window, pipeline);

    private static T? ReadField<T>(object instance, string name) where T : class
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) as T;

    private static bool ReadBooleanField(object instance, string name)
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) is true;

    private void MoveProjectContextShortcut()
    {
        if (_window.FindName("CommandButton") is not Button commandButton
            || commandButton.Parent is not Grid sidebarGrid)
        {
            return;
        }

        var contextButton = sidebarGrid.Children
            .OfType<Button>()
            .FirstOrDefault(button => Equals(button.Tag, "productivity-context"));
        if (contextButton is null)
            return;

        Grid.SetRow(contextButton, Grid.GetRow(commandButton));
        Grid.SetColumn(contextButton, Grid.GetColumn(commandButton));
        Grid.SetColumnSpan(contextButton, Grid.GetColumnSpan(commandButton));
        Panel.SetZIndex(contextButton, 2);

        contextButton.Width = 30;
        contextButton.Height = 30;
        contextButton.Margin = new Thickness(0, 0, 4, 0);
        contextButton.Padding = new Thickness(0);
        contextButton.HorizontalAlignment = HorizontalAlignment.Right;
        contextButton.VerticalAlignment = VerticalAlignment.Center;
        contextButton.Background = Brush(241, 245, 250);
        contextButton.Foreground = Brush(76, 96, 122);
        contextButton.BorderBrush = Brush(215, 224, 235);
        contextButton.BorderThickness = new Thickness(1);
        contextButton.ToolTip = "项目上下文";
        contextButton.Content = CreateProjectContextIcon();
        contextButton.SetBinding(
            UIElement.VisibilityProperty,
            new Binding(nameof(UIElement.Visibility)) { Source = commandButton, Mode = BindingMode.OneWay });
        AutomationProperties.SetName(contextButton, "项目上下文");
        AutomationProperties.SetHelpText(contextButton, "配置项目命令、常用文件、会话恢复和关联文献");

        commandButton.Margin = new Thickness(0, 2, 38, 2);
    }

    private static Viewbox CreateProjectContextIcon()
    {
        return new Viewbox
        {
            Width = 16,
            Height = 16,
            Child = new ShapePath
            {
                Data = Geometry.Parse("M4,7 H20 V19 H4 Z M8,7 V5 H16 V7 M4,11 H20"),
                Stroke = Brush(76, 96, 122),
                StrokeThickness = 1.7,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round,
                Fill = Brushes.Transparent
            }
        };
    }

    private void Window_Loaded(object sender, RoutedEventArgs e) => QueueShellVisuals();
    private void Window_SizeChanged(object sender, SizeChangedEventArgs e) => QueueShellVisuals();
    private void BrandToggle_Click(object sender, RoutedEventArgs e) => QueueShellVisuals();

    private void QueueShellVisuals()
    {
        if (_disposed || _shellQueued)
            return;
        _shellQueued = true;
        _window.Dispatcher.BeginInvoke(
            new Action(() =>
            {
                _shellQueued = false;
                ApplyShellVisuals();
            }),
            DispatcherPriority.ContextIdle);
    }

    private void ApplyShellVisuals()
    {
        if (_disposed)
            return;

        var collapsed = ReadBooleanField(_window, "_sidebarCollapsed");
        if (_sidebarColumn is not null)
            _sidebarColumn.Width = new GridLength(collapsed ? 48 : 208);
        if (_sidebarLayout is not null)
            _sidebarLayout.Margin = collapsed ? new Thickness(4, 6, 4, 6) : new Thickness(8, 8, 8, 8);

        if (_brandToggle is not null)
        {
            _brandToggle.Width = collapsed ? 34 : 38;
            _brandToggle.Height = collapsed ? 34 : 38;
            _brandToggle.HorizontalAlignment = collapsed ? HorizontalAlignment.Center : HorizontalAlignment.Left;
            _brandToggle.ApplyTemplate();
            var logo = FindVisualChildren<Border>(_brandToggle)
                .Where(border => border.Width >= 30 && border.Height >= 30)
                .OrderByDescending(border => border.Width)
                .FirstOrDefault();
            if (logo is not null)
            {
                logo.Width = collapsed ? 28 : 32;
                logo.Height = collapsed ? 28 : 32;
                logo.CornerRadius = new CornerRadius(collapsed ? 8 : 10);
            }
        }

        if (_commandButton is not null)
        {
            _commandButton.Height = 32;
            _commandButton.ToolTip = "搜索页面、项目、文件、任务、文献和命令（Ctrl+K）";
            _commandButton.ApplyTemplate();
            foreach (var shortcut in FindVisualChildren<TextBlock>(_commandButton)
                         .Where(text => string.Equals(text.Text?.Replace(" ", string.Empty), "CtrlK", StringComparison.OrdinalIgnoreCase)))
            {
                if (VisualTreeHelper.GetParent(shortcut) is FrameworkElement container)
                    container.Visibility = Visibility.Collapsed;
                else
                    shortcut.Visibility = Visibility.Collapsed;
            }
        }

        foreach (var button in _navigationButtons)
        {
            button.Height = collapsed ? 30 : 34;
            button.Margin = new Thickness(0, 1, 0, 1);
            button.Padding = collapsed ? new Thickness(0) : new Thickness(10, 0, 4, 0);
            button.HorizontalContentAlignment = collapsed ? HorizontalAlignment.Center : HorizontalAlignment.Left;

            if (button.Content is StackPanel stack)
            {
                var icon = stack.Children.OfType<Viewbox>().FirstOrDefault();
                if (icon is not null)
                {
                    icon.Width = collapsed ? 15 : 16;
                    icon.Height = collapsed ? 15 : 16;
                    icon.Margin = collapsed ? new Thickness(0) : new Thickness(0, 0, 7, 0);
                }
            }
        }

        if (_window.FindName("SettingsNav") is RadioButton settings
            && settings.Content is StackPanel settingsStack
            && settingsStack.Children.OfType<Viewbox>().FirstOrDefault()?.Child is ShapePath settingsPath)
        {
            settingsPath.Data = Geometry.Parse(
                "M9.5,3.5 H14.5 L15.2,5.8 L17.5,5.2 L19.8,9.2 L18.1,11 L20,13 L17.7,16.9 L15.3,16.2 L14.5,19 H9.5 L8.7,16.2 L6.3,16.9 L4,13 L5.9,11 L4.2,9.2 L6.5,5.2 L8.8,5.8 Z M12,8.5 A3.5,3.5 0 1 0 12,15.5 A3.5,3.5 0 1 0 12,8.5");
        }

        if (_userCard is not null)
        {
            _userCard.Height = collapsed ? 34 : 42;
            _userCard.Margin = new Thickness(0, 4, 0, 0);
            _userCard.Padding = collapsed ? new Thickness(3) : new Thickness(5);
        }
        if (_userAvatar is not null)
        {
            _userAvatar.Width = collapsed ? 24 : 26;
            _userAvatar.Height = collapsed ? 24 : 26;
            _userAvatar.CornerRadius = new CornerRadius(collapsed ? 7 : 8);
        }

        if (_topBarRow is not null)
            _topBarRow.Height = new GridLength(36);
        if (_topBar is not null)
        {
            foreach (var button in FindVisualChildren<Button>(_topBar))
            {
                if (button.Width is >= 28 and <= 32 || double.IsNaN(button.Width))
                    button.Width = 26;
                if (button.Height is >= 28 and <= 32 || double.IsNaN(button.Height))
                    button.Height = 26;
            }
        }
        if (_pageTitle is not null)
            _pageTitle.FontSize = 13.2;
        if (_pageSubtitle is not null)
            _pageSubtitle.FontSize = 10.5;

        if (_developmentTabs is not null)
        {
            foreach (var tab in _developmentTabs.Items.OfType<TabItem>())
            {
                tab.Height = 30;
                tab.Padding = new Thickness(10, 3, 10, 3);
                tab.FontSize = 11.3;
            }
        }

        var contextButton = _sidebarLayout?.Children
            .OfType<Button>()
            .FirstOrDefault(button => Equals(button.Tag, "productivity-context"));
        if (contextButton is not null)
        {
            contextButton.Width = 28;
            contextButton.Height = 28;
            contextButton.Margin = new Thickness(0, 0, 2, 0);
        }
    }

    private void Terminal_Loaded(object sender, RoutedEventArgs e) => QueueTerminalTheme();

    private void Terminal_IsVisibleChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        if (e.NewValue is true)
            QueueTerminalTheme();
    }

    private void QueueTerminalTheme()
    {
        if (_disposed || _themeQueued)
            return;
        _themeQueued = true;
        _terminal.Dispatcher.BeginInvoke(
            new Action(() =>
            {
                _themeQueued = false;
                ApplyTerminalTheme();
            }),
            DispatcherPriority.ContextIdle);
    }

    private void ApplyTerminalTheme()
    {
        if (_disposed)
            return;

        _terminal.Background = Brushes.Black;
        if (_terminalHost is not null)
            _terminalHost.Background = Brushes.Black;

        foreach (var panel in FindVisualChildren<Panel>(_terminal))
        {
            if (panel.Background is SolidColorBrush brush
                && brush.Color == Color.FromRgb(13, 19, 32))
            {
                panel.Background = Brushes.Black;
            }
        }

        foreach (var button in FindVisualChildren<Button>(_terminal))
        {
            if (_trackedTerminalButtons.Add(button))
            {
                button.IsEnabledChanged += TerminalButton_IsEnabledChanged;
                button.Loaded += TerminalButton_Loaded;
            }
            ApplyTerminalButton(button);
        }
    }

    private void TerminalButton_Loaded(object sender, RoutedEventArgs e)
    {
        if (sender is Button button)
            ApplyTerminalButton(button);
    }

    private void TerminalButton_IsEnabledChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        if (sender is Button button)
            ApplyTerminalButton(button);
    }

    private static void ApplyTerminalButton(Button button)
    {
        button.Foreground = button.IsEnabled ? TerminalButtonText : TerminalButtonDisabledText;
        button.Background = button.IsEnabled ? TerminalButtonBackground : TerminalButtonDisabledBackground;
        button.BorderBrush = button.IsEnabled ? TerminalButtonBorder : TerminalButtonDisabledBorder;
        button.Opacity = 1;
    }

    private static IEnumerable<T> FindVisualChildren<T>(DependencyObject root) where T : DependencyObject
    {
        for (var index = 0; index < VisualTreeHelper.GetChildrenCount(root); index++)
        {
            var child = VisualTreeHelper.GetChild(root, index);
            if (child is T match)
                yield return match;
            foreach (var nested in FindVisualChildren<T>(child))
                yield return nested;
        }
    }

    private static SolidColorBrush Brush(byte red, byte green, byte blue)
    {
        var brush = new SolidColorBrush(Color.FromRgb(red, green, blue));
        brush.Freeze();
        return brush;
    }

    private void Window_Closed(object? sender, EventArgs e) => Dispose();

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _window.Closed -= Window_Closed;
        _window.Loaded -= Window_Loaded;
        _window.SizeChanged -= Window_SizeChanged;
        if (_brandToggle is not null)
            _brandToggle.Click -= BrandToggle_Click;
        _terminal.Loaded -= Terminal_Loaded;
        _terminal.IsVisibleChanged -= Terminal_IsVisibleChanged;
        foreach (var button in _trackedTerminalButtons)
        {
            button.IsEnabledChanged -= TerminalButton_IsEnabledChanged;
            button.Loaded -= TerminalButton_Loaded;
        }
        _trackedTerminalButtons.Clear();
    }
}
