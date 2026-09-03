using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace PersonalWorkbench;

public sealed class TerminalFloatingWindow : Window
{
    private readonly Border _contentHost;
    private readonly Button _fullscreenButton;
    private bool _fullScreen;
    private WindowStyle _savedWindowStyle;
    private WindowState _savedWindowState;
    private ResizeMode _savedResizeMode;

    public event EventHandler? DockRequested;

    public TerminalFloatingWindow(string title, UIElement terminalContent)
    {
        Title = string.IsNullOrWhiteSpace(title) ? "AtlasDesk Terminal" : title + " · AtlasDesk";
        Width = 1080;
        Height = 680;
        MinWidth = 720;
        MinHeight = 420;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        Background = Brushes.Black;
        FontFamily = new FontFamily("Segoe UI, Microsoft YaHei UI");
        PreviewKeyDown += Window_PreviewKeyDown;

        var root = new Grid { Background = Brushes.Black };
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(40) });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var header = new Grid
        {
            Background = new SolidColorBrush(Color.FromRgb(10, 10, 10))
        };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.Children.Add(new TextBlock
        {
            Text = string.IsNullOrWhiteSpace(title) ? "终端" : title,
            Foreground = new SolidColorBrush(Color.FromRgb(242, 242, 242)),
            FontSize = 12.5,
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(12, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center
        });

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Margin = new Thickness(0, 0, 9, 0),
            VerticalAlignment = VerticalAlignment.Center
        };
        Grid.SetColumn(actions, 1);
        var topmost = new CheckBox
        {
            Content = "置顶",
            Foreground = new SolidColorBrush(Color.FromRgb(210, 210, 210)),
            FontSize = 11.2,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 10, 0)
        };
        topmost.Checked += (_, _) => Topmost = true;
        topmost.Unchecked += (_, _) => Topmost = false;
        actions.Children.Add(topmost);

        _fullscreenButton = CreateHeaderButton("全屏", 62);
        _fullscreenButton.Margin = new Thickness(0, 0, 7, 0);
        _fullscreenButton.Click += (_, _) => ToggleFullScreen();
        actions.Children.Add(_fullscreenButton);

        var dock = CreateHeaderButton("嵌入回工作台", 100);
        dock.Click += (_, _) => DockRequested?.Invoke(this, EventArgs.Empty);
        actions.Children.Add(dock);
        header.Children.Add(actions);
        root.Children.Add(header);

        _contentHost = new Border
        {
            Background = Brushes.Black,
            BorderBrush = new SolidColorBrush(Color.FromRgb(43, 43, 43)),
            BorderThickness = new Thickness(0, 1, 0, 0),
            Child = terminalContent
        };
        Grid.SetRow(_contentHost, 1);
        root.Children.Add(_contentHost);
        Content = root;
    }

    private static Button CreateHeaderButton(string text, double width)
    {
        return new Button
        {
            Content = text,
            Height = 28,
            MinWidth = width,
            Padding = new Thickness(10, 0, 10, 0),
            Background = new SolidColorBrush(Color.FromRgb(26, 26, 26)),
            Foreground = new SolidColorBrush(Color.FromRgb(245, 245, 245)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(74, 74, 74)),
            BorderThickness = new Thickness(1),
            FontWeight = FontWeights.SemiBold,
            Cursor = Cursors.Hand
        };
    }

    private void ToggleFullScreen()
    {
        if (!_fullScreen)
        {
            _savedWindowStyle = WindowStyle;
            _savedWindowState = WindowState;
            _savedResizeMode = ResizeMode;
            WindowState = WindowState.Normal;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            WindowState = WindowState.Maximized;
            _fullScreen = true;
            _fullscreenButton.Content = "退出全屏";
        }
        else
        {
            ExitFullScreen();
        }
    }

    private void ExitFullScreen()
    {
        if (!_fullScreen) return;
        WindowState = WindowState.Normal;
        WindowStyle = _savedWindowStyle;
        ResizeMode = _savedResizeMode;
        WindowState = _savedWindowState;
        _fullScreen = false;
        _fullscreenButton.Content = "全屏";
    }

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape && _fullScreen)
        {
            ExitFullScreen();
            e.Handled = true;
        }
    }

    public UIElement? ReleaseContent()
    {
        var content = _contentHost.Child;
        _contentHost.Child = null;
        return content;
    }
}
