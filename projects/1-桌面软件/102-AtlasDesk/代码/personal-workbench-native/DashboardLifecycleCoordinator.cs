using Microsoft.Web.WebView2.Wpf;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace PersonalWorkbench;

/// <summary>
/// Owns guarded Dashboard commands and retires the older shell-level automatic
/// recovery hooks that could dispose WebView2 while its controller was still
/// being created. MainWindow remains the controller owner; this coordinator
/// only serializes user commands and prevents lifecycle re-entry.
/// </summary>
public sealed class DashboardLifecycleCoordinator : IDisposable
{
    private static readonly BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;

    private readonly MainWindow _window;
    private readonly ShellResilienceCoordinator _shell;
    private readonly SemaphoreSlim _commandGate = new(1, 1);
    private readonly List<(Button Button, RoutedEventHandler Handler)> _safeHandlers = new();
    private bool _disposed;

    private DashboardLifecycleCoordinator(MainWindow window, ShellResilienceCoordinator shell)
    {
        _window = window;
        _shell = shell;

        RetireShellDashboardRecoveryHooks();
        InstallSafeDashboardCommands();
        _window.Closed += Window_Closed;

        App.Log("Dashboard lifecycle coordinator attached; shell auto-recovery hooks retired");
    }

    public static DashboardLifecycleCoordinator Attach(MainWindow window, ShellResilienceCoordinator shell)
        => new(window, shell);

    private void RetireShellDashboardRecoveryHooks()
    {
        try
        {
            var shellType = typeof(ShellResilienceCoordinator);

            if (shellType.GetMethod("Window_Activated", PrivateInstance) is { } activatedMethod
                && activatedMethod.CreateDelegate(typeof(EventHandler), _shell) is EventHandler activatedHandler)
            {
                _window.Activated -= activatedHandler;
            }

            if (shellType.GetField("_dashboardWatchdog", PrivateInstance)?.GetValue(_shell) is DispatcherTimer watchdog)
            {
                watchdog.Stop();
                if (shellType.GetMethod("DashboardWatchdog_Tick", PrivateInstance) is { } tickMethod
                    && tickMethod.CreateDelegate(typeof(EventHandler), _shell) is EventHandler tickHandler)
                {
                    watchdog.Tick -= tickHandler;
                }
            }

            if (_window.FindName("DashboardNav") is RadioButton dashboardNavigation
                && shellType.GetMethod("Navigation_Checked", PrivateInstance) is { } checkedMethod
                && checkedMethod.CreateDelegate(typeof(RoutedEventHandler), _shell) is RoutedEventHandler checkedHandler)
            {
                dashboardNavigation.Checked -= checkedHandler;
            }
        }
        catch (Exception ex)
        {
            App.Log("Retire shell Dashboard recovery hooks failed: " + ex);
        }
    }

    private void InstallSafeDashboardCommands()
    {
        if (_window.FindName("BrowserControls") is Panel browserControls)
        {
            ReplaceBrowserButton(browserControls, "后退", "Back_Click", Back_Click);
            ReplaceBrowserButton(browserControls, "前进", "Forward_Click", Forward_Click);
            ReplaceBrowserButton(browserControls, "刷新", "Refresh_Click", Refresh_Click);
            ReplaceBrowserButton(browserControls, "Dashboard 首页", "DashboardHome_Click", DashboardHome_Click);
        }

        if (_window.FindName("DashboardError") is DependencyObject errorRoot)
        {
            var retry = EnumerateVisualDescendants<Button>(errorRoot)
                .FirstOrDefault(button => string.Equals(button.Content?.ToString(), "重试", StringComparison.Ordinal));
            if (retry is not null)
                ReplaceClickHandler(retry, "RetryDashboard_Click", Retry_Click);
        }
    }

