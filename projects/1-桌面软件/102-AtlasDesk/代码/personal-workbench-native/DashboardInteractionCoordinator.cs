using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.Diagnostics;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace PersonalWorkbench;

/// <summary>
/// Completes the Dashboard mixed-navigation policy for ordinary top-level
/// navigations and provides a WebView2-safe fullscreen exit handle.
/// </summary>
public sealed class DashboardInteractionCoordinator : IDisposable
{
    private static readonly FieldInfo? MainDashboardField = typeof(MainWindow)
        .GetField("_dashboardWebView", BindingFlags.Instance | BindingFlags.NonPublic);
    private static readonly FieldInfo? PopupDashboardField = typeof(MainWindow)
        .GetField("_popupWebView", BindingFlags.Instance | BindingFlags.NonPublic);
    private static readonly FieldInfo? DashboardPopupField = typeof(MainWindow)
        .GetField("_dashboardPopup", BindingFlags.Instance | BindingFlags.NonPublic);
    private static readonly FieldInfo? FocusModeField = typeof(MainWindow)
        .GetField("_focusMode", BindingFlags.Instance | BindingFlags.NonPublic);
    private static readonly MethodInfo? ToggleFocusModeMethod = typeof(MainWindow)
        .GetMethod("ToggleFocusMode", BindingFlags.Instance | BindingFlags.NonPublic);
    private static readonly MethodInfo? TogglePopupFullscreenMethod = typeof(MainWindow)
        .GetMethod("TogglePopupFullscreen", BindingFlags.Instance | BindingFlags.NonPublic);

    private readonly MainWindow _window;
    private readonly AppSettings _settings;
    private readonly HashSet<CoreWebView2> _configuredCores = new();
    private FullscreenExitHandleWindow? _exitHandle;
    private Window? _exitHandleOwner;
    private bool _synchronizing;
    private bool _disposed;

    private DashboardInteractionCoordinator(MainWindow window, AppSettings settings)
    {
        _window = window;
        _settings = settings;
        _window.LayoutUpdated += Window_LayoutUpdated;
        _window.LocationChanged += Window_GeometryChanged;
        _window.SizeChanged += Window_GeometryChanged;
        _window.StateChanged += Window_StateChanged;
        _window.Activated += Window_Activated;
        _window.Deactivated += Window_Deactivated;
        _window.Closed += Window_Closed;
        _window.Dispatcher.BeginInvoke(new Action(Synchronize));
    }

    public static DashboardInteractionCoordinator Attach(MainWindow window, AppSettings settings)
        => new(window, settings);

    public static bool ShouldOpenExternally(string? requestedUri, string? dashboardRootUri)
    {
        if (!Uri.TryCreate(requestedUri, UriKind.Absolute, out var requested)
            || requested.Scheme is not ("http" or "https"))
        {
            return false;
        }

        return DashboardNavigationPolicy.Classify(requestedUri, dashboardRootUri)
               == DashboardNavigationTarget.ExternalBrowser;
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;
        _window.LayoutUpdated -= Window_LayoutUpdated;
        _window.LocationChanged -= Window_GeometryChanged;
        _window.SizeChanged -= Window_GeometryChanged;
        _window.StateChanged -= Window_StateChanged;
        _window.Activated -= Window_Activated;
        _window.Deactivated -= Window_Deactivated;
        _window.Closed -= Window_Closed;

        foreach (var core in _configuredCores)
        {
            try { core.NavigationStarting -= Core_NavigationStarting; }
            catch { }
        }
        _configuredCores.Clear();
        CloseExitHandle();
    }

    private void Window_Closed(object? sender, EventArgs e) => Dispose();
    private void Window_LayoutUpdated(object? sender, EventArgs e) => Synchronize();
    private void Window_GeometryChanged(object? sender, EventArgs e) => UpdateFullscreenExitHandle();
    private void Window_StateChanged(object? sender, EventArgs e) => UpdateFullscreenExitHandle();
    private void Window_Activated(object? sender, EventArgs e) => UpdateFullscreenExitHandle();
    private void Window_Deactivated(object? sender, EventArgs e)
    {
        if (_exitHandle is not null)
            _exitHandle.Visibility = Visibility.Hidden;
    }

    private void Synchronize()
    {
        if (_disposed || _synchronizing)
            return;

        _synchronizing = true;
        try
        {
            ConfigureView(MainDashboardField?.GetValue(_window) as WebView2);
            ConfigureView(PopupDashboardField?.GetValue(_window) as WebView2);
            UpdateFullscreenExitHandle();
        }
        catch (Exception ex)
        {
            App.Log("Dashboard interaction synchronization failed: " + ex);
        }
        finally
        {
            _synchronizing = false;
        }
    }

    private void ConfigureView(WebView2? view)
    {
        if (view?.CoreWebView2 is not { } core || !_configuredCores.Add(core))
            return;

        core.NavigationStarting += Core_NavigationStarting;
        App.Log("Dashboard top-level navigation guard attached");
    }

