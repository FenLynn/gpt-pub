using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace PersonalWorkbench;

public sealed record UiQualityAuditSnapshot(
    int InteractiveControls,
    int KeyboardFocusableControls,
    int NavigationFocusableControls,
    int NavigationTabStops,
    int MissingAutomationNames,
    int TinyTargets,
    int CriticalLayoutClips,
    bool HighContrast,
    bool Healthy,
    string Detail);

public static class UiQualityAuditService
{
    private static readonly object Gate = new();
    private static UiQualityAuditSnapshot? _current;

    public static UiQualityAuditSnapshot? Current
    {
        get
        {
            lock (Gate) return _current;
        }
    }

    internal static void Update(UiQualityAuditSnapshot snapshot)
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
                Name = "键盘与可访问性",
                Severity = DiagnosticSeverity.Warning,
                Detail = "主窗口尚未完成可访问性与结构布局审计"
            };
        }

        return new DiagnosticCheck
        {
            Name = "键盘与可访问性",
            Severity = snapshot.Healthy ? DiagnosticSeverity.Ok : DiagnosticSeverity.Warning,
            Detail = $"交互控件 {snapshot.InteractiveControls} · 可键盘到达 {snapshot.KeyboardFocusableControls} · "
                     + $"导航焦点 {snapshot.NavigationFocusableControls}/8 · Tab 入口 {snapshot.NavigationTabStops} · "
                     + $"缺少名称 {snapshot.MissingAutomationNames} · 小目标 {snapshot.TinyTargets} · "
                     + $"裁切 {snapshot.CriticalLayoutClips} · 高对比度 {(snapshot.HighContrast ? "开启" : "关闭")} · {snapshot.Detail}"
        };
    }
}

public sealed class AccessibilityCoordinator : IDisposable
{
    private static readonly string[] NavigationNames =
    {
        "HomeNav", "WorkspaceNav", "LibraryNav", "DevelopmentNav",
        "ToolsNav", "DashboardNav", "TasksNav", "SettingsNav"
    };

