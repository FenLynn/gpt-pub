using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;

namespace PersonalWorkbench;

public sealed class V062StabilityEnhancer
{
    private readonly MainWindow _window;
    private readonly AppSettings _settings;
    private DiagnosticsWindow? _diagnosticsWindow;

    private V062StabilityEnhancer(MainWindow window, AppSettings settings)
    {
        _window = window;
        _settings = settings;
        InstallDiagnosticsButton();
    }

    public static V062StabilityEnhancer Attach(MainWindow window, AppSettings settings) => new(window, settings);

    private void InstallDiagnosticsButton()
    {
        if (_window.FindName("PopoutButton") is not Button popout || popout.Parent is not StackPanel actions) return;
        if (actions.Children.OfType<Button>().Any(button => Equals(button.Tag, "diagnostics-v062"))) return;

        var button = new Button
        {
            Tag = "diagnostics-v062",
            Style = Application.Current.TryFindResource("IconButton") as Style,
            ToolTip = StartupGuard.PreviousSessionUnclean
                ? "诊断中心 · 检测到上一次可能异常退出"
                : "诊断中心 · 检查运行环境并导出支持包"
        };
        var grid = new Grid { Width = 18, Height = 18 };
        grid.Children.Add(new System.Windows.Shapes.Path
        {
            Data = Geometry.Parse("M12,3 L19,6 V11 C19,15.5 16.2,19 12,21 C7.8,19 5,15.5 5,11 V6 Z M12,8 V13 M12,16 V16.2"),
            Stroke = new SolidColorBrush(Color.FromRgb(91, 111, 139)),
            StrokeThickness = 1.7,
            Fill = Brushes.Transparent,
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
            StrokeLineJoin = PenLineJoin.Round,
            Stretch = Stretch.Uniform
        });
        if (StartupGuard.PreviousSessionUnclean)
        {
            grid.Children.Add(new Ellipse
            {
                Width = 6, Height = 6, Fill = new SolidColorBrush(Color.FromRgb(220, 77, 86)),
                Stroke = Brushes.White, StrokeThickness = 1.2,
                HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, -2, -2, 0)
            });
        }
        button.Content = grid;
        button.Click += (_, _) => OpenDiagnostics();
        actions.Children.Insert(Math.Max(0, actions.Children.Count - 1), button);
    }

    private void OpenDiagnostics()
    {
        if (_diagnosticsWindow is { IsVisible: true })
        {
            _diagnosticsWindow.Activate();
            return;
        }
        _diagnosticsWindow = new DiagnosticsWindow(_settings) { Owner = _window };
        _diagnosticsWindow.Closed += (_, _) => _diagnosticsWindow = null;
        _diagnosticsWindow.Show();
    }
}