    private void ReplaceBrowserButton(Panel host, string tooltip, string legacyMethod, RoutedEventHandler safeHandler)
    {
        var button = host.Children.OfType<Button>()
            .FirstOrDefault(candidate => string.Equals(candidate.ToolTip?.ToString(), tooltip, StringComparison.Ordinal));
        if (button is not null)
            ReplaceClickHandler(button, legacyMethod, safeHandler);
    }

    private void ReplaceClickHandler(Button button, string legacyMethod, RoutedEventHandler safeHandler)
    {
        try
        {
            if (typeof(MainWindow).GetMethod(legacyMethod, PrivateInstance) is { } method
                && method.CreateDelegate(typeof(RoutedEventHandler), _window) is RoutedEventHandler legacyHandler)
            {
                button.Click -= legacyHandler;
            }

            button.Click += safeHandler;
            _safeHandlers.Add((button, safeHandler));
        }
        catch (Exception ex)
        {
            App.Log($"Replace Dashboard handler {legacyMethod} failed: {ex}");
        }
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        await ExecuteGuardedAsync(sender as Button, "refresh", async () =>
        {
            await InvokeMainWindowTaskAsync("EnsureDashboardAsync", true);
            await RecoverIfControllerMissingAsync("manual refresh");
        });
    }

    private async void Retry_Click(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        await ExecuteGuardedAsync(sender as Button, "retry", async () =>
        {
            await InvokeMainWindowTaskAsync("EnsureDashboardAsync", true);
            await RecoverIfControllerMissingAsync("manual retry");
        });
    }

    private async void DashboardHome_Click(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        await ExecuteGuardedAsync(sender as Button, "home", async () =>
        {
            await InvokeMainWindowTaskAsync("EnsureDashboardAsync", false);
            var view = ReadMainWindowField<WebView2>("_dashboardWebView");
            var settings = ReadMainWindowField<AppSettings>("_settings") ?? AppSettings.Load();
            if (view?.CoreWebView2 is null || !Uri.TryCreate(settings.DashboardUrl, UriKind.Absolute, out var uri))
                throw new InvalidOperationException("Dashboard 控制器或首页地址尚未就绪。");
            view.CoreWebView2.Navigate(uri.AbsoluteUri);
        });
    }

    private async void Back_Click(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        await ExecuteGuardedAsync(sender as Button, "back", () =>
        {
            var core = ReadMainWindowField<WebView2>("_dashboardWebView")?.CoreWebView2;
            if (core?.CanGoBack == true)
                core.GoBack();
            return Task.CompletedTask;
        });
    }

    private async void Forward_Click(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        await ExecuteGuardedAsync(sender as Button, "forward", () =>
        {
            var core = ReadMainWindowField<WebView2>("_dashboardWebView")?.CoreWebView2;
            if (core?.CanGoForward == true)
                core.GoForward();
            return Task.CompletedTask;
        });
    }

    private async Task ExecuteGuardedAsync(Button? trigger, string operation, Func<Task> action)
    {
        if (_disposed)
            return;
        if (!await _commandGate.WaitAsync(0))
        {
            App.Log("Dashboard command ignored while another command is active: " + operation);
            return;
        }

        try
        {
            SetCommandButtonsEnabled(false);
            SetProgressVisible(true);

            if (!await WaitForDashboardIdleAsync(TimeSpan.FromSeconds(12)))
            {
                ShowNonFatalError("Dashboard 正在初始化或恢复，本次操作已取消以避免闪退。请稍后再试。");
                return;
            }

            await action();
        }
        catch (Exception ex) when (ex is COMException or InvalidOperationException or ObjectDisposedException)
        {
            App.Log($"Guarded Dashboard command {operation} failed: {ex}");
            await RecoverAfterCommandFailureAsync(operation, ex);
        }
        catch (Exception ex)
        {
            App.Log($"Dashboard command {operation} failed: {ex}");
            ShowNonFatalError("Dashboard 操作失败，但 AtlasDesk 主窗口已保持运行。\n\n" + ex.Message);
        }
        finally
        {
            SetProgressVisible(false);
            SetCommandButtonsEnabled(true);
            if (trigger is not null)
                trigger.IsEnabled = true;
            _commandGate.Release();
        }
    }

