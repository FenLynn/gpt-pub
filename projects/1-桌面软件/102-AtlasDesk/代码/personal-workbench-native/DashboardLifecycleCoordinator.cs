using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace PersonalWorkbench;

/// <summary>
/// Owns Dashboard commands, WebView2 process classification, browser-process
/// diagnostics and rapid-click protection. MainWindow still creates the control,
/// but destructive recovery can only run through this coordinator.
/// </summary>
public sealed class DashboardLifecycleCoordinator : IDisposable
{
    private static readonly BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;

    private const string DashboardClickGuardScript = """
        (() => {
          if (window.__atlasDeskClickGuardInstalled) return;
          window.__atlasDeskClickGuardInstalled = true;
          let lastKey = '';
          let lastAt = 0;
          const clean = value => String(value || '')
            .replace(/[\r\n|]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 96);
          document.addEventListener('click', event => {
            const origin = event.target instanceof Element ? event.target : event.target?.parentElement;
            const target = origin?.closest?.('button,[role="button"],a,input[type="button"],input[type="submit"]');
            if (!target) return;
            const key = clean(
              target.getAttribute('aria-label')
              || target.getAttribute('title')
              || target.id
              || target.textContent
              || target.getAttribute('href')
              || target.tagName);
            const now = performance.now();
            const duplicate = key.length > 0 && key === lastKey && now - lastAt < 900;
            try {
              window.chrome?.webview?.postMessage(
                `atlasdesk-click|${duplicate ? 'blocked' : 'accepted'}|${key || target.tagName}`);
            } catch {}
            if (duplicate) {
              event.preventDefault();
              event.stopImmediatePropagation();
              return;
            }
            lastKey = key;
            lastAt = now;
          }, true);
        })();
        """;

    private readonly MainWindow _window;
    private readonly ShellResilienceCoordinator _shell;
    private readonly SemaphoreSlim _commandGate = new(1, 1);
    private readonly List<(Button Button, RoutedEventHandler Handler)> _safeHandlers = new();
    private readonly DispatcherTimer _runtimeHookMonitor;

    private WebView2? _observedView;
    private CoreWebView2? _observedCore;
    private CoreWebView2Environment? _observedEnvironment;
    private string? _clickGuardScriptId;
    private DateTimeOffset _lastRendererReloadUtc = DateTimeOffset.MinValue;
    private long _processFailureSequence;
    private bool _hookingRuntime;
    private bool _disposed;

    private DashboardLifecycleCoordinator(MainWindow window, ShellResilienceCoordinator shell)
    {
        _window = window;
        _shell = shell;

        RetireShellDashboardRecoveryHooks();
        InstallSafeDashboardCommands();

        _runtimeHookMonitor = new DispatcherTimer(DispatcherPriority.Background, _window.Dispatcher)
        {
            Interval = TimeSpan.FromMilliseconds(250)
        };
        _runtimeHookMonitor.Tick += RuntimeHookMonitor_Tick;
        _runtimeHookMonitor.Start();

        _window.Closed += Window_Closed;
        App.Log("Dashboard lifecycle coordinator v1.1.5 attached; process ownership and rapid-click guard enabled");
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
            ReplaceBrowserButton(browserControls, "后退", Back_Click);
            ReplaceBrowserButton(browserControls, "前进", Forward_Click);
            ReplaceBrowserButton(browserControls, "刷新", Refresh_Click);
            ReplaceBrowserButton(browserControls, "Dashboard 首页", DashboardHome_Click);
        }

