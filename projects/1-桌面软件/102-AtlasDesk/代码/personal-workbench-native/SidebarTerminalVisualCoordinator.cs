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
/// Final owner for sidebar shortcut placement and neutral terminal chrome.
/// It moves the productivity-context shortcut out of the brand/avatar row and
/// neutralizes the historical blue button override after the terminal is rehosted.
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
    private readonly HashSet<Button> _trackedTerminalButtons = new();
    private bool _themeQueued;
    private bool _disposed;

    private SidebarTerminalVisualCoordinator(MainWindow window, WorkbenchFeaturePipeline pipeline)
    {
        _window = window;
        _terminal = ReadField<TerminalDrawerControl>(pipeline.Base, "_terminal")
                    ?? throw new InvalidOperationException("Terminal module is unavailable.");
        _terminalHost = ReadField<ContentControl>(pipeline.ProjectWorkflow, "_terminalHost");

        MoveProjectContextShortcut();
        _terminal.Loaded += Terminal_Loaded;
        _terminal.IsVisibleChanged += Terminal_IsVisibleChanged;
        _window.Closed += Window_Closed;
        QueueTerminalTheme();

        App.Log("Sidebar/terminal visual coordinator attached: project context moved to command row; terminal uses neutral black CMD chrome");
    }

    public static SidebarTerminalVisualCoordinator Attach(MainWindow window, WorkbenchFeaturePipeline pipeline)
        => new(window, pipeline);

    private static T? ReadField<T>(object instance, string name) where T : class
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) as T;

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
