using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace PersonalWorkbench;

/// <summary>
/// Restores the original lightweight Dashboard ownership model: MainWindow owns one
/// WPF WebView2 and its shared login environment. The coordinator only retires the
/// later automatic recovery hooks that could race controller creation; it does not
/// replace buttons, inject page scripts, start helper processes, embed HWNDs or
/// participate in keyboard focus.
/// </summary>
public sealed class DashboardSimplicityCoordinator : IDisposable
{
    private static readonly BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;

    private readonly MainWindow _window;
    private readonly ShellResilienceCoordinator _shell;
    private bool _disposed;

    private DashboardSimplicityCoordinator(MainWindow window, ShellResilienceCoordinator shell)
    {
        _window = window;
        _shell = shell;

        RetireShellDashboardRecoveryHooks();
        DisableAutomaticWebViewRecreation();
        _window.Closed += Window_Closed;

        App.Log(
            "Dashboard simplicity coordinator attached; MainWindow owns the in-process WPF WebView2, "
            + "shared login profile and native keyboard/input lifecycle");
    }

    public static DashboardSimplicityCoordinator Attach(
        MainWindow window,
        ShellResilienceCoordinator shell)
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

            App.Log("Retired Dashboard activation, navigation and periodic auto-recovery hooks");
        }
        catch (Exception ex)
        {
            App.Log("Retiring Dashboard recovery hooks failed: " + ex);
        }
    }

    private void DisableAutomaticWebViewRecreation()
    {
        try
        {
            var field = typeof(MainWindow).GetField(
                "_dashboardRecoveryInProgress",
                PrivateInstance);
            if (field is null)
                throw new MissingFieldException(typeof(MainWindow).FullName, "_dashboardRecoveryInProgress");

            // MainWindow's historical ProcessFailed callback calls RecoverDashboardAsync.
            // Keeping this gate closed makes that callback log-only. The user can still
            // use the existing Reload button or reopen AtlasDesk; no background code
            // destroys a WebView2 controller or competes with initialization.
            field.SetValue(_window, true);
            App.Log("Disabled automatic Dashboard WebView2 destruction and recreation");
        }
        catch (Exception ex)
        {
            App.Log("Disabling automatic Dashboard recreation failed: " + ex);
        }
    }

    private void Window_Closed(object? sender, EventArgs e) => Dispose();

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _window.Closed -= Window_Closed;
    }
}
