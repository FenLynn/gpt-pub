using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Threading;

namespace PersonalWorkbench;

public enum UiDensityMode
{
    Spacious,
    Standard,
    Compact
}

public sealed record UiAdaptiveAuditSnapshot(
    UiDensityMode Mode,
    double WindowWidth,
    double WindowHeight,
    double ContentWidth,
    double ContentHeight,
    double SidebarWidth,
    double DpiScale,
    bool Healthy,
    string Detail);

public static class UiAdaptiveAuditService
{
    private static readonly object Gate = new();
    private static UiAdaptiveAuditSnapshot? _current;

    public static UiAdaptiveAuditSnapshot? Current
    {
        get
        {
            lock (Gate) return _current;
        }
    }

    internal static void Update(UiAdaptiveAuditSnapshot snapshot)
    {
        lock (Gate) _current = snapshot;
    }

    public static DiagnosticCheck CreateDiagnosticCheck()
    {
        var snapshot = Current;
        if (snapshot is null)
        {
            return new DiagnosticCheck
            {
                Name = "界面自适应",
                Severity = DiagnosticSeverity.Warning,
                Detail = "主窗口尚未完成首轮布局检查"
            };
        }

        var mode = snapshot.Mode switch
        {
            UiDensityMode.Spacious => "宽屏",
            UiDensityMode.Compact => "紧凑",
            _ => "标准"
        };
        return new DiagnosticCheck
        {
            Name = "界面自适应",
            Severity = snapshot.Healthy ? DiagnosticSeverity.Ok : DiagnosticSeverity.Warning,
            Detail = $"{mode}模式 · 窗口 {snapshot.WindowWidth:0}×{snapshot.WindowHeight:0} · "
                     + $"内容 {snapshot.ContentWidth:0}×{snapshot.ContentHeight:0} · "
                     + $"DPI {snapshot.DpiScale * 100:0}% · {snapshot.Detail}"
        };
    }
}

public sealed class UiConvergenceCoordinator
{
    private static readonly string[] NavigationNames =
    {
        "HomeNav", "WorkspaceNav", "LibraryNav", "DevelopmentNav",
        "ToolsNav", "DashboardNav", "TasksNav", "SettingsNav"
    };

    private static readonly HashSet<string> GenericPageNames = new(StringComparer.Ordinal)
    {
        "DevelopmentControl",
        "ProjectCenterControl",
        "TaskCenterControl",
        "ToolsCenterControl",
        "WorkspaceControl"
    };

    private readonly MainWindow _window;
    private readonly ResourceDictionary _theme;
    private readonly HashSet<DependencyObject> _polished = new(ReferenceEqualityComparer.Instance);
    private readonly RoutedEventHandler _loadedHandler;
    private readonly Grid? _rootGrid;
    private readonly ColumnDefinition? _sidebarColumn;
    private readonly Border? _sidebar;
    private readonly Border? _mainSurface;
    private readonly Grid? _contentGrid;
    private readonly Grid? _topBar;
    private readonly RowDefinition? _topBarRow;
    private readonly TextBlock? _pageSubtitle;
    private readonly TextBlock? _workLabel;
    private readonly TextBlock? _abilityLabel;
    private readonly StackPanel? _userText;
    private readonly Border? _userCard;
    private bool _layoutQueued;
    private bool? _lastAuditHealthy;

    private UiConvergenceCoordinator(MainWindow window)
    {
        _window = window;
        _loadedHandler = OnElementLoaded;
        _theme = new ResourceDictionary
        {
            Source = new Uri("/AtlasDesk;component/UiConvergenceResources.xaml", UriKind.RelativeOrAbsolute)
        };
        _window.Resources.MergedDictionaries.Add(_theme);

        _rootGrid = _window.FindName("RootGrid") as Grid;
        _sidebarColumn = _window.FindName("SidebarColumn") as ColumnDefinition;
        _sidebar = _window.FindName("Sidebar") as Border;
        _contentGrid = _window.FindName("ContentGrid") as Grid;
        _topBar = _window.FindName("TopBar") as Grid;
        _topBarRow = _window.FindName("TopBarRow") as RowDefinition;
        _pageSubtitle = _window.FindName("PageSubtitle") as TextBlock;
        _workLabel = _window.FindName("WorkLabel") as TextBlock;
        _abilityLabel = _window.FindName("AbilityLabel") as TextBlock;
        _userText = _window.FindName("UserText") as StackPanel;
        _userCard = _window.FindName("UserCard") as Border;
        _mainSurface = _rootGrid?.Children
            .OfType<Border>()
            .FirstOrDefault(border => Grid.GetColumn(border) == 2);

        _window.AddHandler(FrameworkElement.LoadedEvent, _loadedHandler, true);
        _window.SizeChanged += Window_SizeChanged;
        _window.Closed += Window_Closed;
        _window.Dispatcher.BeginInvoke(new Action(() =>
        {
            PolishTree(_window);
            ApplyLayout();
        }), DispatcherPriority.Loaded);
    }