    private async Task<bool> WaitForDashboardIdleAsync(TimeSpan timeout)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        while (!_disposed && DateTimeOffset.UtcNow < deadline)
        {
            var initializing = ReadMainWindowField<bool>("_isInitializingDashboard");
            var recovering = ReadMainWindowField<bool>("_dashboardRecoveryInProgress");
            if (!initializing && !recovering)
                return true;
            await Task.Delay(100);
        }
        return false;
    }

    private async Task RecoverIfControllerMissingAsync(string reason)
    {
        var view = ReadMainWindowField<WebView2>("_dashboardWebView");
        if (view?.CoreWebView2 is not null)
            return;
        await InvokeMainWindowTaskAsync("RecoverDashboardAsync", reason);
    }

    private async Task RecoverAfterCommandFailureAsync(string operation, Exception failure)
    {
        try
        {
            if (!await WaitForDashboardIdleAsync(TimeSpan.FromSeconds(3)))
            {
                ShowNonFatalError("Dashboard 操作已停止，当前恢复流程仍在进行。\n\n" + failure.Message);
                return;
            }
            await InvokeMainWindowTaskAsync("RecoverDashboardAsync", "guarded " + operation + ": " + failure.Message);
        }
        catch (Exception recoveryError)
        {
            App.Log("Guarded Dashboard recovery failed: " + recoveryError);
            ShowNonFatalError("Dashboard 恢复失败，但 AtlasDesk 主窗口已保持运行。\n\n" + recoveryError.Message);
        }
    }

    private async Task InvokeMainWindowTaskAsync(string methodName, params object[] arguments)
    {
        var method = typeof(MainWindow).GetMethod(methodName, PrivateInstance)
                     ?? throw new MissingMethodException(typeof(MainWindow).FullName, methodName);
        var result = method.Invoke(_window, arguments);
        if (result is Task task)
            await task;
    }

    private T? ReadMainWindowField<T>(string fieldName)
    {
        try
        {
            var value = typeof(MainWindow).GetField(fieldName, PrivateInstance)?.GetValue(_window);
            return value is T typed ? typed : default;
        }
        catch (Exception ex)
        {
            App.Log($"Read Dashboard field {fieldName} failed: {ex.Message}");
            return default;
        }
    }

    private void SetCommandButtonsEnabled(bool enabled)
    {
        foreach (var (button, _) in _safeHandlers)
            button.IsEnabled = enabled;
    }

    private void SetProgressVisible(bool visible)
    {
        if (_window.FindName("NavigationProgress") is FrameworkElement progress)
            progress.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
    }

    private void ShowNonFatalError(string message)
    {
        if (_window.FindName("DashboardHost") is FrameworkElement host)
            host.Visibility = Visibility.Visible;
        if (_window.FindName("DashboardError") is FrameworkElement error)
            error.Visibility = Visibility.Visible;
        if (_window.FindName("DashboardErrorText") is TextBlock text)
            text.Text = message;
    }

    private static IEnumerable<T> EnumerateVisualDescendants<T>(DependencyObject root) where T : DependencyObject
    {
        var count = VisualTreeHelper.GetChildrenCount(root);
        for (var index = 0; index < count; index++)
        {
            var child = VisualTreeHelper.GetChild(root, index);
            if (child is T typed)
                yield return typed;
            foreach (var descendant in EnumerateVisualDescendants<T>(child))
                yield return descendant;
        }
    }

    private void Window_Closed(object? sender, EventArgs e) => Dispose();

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _window.Closed -= Window_Closed;
        foreach (var (button, handler) in _safeHandlers)
            button.Click -= handler;
        _safeHandlers.Clear();
        // Do not dispose the semaphore while an async click continuation may still
        // release it during shutdown; it contains no native resource.
    }
}
