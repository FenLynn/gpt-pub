using Microsoft.Web.WebView2.Wpf;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;

namespace PersonalWorkbench;

/// <summary>
/// Owns cross-cutting shell reliability that must not be implemented by another
/// version-named visual enhancer: monitor work-area bounds, DPI/display changes,
/// final navigation stabilization, and bounded Dashboard health recovery.
/// </summary>
public sealed class ShellResilienceCoordinator : IDisposable
{
    private const int WmGetMinMaxInfo = 0x0024;
    private const int WmDisplayChange = 0x007E;
    private const int WmDpiChanged = 0x02E0;
    private const uint MonitorDefaultToNearest = 0x00000002;

    private readonly MainWindow _window;
    private readonly DispatcherTimer _dashboardWatchdog;
    private readonly SemaphoreSlim _dashboardGate = new(1, 1);
    private readonly List<RadioButton> _navigation = new();
    private HwndSource? _source;
    private long _navigationVersion;
    private DateTimeOffset _lastRecoveryUtc = DateTimeOffset.MinValue;
    private int _recoveryBurst;
    private DateTimeOffset _recoveryBurstStartedUtc = DateTimeOffset.MinValue;
    private bool _disposed;

    private ShellResilienceCoordinator(MainWindow window)
    {
        _window = window;
        _window.UseLayoutRounding = true;
        _window.SnapsToDevicePixels = true;

        _window.SourceInitialized += Window_SourceInitialized;
        _window.StateChanged += Window_DisplayStateChanged;
        _window.LocationChanged += Window_DisplayStateChanged;
        _window.Activated += Window_Activated;
        _window.Closed += Window_Closed;

        foreach (var name in new[]
                 {
                     "HomeNav", "WorkspaceNav", "LibraryNav", "DevelopmentNav",
                     "ToolsNav", "DashboardNav", "TasksNav", "SettingsNav"
                 })
        {
            if (_window.FindName(name) is not RadioButton navigation)
                continue;
            _navigation.Add(navigation);
            navigation.Checked += Navigation_Checked;
        }

        _dashboardWatchdog = new DispatcherTimer(DispatcherPriority.Background, _window.Dispatcher)
        {
            Interval = TimeSpan.FromSeconds(8)
        };
        _dashboardWatchdog.Tick += DashboardWatchdog_Tick;
        _dashboardWatchdog.Start();
    }

    public static ShellResilienceCoordinator Attach(MainWindow window) => new(window);

    private void Window_SourceInitialized(object? sender, EventArgs e)
    {
        _source = PresentationSource.FromVisual(_window) as HwndSource;
        _source?.AddHook(WindowProc);
        ApplyMonitorWorkArea();
    }

    private void Window_DisplayStateChanged(object? sender, EventArgs e)
    {
        _window.Dispatcher.BeginInvoke(DispatcherPriority.Background, ApplyMonitorWorkArea);
    }

    private async void Window_Activated(object? sender, EventArgs e)
    {
        await EnsureDashboardHealthyAsync("window activation");
    }

    private async void Navigation_Checked(object sender, RoutedEventArgs e)
    {
        var version = Interlocked.Increment(ref _navigationVersion);
        await Task.Delay(80);
        if (_disposed || version != Interlocked.Read(ref _navigationVersion))
            return;

        StabilizeNavigation(sender as RadioButton);
        if ((sender as RadioButton)?.Tag?.ToString() == "dashboard")
            await EnsureDashboardHealthyAsync("Dashboard navigation");
        else if (_window.FindName("NavigationProgress") is FrameworkElement progress)
            progress.Visibility = Visibility.Collapsed;
    }

    private void StabilizeNavigation(RadioButton? selected)
    {
        var view = selected?.Tag?.ToString() ?? ReadField<string>("_currentView") ?? "home";
        var roots = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["home"] = "HomeView",
            ["dashboard"] = "DashboardView",
            ["library"] = "LibraryView",
            ["development"] = "DevelopmentView",
            ["settings"] = "SettingsView",
            ["workspace"] = "PlaceholderView",
            ["tools"] = "PlaceholderView",
            ["tasks"] = "PlaceholderView"
        };