    public static UiConvergenceCoordinator Attach(MainWindow window) => new(window);

    private void OnElementLoaded(object sender, RoutedEventArgs e)
    {
        if (e.OriginalSource is DependencyObject source)
            PolishTree(source);
        QueueLayout();
    }

    private void Window_SizeChanged(object sender, SizeChangedEventArgs e) => QueueLayout();

    private void Window_Closed(object? sender, EventArgs e)
    {
        _window.RemoveHandler(FrameworkElement.LoadedEvent, _loadedHandler);
        _window.SizeChanged -= Window_SizeChanged;
        _window.Closed -= Window_Closed;
    }

    private void QueueLayout()
    {
        if (_layoutQueued) return;
        _layoutQueued = true;
        _window.Dispatcher.BeginInvoke(new Action(() =>
        {
            _layoutQueued = false;
            ApplyLayout();
        }), DispatcherPriority.Background);
    }

    private void ApplyLayout()
    {
        var width = Math.Max(_window.ActualWidth, _window.Width);
        var height = Math.Max(_window.ActualHeight, _window.Height);
        var mode = ResolveMode(width, height);
        ApplyShell(mode, width, height);
        ApplyPageLayouts(mode);
        _window.Dispatcher.BeginInvoke(new Action(() => Audit(mode)), DispatcherPriority.ContextIdle);
    }

    internal static UiDensityMode ResolveMode(double width, double height)
    {
        if (width >= 1480 && height >= 820) return UiDensityMode.Spacious;
        if (width < 1240 || height < 740) return UiDensityMode.Compact;
        return UiDensityMode.Standard;
    }

    private void ApplyShell(UiDensityMode mode, double width, double height)
    {
        var compact = mode == UiDensityMode.Compact;
        var spacious = mode == UiDensityMode.Spacious;
        var iconRail = _sidebarColumn is not null && _sidebarColumn.Width.IsAbsolute && _sidebarColumn.Width.Value <= 90;

        if (_rootGrid is not null)
        {
            _rootGrid.Margin = spacious
                ? new Thickness(10)
                : compact ? new Thickness(6) : new Thickness(8);
            if (_rootGrid.ColumnDefinitions.Count > 1)
                _rootGrid.ColumnDefinitions[1].Width = new GridLength(compact ? 6 : 8);
        }

        if (_sidebarColumn is not null && !iconRail)
        {
            _sidebarColumn.Width = new GridLength(spacious ? 218 : compact ? 184 : 202);
        }

        if (_sidebar is not null)
        {
            _sidebar.CornerRadius = new CornerRadius(spacious ? 15 : compact ? 11 : 13);
            _sidebar.BorderBrush = BrushOf("#E0E6EE");
            _sidebar.Effect = null;
        }

        if (_mainSurface is not null)
        {
            _mainSurface.CornerRadius = new CornerRadius(spacious ? 15 : compact ? 11 : 13);
            _mainSurface.BorderBrush = BrushOf("#E0E6EE");
            _mainSurface.Effect = null;
        }

        if (_contentGrid is not null)
            _contentGrid.Background = BrushOf("#F7F9FC");
        if (_topBar is not null)
            _topBar.Background = BrushOf("#FBFCFE");
        if (_topBarRow is not null)
            _topBarRow.Height = new GridLength(compact ? 40 : 42);

        if (_pageSubtitle is not null)
            _pageSubtitle.Visibility = width < 1280 ? Visibility.Collapsed : Visibility.Visible;
        if (_workLabel is not null)
            _workLabel.Visibility = compact && height < 720 ? Visibility.Collapsed : Visibility.Visible;
        if (_abilityLabel is not null)
            _abilityLabel.Visibility = compact && height < 720 ? Visibility.Collapsed : Visibility.Visible;
        if (_userText is not null)
            _userText.Visibility = width < 1140 && !iconRail ? Visibility.Collapsed : Visibility.Visible;
        if (_userCard is not null)
            _userCard.Height = compact ? 44 : 47;

        foreach (var name in NavigationNames)
        {
            if (_window.FindName(name) is RadioButton navigation)
            {
                navigation.Style = StyleOf("ConvergedNavButton");
                navigation.Height = compact ? 35 : 37;
            }
        }
    }

