using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PersonalWorkbench;

public sealed class V066BackupEnhancer
{
    private readonly MainWindow _window;
    private BackupRestoreWindow? _backupWindow;

    private V066BackupEnhancer(MainWindow window)
    {
        _window = window;
        InstallButton();
    }

    public static V066BackupEnhancer Attach(MainWindow window) => new(window);

    private void InstallButton()
    {
        if (_window.FindName("PopoutButton") is not Button popout || popout.Parent is not StackPanel actions) return;
        if (actions.Children.OfType<Button>().Any(button => Equals(button.Tag, "backup-v066"))) return;
        var button = new Button
        {
            Tag = "backup-v066",
            Style = Application.Current.TryFindResource("IconButton") as Style,
            ToolTip = "备份与迁移 · 导出、校验或恢复本地配置"
        };
        button.Content = new Viewbox
        {
            Width = 17, Height = 17,
            Child = new System.Windows.Shapes.Path
            {
                Data = Geometry.Parse("M5,4 H17 L21,8 V20 H5 Z M8,4 V10 H17 V4 M9,20 V14 H17 V20 M12,7 H15"),
                Stroke = new SolidColorBrush(Color.FromRgb(91, 111, 139)), StrokeThickness = 1.7,
                Fill = Brushes.Transparent, StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round
            }
        };
        button.Click += (_, _) => OpenWindow();
        actions.Children.Insert(Math.Max(0, actions.Children.Count - 1), button);
    }

    private void OpenWindow()
    {
        if (_backupWindow is { IsVisible: true })
        {
            _backupWindow.Activate();
            return;
        }
        _backupWindow = new BackupRestoreWindow { Owner = _window };
        _backupWindow.Closed += (_, _) => _backupWindow = null;
        _backupWindow.Show();
    }
}