        if (_window.FindName("DashboardError") is DependencyObject errorRoot)
        {
            var retry = EnumerateVisualDescendants<Button>(errorRoot)
                .FirstOrDefault(button => string.Equals(button.Content?.ToString(), "重试", StringComparison.Ordinal));
            if (retry is not null)
                ReplaceButtonElement(retry, Retry_Click, "Dashboard 重试");
        }
    }

    private void ReplaceBrowserButton(Panel host, string tooltip, RoutedEventHandler safeHandler)
    {
        var button = host.Children.OfType<Button>()
            .FirstOrDefault(candidate => string.Equals(candidate.ToolTip?.ToString(), tooltip, StringComparison.Ordinal));
        if (button is not null)
            ReplaceButtonElement(button, safeHandler, tooltip);
    }

    private void ReplaceButtonElement(Button legacy, RoutedEventHandler safeHandler, string automationName)
    {
        if (VisualTreeHelper.GetParent(legacy) is not Panel parent)
            throw new InvalidOperationException("Dashboard command button is not hosted by a Panel.");

        var index = parent.Children.IndexOf(legacy);
        if (index < 0)
            throw new InvalidOperationException("Dashboard command button is not present in its visual parent.");

        var content = legacy.Content;
        legacy.Content = null;

        var replacement = new Button
        {
            Content = content,
            Style = legacy.Style,
            ToolTip = legacy.ToolTip,
            Visibility = legacy.Visibility,
            IsEnabled = legacy.IsEnabled,
            Focusable = legacy.Focusable,
            IsTabStop = legacy.IsTabStop,
            Margin = legacy.Margin,
            Width = legacy.Width,
            Height = legacy.Height,
            MinWidth = legacy.MinWidth,
            MinHeight = legacy.MinHeight,
            MaxWidth = legacy.MaxWidth,
            MaxHeight = legacy.MaxHeight,
            HorizontalAlignment = legacy.HorizontalAlignment,
            VerticalAlignment = legacy.VerticalAlignment,
            HorizontalContentAlignment = legacy.HorizontalContentAlignment,
            VerticalContentAlignment = legacy.VerticalContentAlignment,
            Cursor = legacy.Cursor
        };

        AutomationProperties.SetName(replacement, automationName);
        replacement.Click += safeHandler;
        parent.Children.RemoveAt(index);
        parent.Children.Insert(index, replacement);
        _safeHandlers.Add((replacement, safeHandler));
    }

    private async void RuntimeHookMonitor_Tick(object? sender, EventArgs e)
    {
        if (_disposed || _hookingRuntime)
            return;

        _hookingRuntime = true;
        try
        {
            await EnsureRuntimeHooksAsync();
        }
        catch (Exception ex)
        {
            App.Log("Dashboard runtime hook monitor failed: " + ex);
        }
        finally
        {
            _hookingRuntime = false;
        }
    }

    private async Task EnsureRuntimeHooksAsync()
    {
        var view = ReadMainWindowField<WebView2>("_dashboardWebView");
        var core = view?.CoreWebView2;
        if (view is null || core is null)
            return;
        if (ReferenceEquals(view, _observedView) && ReferenceEquals(core, _observedCore))
            return;

        DetachRuntimeHooks();

        _observedView = view;
        _observedCore = core;
        _observedEnvironment = ReadMainWindowField<CoreWebView2Environment>("_webViewEnvironment");

        core.ProcessFailed += Core_ProcessFailed;
        core.WebMessageReceived += Core_WebMessageReceived;

        if (_observedEnvironment is not null)
        {
            _observedEnvironment.BrowserProcessExited += Environment_BrowserProcessExited;
            App.Log("WebView2 failure report folder: " + _observedEnvironment.FailureReportFolderPath);
        }

        _clickGuardScriptId = await core.AddScriptToExecuteOnDocumentCreatedAsync(DashboardClickGuardScript);
        await core.ExecuteScriptAsync(DashboardClickGuardScript);
        App.Log("Dashboard WebView2 process diagnostics and web rapid-click guard attached");
    }

    private void DetachRuntimeHooks()
    {
        if (_observedCore is not null)
        {
            try
            {
                _observedCore.ProcessFailed -= Core_ProcessFailed;
                _observedCore.WebMessageReceived -= Core_WebMessageReceived;
                if (!string.IsNullOrWhiteSpace(_clickGuardScriptId))
                    _observedCore.RemoveScriptToExecuteOnDocumentCreated(_clickGuardScriptId);
            }
            catch (Exception ex)
            {
                App.Log("Detach Dashboard CoreWebView2 hooks failed: " + ex.Message);
            }
        }

        if (_observedEnvironment is not null)
        {
            try
            {
                _observedEnvironment.BrowserProcessExited -= Environment_BrowserProcessExited;
            }
            catch (Exception ex)
            {
                App.Log("Detach BrowserProcessExited hook failed: " + ex.Message);
            }
        }

        _observedView = null;
        _observedCore = null;
        _observedEnvironment = null;
        _clickGuardScriptId = null;
    }

    private void Core_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            var message = e.TryGetWebMessageAsString();
            if (message.StartsWith("atlasdesk-click|", StringComparison.Ordinal))
                App.Log("Dashboard web interaction: " + message);
        }
        catch (Exception ex)
        {
            App.Log("Dashboard web interaction message failed: " + ex.Message);
        }
    }

    private void Core_ProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        if (_disposed)
            return;

        var sequence = Interlocked.Increment(ref _processFailureSequence);
        var snapshot = new ProcessFailureSnapshot(
            sequence,
            e.ProcessFailedKind,
            e.Reason.ToString(),
            e.ExitCode,
            e.ProcessDescription ?? string.Empty);

        // MainWindow subscribed first and queues destructive recovery. Set the
        // retained flag synchronously before its Dispatcher callback can run.
        WriteMainWindowField("_dashboardRecoveryInProgress", true);
        App.Log(
            $"WebView2 process failure classified: sequence={snapshot.Sequence}; " +
            $"kind={snapshot.Kind}; reason={snapshot.Reason}; " +
            $"exitCode={snapshot.ExitCode}; description={snapshot.Description}");

        _window.Dispatcher.BeginInvoke(
            new Action(() => _ = HandleProcessFailureAsync(snapshot)),
            DispatcherPriority.Background);
    }

    private void Environment_BrowserProcessExited(
        object? sender,
        CoreWebView2BrowserProcessExitedEventArgs e)
    {
        App.Log(
            $"WebView2 browser process exited: kind={e.BrowserProcessExitKind}; " +
            $"processId={e.BrowserProcessId}");
    }

    private async Task HandleProcessFailureAsync(ProcessFailureSnapshot failure)
    {
        try
        {
            // Let the legacy queued callback observe the suppression flag and return.
            await _window.Dispatcher.InvokeAsync(() => { }, DispatcherPriority.ApplicationIdle);
            if (failure.Sequence != Interlocked.Read(ref _processFailureSequence))
            {
                App.Log("Superseded WebView2 process failure skipped: sequence=" + failure.Sequence);
                return;
            }

            switch (failure.Kind)
            {
                case CoreWebView2ProcessFailedKind.GpuProcessExited:
                case CoreWebView2ProcessFailedKind.UtilityProcessExited:
                case CoreWebView2ProcessFailedKind.FrameRenderProcessExited:
                    App.Log("WebView2 failure is non-fatal or auto-recoverable; destructive rebuild skipped");
                    break;

                case CoreWebView2ProcessFailedKind.RenderProcessUnresponsive:
                    await RecoverRendererWithBoundedReloadAsync("renderer unresponsive");
                    break;

                case CoreWebView2ProcessFailedKind.RenderProcessExited:
                    await RecoverRendererWithBoundedReloadAsync("renderer exited");
                    break;

                case CoreWebView2ProcessFailedKind.BrowserProcessExited:
                    await RecreateDashboardAsync("browser process exited", failure.Sequence);
                    break;

                default:
                    App.Log("WebView2 failure kind is not destructive by default; rebuild skipped: " + failure.Kind);
                    break;
            }
        }
        catch (Exception ex)
        {
            App.Log("Classified WebView2 recovery failed: " + ex);
            ShowNonFatalError("Dashboard 进程恢复失败，但 AtlasDesk 主窗口仍保持运行。\n\n" + ex.Message);
        }
        finally
        {
            if (failure.Sequence == Interlocked.Read(ref _processFailureSequence))
                WriteMainWindowField("_dashboardRecoveryInProgress", false);
        }
    }

    private async Task RecoverRendererWithBoundedReloadAsync(string reason)
    {
        var now = DateTimeOffset.UtcNow;
        if (now - _lastRendererReloadUtc < TimeSpan.FromSeconds(10))
        {
            App.Log("Renderer recovery reload suppressed by 10-second cooldown: " + reason);
            return;
        }
        _lastRendererReloadUtc = now;

        if (!await _commandGate.WaitAsync(TimeSpan.FromSeconds(3)))
        {
            App.Log("Renderer recovery skipped because another Dashboard command is active: " + reason);
            return;
        }

        try
        {
            SetCommandButtonsEnabled(false);
            SetProgressVisible(true);

            var core = _observedCore;
            if (core is null)
            {
                await RecreateDashboardCoreAsync(reason + "; controller missing", null);
                return;
            }

            App.Log("Reloading Dashboard renderer without destroying WebView2: " + reason);
            core.Reload();
        }
        catch (Exception ex) when (ex is COMException or InvalidOperationException or ObjectDisposedException)
        {
            App.Log("Renderer reload failed; escalating to controlled recreation: " + ex);
            await RecreateDashboardCoreAsync(reason + "; reload failed", null);
        }
        finally
        {
            SetProgressVisible(false);
            SetCommandButtonsEnabled(true);
            _commandGate.Release();
        }
    }

    private async Task RecreateDashboardAsync(string reason, long? failureSequence)
    {
        if (!await _commandGate.WaitAsync(TimeSpan.FromSeconds(5)))
        {
            App.Log("Dashboard recreation skipped because another command did not finish: " + reason);
            return;
        }

        try
        {
            SetCommandButtonsEnabled(false);
            SetProgressVisible(true);
            await RecreateDashboardCoreAsync(reason, failureSequence);
        }
        finally
        {
            SetProgressVisible(false);
            SetCommandButtonsEnabled(true);
            _commandGate.Release();
        }
    }

    private async Task RecreateDashboardCoreAsync(string reason, long? failureSequence)
    {
        App.Log("Starting controlled Dashboard recreation: " + reason);
        DetachRuntimeHooks();

        if (failureSequence is not null
            && failureSequence.Value != Interlocked.Read(ref _processFailureSequence))
        {
            App.Log("Controlled Dashboard recreation cancelled because a newer failure arrived");
            return;
        }

        // The legacy ProcessFailed callback has already drained. Clear the
        // suppression only for the explicit MainWindow-owned recreation.
        WriteMainWindowField("_dashboardRecoveryInProgress", false);
        await InvokeMainWindowTaskAsync("RecoverDashboardAsync", "v1.1.5 controlled recovery: " + reason);
        await EnsureRuntimeHooksAsync();
        App.Log("Controlled Dashboard recreation completed: " + reason);
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
                throw new InvalidOperationException("Dashboard 控制器或首页地址尚未就绪.");
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

        var started = DateTimeOffset.UtcNow;
        App.Log("Dashboard command started: " + operation);

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
            App.Log(
                $"Dashboard command completed: {operation}; " +
                $"elapsedMs={(DateTimeOffset.UtcNow - started).TotalMilliseconds:0}");
        }
        catch (Exception ex) when (ex is COMException or InvalidOperationException or ObjectDisposedException)
        {
            App.Log($"Guarded Dashboard command {operation} failed: {ex}");
            await RecreateDashboardCoreAsync("guarded " + operation + ": " + ex.Message, null);
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
        await RecreateDashboardCoreAsync(reason, null);
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

    private void WriteMainWindowField<T>(string fieldName, T value)
    {
        try
        {
            typeof(MainWindow).GetField(fieldName, PrivateInstance)?.SetValue(_window, value);
        }
        catch (Exception ex)
        {
            App.Log($"Write Dashboard field {fieldName} failed: {ex.Message}");
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
        _runtimeHookMonitor.Stop();
        _runtimeHookMonitor.Tick -= RuntimeHookMonitor_Tick;
        _window.Closed -= Window_Closed;
        DetachRuntimeHooks();

        foreach (var (button, handler) in _safeHandlers)
            button.Click -= handler;
        _safeHandlers.Clear();

        // Do not dispose the semaphore while an async continuation may still
        // release it during shutdown; it owns no native resource.
    }

    private readonly record struct ProcessFailureSnapshot(
        long Sequence,
        CoreWebView2ProcessFailedKind Kind,
        string Reason,
        int ExitCode,
        string Description);
}