    private void ApplyPageLayouts(UiDensityMode mode)
    {
        foreach (var control in FindDescendants<UserControl>(_window))
        {
            if (!control.IsLoaded) continue;
            switch (control)
            {
                case HomeDashboardControl home:
                    ApplyHome(home, mode);
                    break;
                case SettingsControl settings:
                    ApplySettings(settings, mode);
                    break;
                default:
                    if (GenericPageNames.Contains(control.GetType().Name))
                        ApplyGenericPage(control, mode);
                    break;
            }
        }
    }

    private static void ApplyHome(HomeDashboardControl home, UiDensityMode mode)
    {
        var scroll = home.Content as ScrollViewer ?? FindDescendants<ScrollViewer>(home).FirstOrDefault();
        if (scroll?.Content is not Grid root) return;

        var width = home.ActualWidth > 0 ? home.ActualWidth : scroll.ActualWidth;
        var compact = width < 930 || mode == UiDensityMode.Compact;
        var dense = width < 760;
        root.MinWidth = 0;
        root.Margin = dense
            ? new Thickness(10, 9, 10, 14)
            : compact ? new Thickness(13, 11, 13, 17) : new Thickness(18, 14, 18, 20);

        var hero = root.Children.OfType<Border>().FirstOrDefault(border => Grid.GetRow(border) == 0);
        if (hero is not null)
        {
            hero.MinHeight = dense ? 214 : compact ? 154 : 166;
            hero.CornerRadius = new CornerRadius(compact ? 13 : 16);
            if (hero.Child is Grid decorationRoot)
            {
                foreach (var ellipse in decorationRoot.Children.OfType<System.Windows.Shapes.Ellipse>())
                    ellipse.Visibility = dense ? Visibility.Collapsed : Visibility.Visible;

                var heroLayout = decorationRoot.Children.OfType<Grid>().LastOrDefault();
                if (heroLayout is not null)
                {
                    heroLayout.Margin = dense
                        ? new Thickness(16, 14, 16, 14)
                        : new Thickness(21, 17, 21, 17);
                    var context = heroLayout.Children.OfType<Border>()
                        .FirstOrDefault(border => Grid.GetColumn(border) == 2 || Grid.GetRow(border) == 2);
                    if (dense)
                    {
                        heroLayout.ColumnDefinitions.Clear();
                        heroLayout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                        heroLayout.RowDefinitions.Clear();
                        heroLayout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                        heroLayout.RowDefinitions.Add(new RowDefinition { Height = new GridLength(10) });
                        heroLayout.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                        if (context is not null)
                        {
                            Grid.SetColumn(context, 0);
                            Grid.SetRow(context, 2);
                            context.Margin = new Thickness(0);
                        }
                    }
                    else
                    {
                        heroLayout.RowDefinitions.Clear();
                        heroLayout.ColumnDefinitions.Clear();
                        heroLayout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                        heroLayout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(compact ? 12 : 18) });
                        heroLayout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(compact ? 250 : 310) });
                        if (context is not null)
                        {
                            Grid.SetRow(context, 0);
                            Grid.SetColumn(context, 2);
                            context.Margin = new Thickness(0);
                        }
                    }
                }
            }
        }

        var metrics = root.Children.OfType<UniformGrid>().FirstOrDefault(grid => Grid.GetRow(grid) == 2);
        if (metrics is not null)
        {
            metrics.Columns = compact ? 2 : 4;
            var columns = metrics.Columns;
            for (var index = 0; index < metrics.Children.Count; index++)
            {
                if (metrics.Children[index] is not Border card) continue;
                var lastInRow = (index + 1) % columns == 0;
                card.Margin = new Thickness(
                    0,
                    0,
                    lastInRow ? 0 : 9,
                    compact && index < metrics.Children.Count - columns ? 9 : 0);
                card.MinHeight = compact ? 80 : 86;
            }
        }

        var lower = root.Children.OfType<Grid>().FirstOrDefault(grid => Grid.GetRow(grid) == 4);
        if (lower is not null)
        {
            var cards = lower.Children.OfType<Border>().ToArray();
            var primary = cards.FirstOrDefault(border => Grid.GetColumn(border) == 0 || Grid.GetRow(border) == 0);
            var quick = cards.FirstOrDefault(border => !ReferenceEquals(border, primary));
            if (compact)
            {
                lower.ColumnDefinitions.Clear();
                lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                lower.RowDefinitions.Clear();
                lower.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                lower.RowDefinitions.Add(new RowDefinition { Height = new GridLength(10) });
                lower.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                if (primary is not null) { Grid.SetColumn(primary, 0); Grid.SetRow(primary, 0); }
                if (quick is not null) { Grid.SetColumn(quick, 0); Grid.SetRow(quick, 2); }
            }
            else
            {
                lower.RowDefinitions.Clear();
                lower.ColumnDefinitions.Clear();
                lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.45, GridUnitType.Star) });
                lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(12) });
                lower.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                if (primary is not null) { Grid.SetRow(primary, 0); Grid.SetColumn(primary, 0); }
                if (quick is not null) { Grid.SetRow(quick, 0); Grid.SetColumn(quick, 2); }
            }
        }

        var footer = root.Children.OfType<Border>().FirstOrDefault(border => Grid.GetRow(border) == 6);
        if (footer?.Child is Grid footerGrid)
        {
            var right = footerGrid.Children.OfType<TextBlock>().FirstOrDefault(text => Grid.GetColumn(text) == 1);
            if (right is not null) right.Visibility = dense ? Visibility.Collapsed : Visibility.Visible;
        }
    }

    private static void ApplySettings(SettingsControl settings, UiDensityMode mode)
    {
        var scroll = settings.Content as ScrollViewer ?? FindDescendants<ScrollViewer>(settings).FirstOrDefault();
        if (scroll?.Content is not Grid root) return;

        var width = settings.ActualWidth > 0 ? settings.ActualWidth : scroll.ActualWidth;
        var compact = width < 900 || mode == UiDensityMode.Compact;
        var dense = width < 760;
        root.MaxWidth = 1180;
        root.HorizontalAlignment = HorizontalAlignment.Stretch;
        root.Margin = dense ? new Thickness(10, 9, 10, 15) : compact ? new Thickness(13) : new Thickness(18);

        foreach (var section in root.Children.OfType<Border>())
        {
            section.Padding = dense ? new Thickness(13) : compact ? new Thickness(15) : new Thickness(18);
            if (section.Child is Grid sectionGrid
                && sectionGrid.ColumnDefinitions.Count >= 2
                && sectionGrid.ColumnDefinitions[0].Width.IsAbsolute
                && sectionGrid.ColumnDefinitions[0].Width.Value >= 150)
            {
                sectionGrid.ColumnDefinitions[0].Width = new GridLength(dense ? 112 : compact ? 132 : 160);
            }
        }

        foreach (var grid in FindDescendants<Grid>(root))
        {
            if (grid.ColumnDefinitions.Count == 0) continue;
            var first = grid.ColumnDefinitions[0].Width;
            if (first.IsAbsolute && first.Value >= 180 && first.Value <= 205)
                grid.ColumnDefinitions[0].Width = new GridLength(dense ? 118 : compact ? 148 : 180);
        }

        var footer = root.Children.OfType<Grid>().FirstOrDefault(grid => Grid.GetRow(grid) == 10);
        if (footer is not null)
        {
            var actions = footer.Children.OfType<StackPanel>().FirstOrDefault(panel => Grid.GetColumn(panel) == 0);
            if (actions is not null)
            {
                actions.Orientation = dense ? Orientation.Vertical : Orientation.Horizontal;
                for (var index = 0; index < actions.Children.Count; index++)
                {
                    if (actions.Children[index] is not Button button) continue;
                    button.Margin = dense
                        ? new Thickness(0, 0, 0, 6)
                        : new Thickness(index == 0 ? 0 : 8, 0, 0, 0);
                }
            }
        }
    }

    private static void ApplyGenericPage(UserControl control, UiDensityMode mode)
    {
        var scroll = control.Content as ScrollViewer ?? FindDescendants<ScrollViewer>(control).FirstOrDefault();
        if (scroll?.Content is Grid root)
        {
            root.Margin = mode == UiDensityMode.Compact ? new Thickness(11) : new Thickness(16);
            root.MinWidth = 0;
        }
    }

    private void Audit(UiDensityMode mode)
    {
        if (_contentGrid is null || _sidebarColumn is null) return;

        var dpi = VisualTreeHelper.GetDpi(_window);
        var contentWidth = _contentGrid.ActualWidth;
        var contentHeight = _contentGrid.ActualHeight;
        var sidebarWidth = _sidebarColumn.ActualWidth;
        var healthy = contentWidth >= 680 && contentHeight >= 450;
        var detail = healthy
            ? "关键内容区尺寸正常，未触发强制收缩"
            : "内容区偏小，已切换紧凑密度并压缩侧栏";

        if (!healthy && sidebarWidth > 90 && _sidebarColumn.Width.Value > 164)
        {
            _sidebarColumn.Width = new GridLength(164);
            sidebarWidth = 164;
        }

        UiAdaptiveAuditService.Update(new UiAdaptiveAuditSnapshot(
            mode,
            _window.ActualWidth,
            _window.ActualHeight,
            contentWidth,
            contentHeight,
            sidebarWidth,
            dpi.DpiScaleX,
            healthy,
            detail));

        if (_lastAuditHealthy != healthy)
        {
            _lastAuditHealthy = healthy;
            App.Log("UI adaptive audit: " + detail
                    + $"; mode={mode}; window={_window.ActualWidth:0}x{_window.ActualHeight:0}; "
                    + $"content={contentWidth:0}x{contentHeight:0}; dpi={dpi.DpiScaleX:0.00}");
        }
    }

    private void PolishTree(DependencyObject root)
    {
        if (!_polished.Add(root)) return;
        if (root is FrameworkElement element)
            PolishElement(element);

        var count = VisualTreeHelper.GetChildrenCount(root);
        for (var index = 0; index < count; index++)
            PolishTree(VisualTreeHelper.GetChild(root, index));
    }

    private void PolishElement(FrameworkElement element)
    {
        switch (element)
        {
            case Border border:
                SwapStyle(border, "SurfaceCard", "ConvergedSurfaceCard");
                SwapStyle(border, "ToolbarCard", "ConvergedToolbarCard");
                SwapStyle(border, "HomeCard", "ConvergedHomeCard");
                break;
            case Button button:
                SwapStyle(button, "PrimaryButton", "ConvergedPrimaryButton");
                SwapStyle(button, "SecondaryButton", "ConvergedSecondaryButton");
                SwapStyle(button, "TextButton", "ConvergedTextButton");
                SwapStyle(button, "IconButton", "ConvergedIconButton");
                break;
            case TextBox textBox when !textBox.AcceptsReturn && !textBox.AcceptsTab:
                SwapImplicitStyle(textBox, typeof(TextBox), "ConvergedTextBox");
                break;
            case ComboBox comboBox:
                SwapImplicitStyle(comboBox, typeof(ComboBox), "ConvergedComboBox");
                break;
            case CheckBox checkBox:
                SwapImplicitStyle(checkBox, typeof(CheckBox), "ConvergedCheckBox");
                break;
            case TabItem tabItem:
                SwapImplicitStyle(tabItem, typeof(TabItem), "ConvergedTabItem");
                break;
            case ListViewItem listViewItem:
                SwapImplicitStyle(listViewItem, typeof(ListViewItem), "ConvergedListViewItem");
                break;
            case TextBlock textBlock:
                SwapStyle(textBlock, "PageHeading", "ConvergedPageHeading");
                SwapStyle(textBlock, "PageDescription", "ConvergedPageDescription");
                SwapStyle(textBlock, "SectionHeading", "ConvergedSectionHeading");
                break;
        }
    }

    private void SwapStyle(FrameworkElement element, object legacyKey, string replacementKey)
    {
        var legacy = Application.Current.TryFindResource(legacyKey) as Style;
        if (legacy is null || !StyleMatches(element.Style, legacy)) return;
        element.Style = StyleOf(replacementKey);
    }

    private void SwapImplicitStyle(FrameworkElement element, object legacyKey, string replacementKey)
    {
        var legacy = Application.Current.TryFindResource(legacyKey) as Style;
        if (legacy is null || !StyleMatches(element.Style, legacy)) return;
        element.Style = StyleOf(replacementKey);
    }

    private Style StyleOf(string key)
        => _theme[key] as Style
           ?? throw new InvalidOperationException("Missing UI convergence style: " + key);

    private static bool StyleMatches(Style? candidate, Style target)
    {
        for (var current = candidate; current is not null; current = current.BasedOn)
            if (ReferenceEquals(current, target)) return true;
        return false;
    }

    private static SolidColorBrush BrushOf(string value)
        => (SolidColorBrush)new BrushConverter().ConvertFromString(value)!;

    private static IEnumerable<T> FindDescendants<T>(DependencyObject root) where T : DependencyObject
    {
        var count = VisualTreeHelper.GetChildrenCount(root);
        for (var index = 0; index < count; index++)
        {
            var child = VisualTreeHelper.GetChild(root, index);
            if (child is T match) yield return match;
            foreach (var nested in FindDescendants<T>(child)) yield return nested;
        }
    }
}