    private void Core_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs args)
    {
        try
        {
            if (!ShouldOpenExternally(args.Uri, _settings.DashboardUrl))
                return;

            args.Cancel = true;
            var target = args.Uri;
            App.Log("Dashboard top-level external navigation redirected to default browser: " + target);
            _window.Dispatcher.BeginInvoke(new Action(() => OpenExternalUri(target)));
        }
        catch (Exception ex)
        {
            App.Log("Dashboard top-level navigation guard failed: " + ex);
        }
    }

    private static void OpenExternalUri(string? target)
    {
        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https"))
        {
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            App.Log("Dashboard guarded external navigation could not open browser: " + ex);
        }
    }

    private void UpdateFullscreenExitHandle()
    {
        if (_disposed)
            return;

        var popup = DashboardPopupField?.GetValue(_window) as Window;
        var popupFullscreen = popup is { IsVisible: true, WindowStyle: WindowStyle.None, WindowState: WindowState.Maximized };
        var focusMode = FocusModeField?.GetValue(_window) is true;

        Window? owner = null;
        Action? exitAction = null;
        if (popupFullscreen && popup is not null)
        {
            owner = popup;
            exitAction = () => TogglePopupFullscreenMethod?.Invoke(_window, null);
        }
        else if (focusMode && _window.IsVisible)
        {
            owner = _window;
            exitAction = () => ToggleFocusModeMethod?.Invoke(_window, null);
        }

        if (owner is null || exitAction is null)
        {
            CloseExitHandle();
            return;
        }

        if (_exitHandle is null || !ReferenceEquals(_exitHandleOwner, owner))
        {
            CloseExitHandle();
            _exitHandleOwner = owner;
            _exitHandle = new FullscreenExitHandleWindow(() =>
            {
                try { exitAction(); }
                catch (Exception ex) { App.Log("Exit Dashboard fullscreen failed: " + ex); }
                finally { CloseExitHandle(); }
            })
            {
                Owner = owner
            };
            _exitHandle.Show();
        }

        PositionExitHandle(owner);
        if (owner.IsActive && _exitHandle.Visibility != Visibility.Visible)
            _exitHandle.Visibility = Visibility.Visible;
    }

    private void PositionExitHandle(Window owner)
    {
        if (_exitHandle is null)
            return;

        var width = owner.ActualWidth > 0 ? owner.ActualWidth : owner.Width;
        _exitHandle.Left = owner.Left + Math.Max(8, width - _exitHandle.Width - 10);
        _exitHandle.Top = owner.Top + 2;
    }

    private void CloseExitHandle()
    {
        var handle = _exitHandle;
        _exitHandle = null;
        _exitHandleOwner = null;
        if (handle is null)
            return;

        try
        {
            handle.Owner = null;
            handle.Close();
        }
        catch { }
    }

    private sealed class FullscreenExitHandleWindow : Window
    {
        private readonly Border _drawer;

        public FullscreenExitHandleWindow(Action exitAction)
        {
            Width = 172;
            Height = 52;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ShowInTaskbar = false;
            ShowActivated = false;
            Topmost = true;
            Focusable = false;

            var surface = new Grid
            {
                Background = new SolidColorBrush(Color.FromArgb(1, 0, 0, 0)),
                Cursor = Cursors.Arrow
            };
            var hint = new Border
            {
                Width = 52,
                Height = 3,
                CornerRadius = new CornerRadius(0, 0, 3, 3),
                Background = new SolidColorBrush(Color.FromRgb(82, 133, 220)),
                Opacity = 0.75,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 0, 14, 0)
            };
            _drawer = new Border
            {
                Width = 146,
                Height = 34,
                CornerRadius = new CornerRadius(0, 0, 10, 10),
                Background = new SolidColorBrush(Color.FromRgb(31, 66, 108)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(92, 139, 202)),
                BorderThickness = new Thickness(1),
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 4, 8, 0),
                Opacity = 0,
                IsHitTestVisible = false,
                Cursor = Cursors.Hand,
                RenderTransform = new TranslateTransform(0, -8),
                Child = new TextBlock
                {
                    Text = "退出全屏   Esc",
                    Foreground = Brushes.White,
                    FontSize = 12,
                    FontWeight = FontWeights.SemiBold,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center
                }
            };
            _drawer.MouseLeftButtonUp += (_, _) => exitAction();
            surface.MouseEnter += (_, _) => ShowDrawer();
            surface.MouseLeave += (_, _) => HideDrawer();
            surface.Children.Add(hint);
            surface.Children.Add(_drawer);
            Content = surface;
        }

        private void ShowDrawer()
        {
            _drawer.IsHitTestVisible = true;
            _drawer.BeginAnimation(OpacityProperty, new DoubleAnimation(1, TimeSpan.FromMilliseconds(120)));
            if (_drawer.RenderTransform is TranslateTransform transform)
                transform.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, TimeSpan.FromMilliseconds(120)));
        }

        private void HideDrawer()
        {
            _drawer.IsHitTestVisible = false;
            _drawer.BeginAnimation(OpacityProperty, new DoubleAnimation(0, TimeSpan.FromMilliseconds(120)));
            if (_drawer.RenderTransform is TranslateTransform transform)
                transform.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(-8, TimeSpan.FromMilliseconds(120)));
        }
    }
}