    private static readonly IReadOnlyDictionary<string, string> NamedControlLabels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["BrandToggleButton"] = "折叠或展开导航目录",
            ["CommandButton"] = "搜索或执行命令",
            ["PopoutButton"] = "弹出当前页面",
            ["FullscreenButton"] = "切换全屏显示",
            ["HomeNav"] = "首页",
            ["WorkspaceNav"] = "工作区",
            ["LibraryNav"] = "资料库",
            ["DevelopmentNav"] = "开发",
            ["ToolsNav"] = "工具",
            ["DashboardNav"] = "Dashboard",
            ["TasksNav"] = "任务",
            ["SettingsNav"] = "设置"
        };

    private readonly MainWindow _window;
    private readonly RoutedEventHandler _loadedHandler;
    private readonly HashSet<DependencyObject> _processed = new(ReferenceEqualityComparer.Instance);
    private readonly Dictionary<Control, Dictionary<DependencyProperty, object>> _highContrastOriginals =
        new(ReferenceEqualityComparer.Instance);
    private readonly List<RadioButton> _navigation = new();
    private bool _auditQueued;
    private bool _disposed;

    private AccessibilityCoordinator(MainWindow window)
    {
        _window = window;
        _loadedHandler = OnElementLoaded;
        EnsureTheme(window);
        ConfigureNavigation();
        KeyboardNavigation.SetTabNavigation(_window, KeyboardNavigationMode.Continue);
        KeyboardNavigation.SetControlTabNavigation(_window, KeyboardNavigationMode.Continue);

        _window.AddHandler(FrameworkElement.LoadedEvent, _loadedHandler, true);
        _window.SizeChanged += Window_SizeChanged;
        _window.Closed += Window_Closed;
        SystemParameters.StaticPropertyChanged += SystemParameters_StaticPropertyChanged;
        if (Application.Current is not null)
            Application.Current.Activated += Application_Activated;

        _window.Dispatcher.BeginInvoke(new Action(() =>
        {
            PrepareWindow(_window);
            AuditNow();
        }), DispatcherPriority.ContextIdle);
    }

    public static AccessibilityCoordinator Attach(MainWindow window) => new(window);

    public static void PrepareWindow(Window window)
    {
        EnsureTheme(window);
        var focusStyle = FindFocusStyle(window);
        ApplySubtree(window, focusStyle, SystemParameters.HighContrast, null, null);
        KeyboardNavigation.SetTabNavigation(window, KeyboardNavigationMode.Continue);
        KeyboardNavigation.SetControlTabNavigation(window, KeyboardNavigationMode.Continue);
    }

    public UiQualityAuditSnapshot AuditNow()
    {
        if (_disposed)
            return UiQualityAuditService.Current ?? EmptySnapshot("可访问性协调器已释放");

        PrepareAllApplicationWindows();
        UpdateNavigationTabStops();
        _window.UpdateLayout();

        var interactive = 0;
        var keyboardFocusable = 0;
        var missingNames = 0;
        var tinyTargets = 0;
        var clips = 0;

        foreach (var element in Descendants<FrameworkElement>(_window).Prepend(_window))
        {
            if (!element.IsVisible || !element.IsEnabled) continue;
            if (!IsInteractive(element)) continue;

            interactive++;
            if (element is Control control && control.Focusable && control.IsTabStop)
                keyboardFocusable++;

            if (element is ButtonBase button && IsIconOnly(button))
            {
                if (string.IsNullOrWhiteSpace(AutomationProperties.GetName(button)))
                    missingNames++;
                if (button.ActualWidth > 0 && button.ActualHeight > 0
                    && (button.ActualWidth < 24 || button.ActualHeight < 24))
                    tinyTargets++;
            }

            if (IsCriticalLayoutElement(element) && IsMeaningfullyClipped(element))
                clips++;
        }

        var navigationFocusable = _navigation.Count(item => item.Focusable);
        var navigationTabStops = _navigation.Count(item => item.IsTabStop);
        var healthy = navigationFocusable == NavigationNames.Length
                      && navigationTabStops == 1
                      && missingNames == 0
                      && tinyTargets == 0
                      && clips == 0;
        var detail = healthy
            ? "焦点、辅助名称与关键布局边界正常"
            : "存在需要关注的焦点、辅助名称或布局边界";

        var snapshot = new UiQualityAuditSnapshot(
            interactive,
            keyboardFocusable,
            navigationFocusable,
            navigationTabStops,
            missingNames,
            tinyTargets,
            clips,
            SystemParameters.HighContrast,
            healthy,
            detail);
        UiQualityAuditService.Update(snapshot);
        return snapshot;
    }

    private static UiQualityAuditSnapshot EmptySnapshot(string detail)
        => new(0, 0, 0, 0, 0, 0, 0, SystemParameters.HighContrast, false, detail);

    private void ConfigureNavigation()
    {
        foreach (var name in NavigationNames)
        {
            if (_window.FindName(name) is not RadioButton navigation) continue;
            navigation.Focusable = true;
            navigation.Checked += Navigation_Checked;
            navigation.PreviewKeyDown += Navigation_PreviewKeyDown;
            _navigation.Add(navigation);
            ApplyAccessibleName(navigation);
        }

        if (_navigation.FirstOrDefault()?.Parent is DependencyObject navigationHost)
        {
            KeyboardNavigation.SetDirectionalNavigation(navigationHost, KeyboardNavigationMode.Cycle);
            KeyboardNavigation.SetTabNavigation(navigationHost, KeyboardNavigationMode.Once);
        }
        UpdateNavigationTabStops();
    }

    private void Navigation_Checked(object sender, RoutedEventArgs e)
    {
        UpdateNavigationTabStops();
        QueueAudit();
    }

    private void Navigation_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (sender is not RadioButton current || _navigation.Count == 0) return;
        var index = _navigation.IndexOf(current);
        var next = e.Key switch
        {
            Key.Up or Key.Left => (index - 1 + _navigation.Count) % _navigation.Count,
            Key.Down or Key.Right => (index + 1) % _navigation.Count,
            Key.Home => 0,
            Key.End => _navigation.Count - 1,
            _ => -1
        };
        if (next < 0) return;

        e.Handled = true;
        var target = _navigation[next];
        target.IsChecked = true;
        target.Focus();
    }

    private void UpdateNavigationTabStops()
    {
        if (_navigation.Count == 0) return;
        var selected = _navigation.FirstOrDefault(item => item.IsChecked == true) ?? _navigation[0];
        foreach (var navigation in _navigation)
        {
            navigation.Focusable = true;
            navigation.IsTabStop = ReferenceEquals(navigation, selected);
            navigation.FocusVisualStyle = FindFocusStyle(_window);
        }
    }

    private void OnElementLoaded(object sender, RoutedEventArgs e)
    {
        if (e.OriginalSource is DependencyObject source)
            ApplyTree(source);
        QueueAudit();
    }

    private void Window_SizeChanged(object sender, SizeChangedEventArgs e) => QueueAudit();

    private void Application_Activated(object? sender, EventArgs e)
    {
        PrepareAllApplicationWindows();
        QueueAudit();
    }

    private void SystemParameters_StaticPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (!string.Equals(e.PropertyName, nameof(SystemParameters.HighContrast), StringComparison.Ordinal)) return;
        _window.Dispatcher.BeginInvoke(new Action(() =>
        {
            PrepareAllApplicationWindows();
            QueueAudit();
        }), DispatcherPriority.Loaded);
    }

    private void PrepareAllApplicationWindows()
    {
        if (Application.Current is null) return;
        foreach (Window window in Application.Current.Windows)
        {
            EnsureTheme(window);
            ApplyTree(window);
        }
    }

    private void ApplyTree(DependencyObject root)
    {
        var focusStyle = FindFocusStyle(_window);
        ApplySubtree(root, focusStyle, SystemParameters.HighContrast, _processed, _highContrastOriginals);
    }

    private static void ApplySubtree(
        DependencyObject root,
        Style? focusStyle,
        bool highContrast,
        HashSet<DependencyObject>? processed,
        Dictionary<Control, Dictionary<DependencyProperty, object>>? highContrastOriginals)
    {
        if (processed is not null && !processed.Add(root))
        {
            if (root is Control existingControl)
                ApplyHighContrast(existingControl, highContrast, highContrastOriginals);
            return;
        }

        if (root is FrameworkElement element)
        {
            if (element is Control control)
            {
                if (control.Focusable && focusStyle is not null)
                    control.FocusVisualStyle = focusStyle;
                ApplyHighContrast(control, highContrast, highContrastOriginals);
            }
            ApplyAccessibleName(element);
        }

        int count;
        try { count = VisualTreeHelper.GetChildrenCount(root); }
        catch { return; }
        for (var index = 0; index < count; index++)
            ApplySubtree(VisualTreeHelper.GetChild(root, index), focusStyle, highContrast, processed, highContrastOriginals);
    }

    private static void ApplyAccessibleName(FrameworkElement element)
    {
        var tooltip = element.ToolTip as string;
        if (!string.IsNullOrWhiteSpace(tooltip)
            && string.IsNullOrWhiteSpace(AutomationProperties.GetHelpText(element)))
            AutomationProperties.SetHelpText(element, tooltip);

        if (element.Name == "UserCard")
        {
            AutomationProperties.SetName(element, "本地工作台状态：可用");
            AutomationProperties.SetLiveSetting(element, AutomationLiveSetting.Polite);
            return;
        }

        if (element is not ButtonBase and not RadioButton) return;
        if (!string.IsNullOrWhiteSpace(AutomationProperties.GetName(element))) return;

        var name = ResolveAccessibleName(element);
        if (!string.IsNullOrWhiteSpace(name))
            AutomationProperties.SetName(element, name);
    }

    private static string ResolveAccessibleName(FrameworkElement element)
    {
        if (element.ToolTip is string tooltip && !string.IsNullOrWhiteSpace(tooltip))
            return tooltip;
        if (!string.IsNullOrWhiteSpace(element.Name)
            && NamedControlLabels.TryGetValue(element.Name, out var mapped))
            return mapped;
        if (element is ContentControl content)
        {
            if (content.Content is string text && !string.IsNullOrWhiteSpace(text))
                return text.Trim();
            var textBlock = Descendants<TextBlock>(content).FirstOrDefault(item => !string.IsNullOrWhiteSpace(item.Text));
            if (textBlock is not null)
                return textBlock.Text.Trim();
        }
        if (!string.IsNullOrWhiteSpace(element.Name))
            return HumanizeIdentifier(element.Name);
        return string.Empty;
    }

    private static string HumanizeIdentifier(string identifier)
    {
        foreach (var suffix in new[] { "Button", "Nav", "Toggle", "Action" })
            if (identifier.EndsWith(suffix, StringComparison.Ordinal))
                identifier = identifier[..^suffix.Length];
        if (string.IsNullOrWhiteSpace(identifier)) return string.Empty;

        var result = new System.Text.StringBuilder(identifier.Length + 8);
        for (var index = 0; index < identifier.Length; index++)
        {
            var character = identifier[index];
            if (index > 0 && char.IsUpper(character) && !char.IsUpper(identifier[index - 1]))
                result.Append(' ');
            result.Append(character);
        }
        return result.ToString();
    }

    private static bool IsInteractive(FrameworkElement element)
        => element is ButtonBase
            or TextBoxBase
            or ComboBox
            or CheckBox
            or RadioButton
            or TreeViewItem
            or ListViewItem
            or TabItem;

    private static bool IsIconOnly(ButtonBase button)
    {
        if (button.Content is string text)
            return string.IsNullOrWhiteSpace(text);
        if (button.Content is TextBlock textBlock)
            return string.IsNullOrWhiteSpace(textBlock.Text);
        return button.Content is not null;
    }

    private static bool IsCriticalLayoutElement(FrameworkElement element)
        => element is ButtonBase or TextBoxBase or ComboBox or TabItem;

    private static bool IsMeaningfullyClipped(FrameworkElement element)
    {
        if (element.ActualWidth <= 0 || element.ActualHeight <= 0) return false;
        var clip = LayoutInformation.GetLayoutClip(element);
        if (clip is null) return false;
        var bounds = clip.Bounds;
        return bounds.Width + 1 < element.ActualWidth || bounds.Height + 1 < element.ActualHeight;
    }

    private static void ApplyHighContrast(
        Control control,
        bool enabled,
        Dictionary<Control, Dictionary<DependencyProperty, object>>? originals)
    {
        if (originals is null) return;
        if (!enabled)
        {
            if (!originals.Remove(control, out var values)) return;
            foreach (var pair in values)
            {
                if (ReferenceEquals(pair.Value, DependencyProperty.UnsetValue))
                    control.ClearValue(pair.Key);
                else
                    control.SetValue(pair.Key, pair.Value);
            }
            return;
        }

        if (!IsInteractive(control)) return;
        SaveAndReference(control, Control.ForegroundProperty, SystemColors.ControlTextBrushKey, originals);
        SaveAndReference(control, Control.BorderBrushProperty, SystemColors.ControlTextBrushKey, originals);
        SaveAndReference(
            control,
            Control.BackgroundProperty,
            control is TextBoxBase or ComboBox ? SystemColors.WindowBrushKey : SystemColors.ControlBrushKey,
            originals);
    }

    private static void SaveAndReference(
        Control control,
        DependencyProperty property,
        object resourceKey,
        Dictionary<Control, Dictionary<DependencyProperty, object>> originals)
    {
        if (!originals.TryGetValue(control, out var values))
        {
            values = new Dictionary<DependencyProperty, object>();
            originals[control] = values;
        }
        if (!values.ContainsKey(property))
            values[property] = control.ReadLocalValue(property);
        control.SetResourceReference(property, resourceKey);
    }

    private static void EnsureTheme(Window window)
    {
        if (window.Resources.MergedDictionaries.Any(dictionary =>
                dictionary.Source?.OriginalString.Contains("UiConvergenceResources.xaml", StringComparison.OrdinalIgnoreCase) == true))
            return;
        window.Resources.MergedDictionaries.Add(new ResourceDictionary
        {
            Source = new Uri("/AtlasDesk;component/UiConvergenceResources.xaml", UriKind.RelativeOrAbsolute)
        });
    }

    private static Style? FindFocusStyle(FrameworkElement element)
        => element.TryFindResource("AtlasDeskFocusVisual") as Style
           ?? Application.Current?.TryFindResource("AtlasDeskFocusVisual") as Style;

    private void QueueAudit()
    {
        if (_auditQueued || _disposed) return;
        _auditQueued = true;
        _window.Dispatcher.BeginInvoke(new Action(() =>
        {
            _auditQueued = false;
            if (!_disposed) AuditNow();
        }), DispatcherPriority.ContextIdle);
    }

    private void Window_Closed(object? sender, EventArgs e) => Dispose();

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _window.RemoveHandler(FrameworkElement.LoadedEvent, _loadedHandler);
        _window.SizeChanged -= Window_SizeChanged;
        _window.Closed -= Window_Closed;
        SystemParameters.StaticPropertyChanged -= SystemParameters_StaticPropertyChanged;
        if (Application.Current is not null)
            Application.Current.Activated -= Application_Activated;
        foreach (var navigation in _navigation)
        {
            navigation.Checked -= Navigation_Checked;
            navigation.PreviewKeyDown -= Navigation_PreviewKeyDown;
        }
        foreach (var control in _highContrastOriginals.Keys.ToArray())
            ApplyHighContrast(control, false, _highContrastOriginals);
        _highContrastOriginals.Clear();
        _processed.Clear();
    }

    private static IEnumerable<T> Descendants<T>(DependencyObject root) where T : DependencyObject
    {
        int count;
        try { count = VisualTreeHelper.GetChildrenCount(root); }
        catch { yield break; }
        for (var index = 0; index < count; index++)
        {
            var child = VisualTreeHelper.GetChild(root, index);
            if (child is T match) yield return match;
            foreach (var nested in Descendants<T>(child)) yield return nested;
        }
    }
}
