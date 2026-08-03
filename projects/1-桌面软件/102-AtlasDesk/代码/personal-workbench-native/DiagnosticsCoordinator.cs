using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;

namespace PersonalWorkbench;

public sealed class DiagnosticsCoordinator : IDisposable
{
    private readonly MainWindow _window;
    private readonly AppSettings _settings;
    private DiagnosticsWindow? _diagnosticsWindow;
    private bool _disposed;

    private DiagnosticsCoordinator(MainWindow window, AppSettings settings)
    {
        _window = window;
        _settings = settings;
        InstallDiagnosticsButton();
        _window.Closed += Window_Closed;
    }

    public static DiagnosticsCoordinator Attach(MainWindow window, AppSettings settings)
        => new(window, settings);

    private void InstallDiagnosticsButton()
    {
        if (_window.FindName("PopoutButton") is not Button popout
            || popout.Parent is not StackPanel actions)
            return;
        if (actions.Children.OfType<Button>().Any(button => Equals(button.Tag, "diagnostics-coordinator")))
            return;

        var button = new Button
        {
            Tag = "diagnostics-coordinator",
            Style = Application.Current.TryFindResource("IconButton") as Style,
            ToolTip = App.IsSafeMode
                ? "诊断中心 · 当前处于安全启动"
                : StartupGuard.PreviousSessionUnclean
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
        if (StartupGuard.PreviousSessionUnclean || App.IsSafeMode)
        {
            grid.Children.Add(new Ellipse
            {
                Width = 6,
                Height = 6,
                Fill = new SolidColorBrush(Color.FromRgb(220, 77, 86)),
                Stroke = Brushes.White,
                StrokeThickness = 1.2,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, -2, -2, 0)
            });
        }
        button.Content = grid;
        button.Click += (_, _) => OpenDiagnostics();
        actions.Children.Insert(Math.Max(0, actions.Children.Count - 1), button);
    }

    private void OpenDiagnostics()
    {
        if (_disposed) return;
        if (_diagnosticsWindow is { IsVisible: true })
        {
            _diagnosticsWindow.Activate();
            return;
        }

        var diagnostics = new DiagnosticsWindow(_settings) { Owner = _window };
        _diagnosticsWindow = diagnostics;
        diagnostics.Closed += (_, _) =>
        {
            if (ReferenceEquals(_diagnosticsWindow, diagnostics))
                _diagnosticsWindow = null;
        };
        diagnostics.Show();
    }

    private void Window_Closed(object? sender, EventArgs e) => Dispose();

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _window.Closed -= Window_Closed;
        try { _diagnosticsWindow?.Close(); } catch { }
        _diagnosticsWindow = null;
    }
}
