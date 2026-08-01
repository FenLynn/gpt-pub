using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace PersonalWorkbench;

internal static class ToolTipContrastBootstrap
{
    private static readonly Brush Background = new SolidColorBrush(Color.FromRgb(38, 53, 74));
    private static readonly Brush Foreground = new SolidColorBrush(Color.FromRgb(247, 250, 255));

    [ModuleInitializer]
    internal static void Initialize()
    {
        EventManager.RegisterClassHandler(
            typeof(ToolTip),
            ToolTip.OpenedEvent,
            new RoutedEventHandler(OnToolTipOpened));
    }

    private static void OnToolTipOpened(object sender, RoutedEventArgs e)
    {
        if (sender is not ToolTip toolTip) return;

        toolTip.Background = Background;
        toolTip.Foreground = Foreground;
        toolTip.BorderBrush = new SolidColorBrush(Color.FromRgb(57, 80, 108));
        toolTip.BorderThickness = new Thickness(1);
        toolTip.Padding = new Thickness(9, 6, 9, 6);

        var textStyle = new Style(typeof(TextBlock));
        textStyle.Setters.Add(new Setter(TextBlock.ForegroundProperty, Foreground));
        textStyle.Setters.Add(new Setter(TextBlock.FontFamilyProperty, new FontFamily("Segoe UI, Microsoft YaHei UI")));
        textStyle.Setters.Add(new Setter(TextBlock.FontSizeProperty, 11d));
        toolTip.Resources[typeof(TextBlock)] = textStyle;

        toolTip.Dispatcher.BeginInvoke(
            DispatcherPriority.Loaded,
            new Action(() => ApplyForeground(toolTip)));
    }

    private static void ApplyForeground(DependencyObject root)
    {
        if (root is TextBlock textBlock)
            textBlock.Foreground = Foreground;

        var count = VisualTreeHelper.GetChildrenCount(root);
        for (var index = 0; index < count; index++)
            ApplyForeground(VisualTreeHelper.GetChild(root, index));
    }
}