        var visibleRoot = roots.TryGetValue(view, out var rootName) ? rootName : "PlaceholderView";
        foreach (var name in roots.Values.Distinct(StringComparer.Ordinal))
        {
            if (_window.FindName(name) is FrameworkElement element)
                element.Visibility = string.Equals(name, visibleRoot, StringComparison.Ordinal)
                    ? Visibility.Visible
                    : Visibility.Collapsed;
        }

        var dashboard = string.Equals(view, "dashboard", StringComparison.OrdinalIgnoreCase);
        SetVisibility("BrowserControls", dashboard);
        SetVisibility("AccessBadge", dashboard);
        SetVisibility("PopoutButton", dashboard);
        SetVisibility("FullscreenButton", dashboard);
    }

    private void SetVisibility(string name, bool visible)
    {
        if (_window.FindName(name) is FrameworkElement element)
            element.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void DashboardWatchdog_Tick(object? sender, EventArgs e)
    {
        await EnsureDashboardHealthyAsync("periodic health check");
    }

    private async Task EnsureDashboardHealthyAsync(string reason)
    {
        if (_disposed || !IsDashboardView())
            return;
        if (!await _dashboardGate.WaitAsync(0))
            return;

        try
        {
            var recoveryInProgress = ReadField<bool>("_dashboardRecoveryInProgress");
            if (recoveryInProgress)
                return;

            var view = ReadField<WebView2>("_dashboardWebView");
            var errorVisible = _window.FindName("DashboardError") is FrameworkElement error
                               && error.Visibility == Visibility.Visible;
            if (view?.CoreWebView2 is not null && !errorVisible)
                return;

            var now = DateTimeOffset.UtcNow;
            if (now - _lastRecoveryUtc < TimeSpan.FromSeconds(3))
                return;
            _lastRecoveryUtc = now;

            if (now - _recoveryBurstStartedUtc > TimeSpan.FromSeconds(30))
            {
                _recoveryBurstStartedUtc = now;
                _recoveryBurst = 0;
            }
            _recoveryBurst++;
            if (_recoveryBurst > 3)
            {
                ShowBoundedRecoveryMessage(reason);
                return;
            }

            App.Log("Shell resilience requested Dashboard recovery: " + reason);
            if (view?.CoreWebView2 is null)
                await InvokePrivateTaskAsync("RecoverDashboardAsync", "shell health check: " + reason);
            else
                await InvokePrivateTaskAsync("EnsureDashboardAsync", true);
        }
        catch (Exception ex)
        {
            App.Log("Shell Dashboard health check failed: " + ex);
            ShowBoundedRecoveryMessage(ex.Message);
        }
        finally
        {
            _dashboardGate.Release();
        }
    }

    private void ShowBoundedRecoveryMessage(string reason)
    {
        if (_window.FindName("DashboardError") is FrameworkElement error)
            error.Visibility = Visibility.Visible;
        if (_window.FindName("DashboardErrorText") is TextBlock text)
        {
            text.Text = "Dashboard 连续恢复未成功，已暂停自动重建，避免影响 AtlasDesk 主窗口。"
                        + "\n\n可点击“重新加载”，或先切换到其他页面后再返回。"
                        + "\n\n最近原因：" + reason;
        }
        if (_window.FindName("NavigationProgress") is FrameworkElement progress)
            progress.Visibility = Visibility.Collapsed;
    }

    private bool IsDashboardView()
        => string.Equals(ReadField<string>("_currentView"), "dashboard", StringComparison.OrdinalIgnoreCase);

    private T? ReadField<T>(string name)
    {
        try
        {
            var value = typeof(MainWindow)
                .GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)
                ?.GetValue(_window);
            return value is T typed ? typed : default;
        }
        catch (Exception ex)
        {
            App.Log($"Shell read field {name} failed: {ex.Message}");
            return default;
        }
    }

    private async Task InvokePrivateTaskAsync(string methodName, params object[] arguments)
    {
        var method = typeof(MainWindow).GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic)
                     ?? throw new MissingMethodException(typeof(MainWindow).FullName, methodName);
        var result = method.Invoke(_window, arguments);
        if (result is Task task)
            await task;
    }

    private IntPtr WindowProc(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (message == WmGetMinMaxInfo)
        {
            ApplyMaximizedWorkArea(hwnd, lParam);
            handled = true;
        }
        else if (message is WmDpiChanged or WmDisplayChange)
        {
            _window.Dispatcher.BeginInvoke(DispatcherPriority.Background, ApplyMonitorWorkArea);
        }
        return IntPtr.Zero;
    }

    private static void ApplyMaximizedWorkArea(IntPtr hwnd, IntPtr lParam)
    {
        if (lParam == IntPtr.Zero)
            return;
        var monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
        if (monitor == IntPtr.Zero)
            return;

        var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfo(monitor, ref info))
            return;

        var minMax = Marshal.PtrToStructure<MinMaxInfo>(lParam);
        minMax.MaxPosition.X = Math.Abs(info.Work.Left - info.Monitor.Left);
        minMax.MaxPosition.Y = Math.Abs(info.Work.Top - info.Monitor.Top);
        minMax.MaxSize.X = Math.Abs(info.Work.Right - info.Work.Left);
        minMax.MaxSize.Y = Math.Abs(info.Work.Bottom - info.Work.Top);
        minMax.MaxTrackSize = minMax.MaxSize;
        Marshal.StructureToPtr(minMax, lParam, true);
    }

    private void ApplyMonitorWorkArea()
    {
        if (_disposed || _window.WindowState != WindowState.Normal || _source?.Handle is not { } hwnd || hwnd == IntPtr.Zero)
            return;
        var monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
        if (monitor == IntPtr.Zero)
            return;

        var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfo(monitor, ref info) || _source.CompositionTarget is null)
            return;

        var fromDevice = _source.CompositionTarget.TransformFromDevice;
        var topLeft = fromDevice.Transform(new System.Windows.Point(info.Work.Left, info.Work.Top));
        var bottomRight = fromDevice.Transform(new System.Windows.Point(info.Work.Right, info.Work.Bottom));
        var work = new System.Windows.Rect(topLeft, bottomRight);
        if (work.Width <= 0 || work.Height <= 0)
            return;

        var width = Math.Min(Math.Max(_window.Width, _window.MinWidth), work.Width);
        var height = Math.Min(Math.Max(_window.Height, _window.MinHeight), work.Height);
        var left = Math.Clamp(_window.Left, work.Left, Math.Max(work.Left, work.Right - width));
        var top = Math.Clamp(_window.Top, work.Top, Math.Max(work.Top, work.Bottom - height));

        if (Math.Abs(_window.Width - width) > 0.5) _window.Width = width;
        if (Math.Abs(_window.Height - height) > 0.5) _window.Height = height;
        if (Math.Abs(_window.Left - left) > 0.5) _window.Left = left;
        if (Math.Abs(_window.Top - top) > 0.5) _window.Top = top;
        _window.InvalidateVisual();
    }

    private void Window_Closed(object? sender, EventArgs e) => Dispose();

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _dashboardWatchdog.Stop();
        _dashboardWatchdog.Tick -= DashboardWatchdog_Tick;
        foreach (var navigation in _navigation)
            navigation.Checked -= Navigation_Checked;
        _source?.RemoveHook(WindowProc);
        _dashboardGate.Dispose();
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MinMaxInfo
    {
        public NativePoint Reserved;
        public NativePoint MaxSize;
        public NativePoint MaxPosition;
        public NativePoint MinTrackSize;
        public NativePoint MaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MonitorInfo
    {
        public int Size;
        public NativeRect Monitor;
        public NativeRect Work;
        public uint Flags;
    }
}
