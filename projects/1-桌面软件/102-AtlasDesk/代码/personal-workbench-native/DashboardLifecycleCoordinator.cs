using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.Diagnostics;
using System.Reflection;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace PersonalWorkbench;

/// <summary>
/// Keeps all Dashboard WebView2 and page code in AtlasDesk.DashboardHost.exe.
/// The primary process owns only a native child-window surface, command pipe and
/// restart UI, so a native browser/control crash cannot terminate AtlasDesk.
/// </summary>
public sealed class DashboardLifecycleCoordinator : IDisposable
{
    private static readonly BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;
    private static readonly TimeSpan HostReadyTimeout = TimeSpan.FromSeconds(25);
    private const string IsolatedProfileFolderName = "WebView2-Isolated";

    private readonly MainWindow _window;
    private readonly ShellResilienceCoordinator _shell;
    private readonly DashboardProcessSurface _surface;
    private readonly Border _statusOverlay;
    private readonly TextBlock _statusText;
    private readonly Button _restartButton;
    private readonly List<(Button Button, RoutedEventHandler Handler)> _commandHandlers = new();

    private Process? _process;
    private TaskCompletionSource<IntPtr>? _windowHandleSource;
    private string _runningUrl = string.Empty;
    private DateTimeOffset _lastStartUtc = DateTimeOffset.MinValue;
    private int _rapidExitCount;
    private bool _stopping;
    private bool _disposed;

    private DashboardLifecycleCoordinator(MainWindow window, ShellResilienceCoordinator shell)
    {
        _window = window;
        _shell = shell;

        RetireShellDashboardRecoveryHooks();
        SuppressInProcessDashboard();
        (_surface, _statusOverlay, _statusText, _restartButton) = InstallProcessSurface();
        InstallDashboardCommands();

        if (_window.FindName("DashboardView") is FrameworkElement dashboardView)
            dashboardView.IsVisibleChanged += DashboardView_IsVisibleChanged;
        _window.LayoutUpdated += Window_LayoutUpdated;
        _window.Closed += Window_Closed;

        App.Log("Dashboard lifecycle coordinator v1.1.6 attached; WebView2 moved to dedicated AtlasDesk.DashboardHost.exe process");
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

    private void SuppressInProcessDashboard()
    {
        WriteMainWindowField("_isInitializingDashboard", true);
        WriteMainWindowField("_dashboardRecoveryInProgress", false);
        WriteMainWindowField("_dashboardHasNavigated", false);

        try
        {
            if (ReadMainWindowField<WebView2>("_dashboardWebView") is { } retainedView)
            {
                if (_window.FindName("DashboardHost") is Panel host)
                    host.Children.Remove(retainedView);
                retainedView.Dispose();
            }
        }
        catch (Exception ex)
        {
            App.Log("Retained in-process Dashboard cleanup failed: " + ex);
        }

        WriteMainWindowField<WebView2?>("_dashboardWebView", null);
        WriteMainWindowField<CoreWebView2Environment?>("_webViewEnvironment", null);
    }

    private (DashboardProcessSurface Surface, Border Overlay, TextBlock Text, Button RestartButton) InstallProcessSurface()
    {
        if (_window.FindName("DashboardHost") is not Grid host)
            throw new InvalidOperationException("DashboardHost grid is unavailable.");

        host.Children.Clear();
        var surface = new DashboardProcessSurface
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch
        };
        host.Children.Add(surface);

        var statusText = new TextBlock
        {
            Text = "进入 Dashboard 后将启动独立浏览器进程。",
            FontSize = 13,
            Foreground = new SolidColorBrush(Color.FromRgb(88, 104, 126)),
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            MaxWidth = 560,
            HorizontalAlignment = HorizontalAlignment.Center
        };
        var restart = new Button
        {
            Content = "重新启动 Dashboard",
            Margin = new Thickness(0, 16, 0, 0),
            HorizontalAlignment = HorizontalAlignment.Center,
            Visibility = Visibility.Collapsed
        };
        if (_window.TryFindResource("PrimaryButton") is Style style)
            restart.Style = style;
        AutomationProperties.SetName(restart, "重新启动独立 Dashboard");
        restart.Click += RestartButton_Click;

        var panel = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(24)
        };
        panel.Children.Add(statusText);
        panel.Children.Add(restart);

        var overlay = new Border
        {
            Background = new SolidColorBrush(Color.FromArgb(246, 247, 249, 252)),
            Child = panel,
            Visibility = Visibility.Visible
        };
        Panel.SetZIndex(overlay, 10);
        host.Children.Add(overlay);
        return (surface, overlay, statusText, restart);
    }

    private void InstallDashboardCommands()
    {
        if (_window.FindName("BrowserControls") is Panel browserControls)
        {
            ReplaceBrowserButton(browserControls, "后退", Back_Click);
            ReplaceBrowserButton(browserControls, "前进", Forward_Click);
            ReplaceBrowserButton(browserControls, "刷新", Refresh_Click);
            ReplaceBrowserButton(browserControls, "Dashboard 首页", Home_Click);
        }

        if (_window.FindName("PopoutButton") is FrameworkElement popout)
            popout.Visibility = Visibility.Collapsed;
    }

    private void ReplaceBrowserButton(Panel host, string tooltip, RoutedEventHandler handler)
    {
        var legacy = host.Children.OfType<Button>()
            .FirstOrDefault(candidate => string.Equals(candidate.ToolTip?.ToString(), tooltip, StringComparison.Ordinal));
        if (legacy is null)
            return;

        var index = host.Children.IndexOf(legacy);
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
            HorizontalAlignment = legacy.HorizontalAlignment,
            VerticalAlignment = legacy.VerticalAlignment,
            HorizontalContentAlignment = legacy.HorizontalContentAlignment,
            VerticalContentAlignment = legacy.VerticalContentAlignment,
            Cursor = legacy.Cursor
        };
        AutomationProperties.SetName(replacement, tooltip);
        replacement.Click += handler;
        host.Children.RemoveAt(index);
        host.Children.Insert(index, replacement);
        _commandHandlers.Add((replacement, handler));
    }

    private async void DashboardView_IsVisibleChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        if (_disposed || e.NewValue is not true)
            return;
        await EnsureHostRunningAsync();
    }

    private void Window_LayoutUpdated(object? sender, EventArgs e)
    {
        if (_window.FindName("PopoutButton") is FrameworkElement popout
            && popout.Visibility != Visibility.Collapsed)
        {
            popout.Visibility = Visibility.Collapsed;
        }
    }

    private async void RestartButton_Click(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        await RestartHostAsync("manual restart");
    }

    private async void Back_Click(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        await SendCommandAsync("back");
    }

    private async void Forward_Click(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        await SendCommandAsync("forward");
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        await SendCommandAsync("reload");
    }

    private async void Home_Click(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        await SendCommandAsync("home");
    }

    private async Task SendCommandAsync(string command)
    {
        if (!await EnsureHostRunningAsync())
            return;

        var process = _process;
        if (process is null || HasExited(process))
            return;

        try
        {
            await process.StandardInput.WriteLineAsync(command);
            await process.StandardInput.FlushAsync();
            App.Log("Dedicated DashboardHost command sent: " + command);
        }
        catch (Exception ex)
        {
            App.Log("Dedicated DashboardHost command channel failed: " + ex);
            ShowStatus("Dashboard 独立进程通信失败。AtlasDesk 主窗口仍正常。", allowRestart: true);
        }
    }

    private async Task<bool> EnsureHostRunningAsync()
    {
        if (_disposed)
            return false;

        var settings = ReadMainWindowField<AppSettings>("_settings") ?? AppSettings.Load();
        if (!Uri.TryCreate(settings.DashboardUrl, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https"))
        {
            ShowStatus("尚未配置有效的 Dashboard 地址。", allowRestart: false);
            return false;
        }

        if (_process is { } running
            && !HasExited(running)
            && _surface.DashboardHandle != IntPtr.Zero
            && string.Equals(_runningUrl, uri.AbsoluteUri, StringComparison.OrdinalIgnoreCase))
        {
            HideStatus();
            return true;
        }

        return await StartHostAsync(uri.AbsoluteUri);
    }

    private async Task<bool> StartHostAsync(string dashboardUrl)
    {
        StopHost(graceful: false);
        ShowStatus("正在启动隔离的 Dashboard 进程…", allowRestart: false);
        SetProgressVisible(true);

        try
        {
            var hostDirectory = Path.Combine(App.RuntimeDirectory, "DashboardHost");
            var executable = Path.Combine(hostDirectory, "AtlasDesk.DashboardHost.exe");
            if (!File.Exists(executable))
            {
                throw new FileNotFoundException(
                    "AtlasDesk.DashboardHost.exe 不存在，无法启动独立 Dashboard。",
                    executable);
            }

            var profile = Path.Combine(App.LocalDataDirectory, IsolatedProfileFolderName);
            Directory.CreateDirectory(profile);

            var startInfo = new ProcessStartInfo(executable)
            {
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WorkingDirectory = hostDirectory
            };
            startInfo.ArgumentList.Add("--dashboard-url");
            startInfo.ArgumentList.Add(dashboardUrl);
            startInfo.ArgumentList.Add("--dashboard-profile");
            startInfo.ArgumentList.Add(profile);
            startInfo.ArgumentList.Add("--parent-process");
            startInfo.ArgumentList.Add(Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));

            var process = new Process
            {
                StartInfo = startInfo,
                EnableRaisingEvents = true
            };
            process.OutputDataReceived += Process_OutputDataReceived;
            process.ErrorDataReceived += Process_ErrorDataReceived;
            process.Exited += Process_Exited;

            _windowHandleSource = new TaskCompletionSource<IntPtr>(TaskCreationOptions.RunContinuationsAsynchronously);
            _runningUrl = dashboardUrl;
            _lastStartUtc = DateTimeOffset.UtcNow;
            _stopping = false;
            if (!process.Start())
                throw new InvalidOperationException("AtlasDesk.DashboardHost 进程未能启动。");

            _process = process;
            process.StandardInput.AutoFlush = true;
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            App.Log($"Dedicated DashboardHost started: pid={process.Id}; profile={profile}; url={dashboardUrl}");

            var dashboardHandle = await _windowHandleSource.Task.WaitAsync(HostReadyTimeout);
            var deadline = DateTimeOffset.UtcNow + TimeSpan.FromSeconds(5);
            while (_surface.HostHandle == IntPtr.Zero && DateTimeOffset.UtcNow < deadline)
                await Task.Delay(50);
            if (_surface.HostHandle == IntPtr.Zero)
                throw new InvalidOperationException("Dashboard native parent surface was not created.");

            _surface.AttachDashboardWindow(dashboardHandle);
            HideStatus();
            SetProgressVisible(false);
            App.Log($"Dedicated DashboardHost embedded: pid={process.Id}; hwnd={dashboardHandle}");
            return true;
        }
        catch (Exception ex)
        {
            App.Log("Starting dedicated DashboardHost failed: " + ex);
            StopHost(graceful: false);
            ShowStatus("独立 Dashboard 启动失败，但 AtlasDesk 主窗口仍正常。\n\n" + ex.Message, allowRestart: true);
            SetProgressVisible(false);
            return false;
        }
    }

    private async Task RestartHostAsync(string reason)
    {
        App.Log("Restarting dedicated DashboardHost: " + reason);
        StopHost(graceful: true);
        await Task.Delay(250);
        await EnsureHostRunningAsync();
    }

    private void Process_OutputDataReceived(object sender, DataReceivedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(e.Data))
            return;
        var line = e.Data;
        var parts = line.Split('|', 3);
        if (parts.Length != 3
            || !string.Equals(parts[0], DashboardHostProtocol.Prefix, StringComparison.Ordinal))
        {
            App.Log("DashboardHost output: " + line);
            return;
        }

        var kind = parts[1];
        var payload = parts[2];
        switch (kind)
        {
            case "HWND":
                if (long.TryParse(payload, out var rawHandle))
                    _windowHandleSource?.TrySetResult(new IntPtr(rawHandle));
                break;
            case "READY":
                App.Log("Dedicated DashboardHost reported ready");
                break;
            case "LOG":
                App.Log("DashboardHost: " + DashboardHostProtocol.Decode(payload));
                break;
            case "ERROR":
            case "COMMANDERROR":
            case "PROCESSFAILED":
                App.Log("DashboardHost " + kind + ": " + DashboardHostProtocol.Decode(payload));
                break;
            case "NAVSTART":
                _window.Dispatcher.BeginInvoke(new Action(() => SetProgressVisible(true)));
                break;
            case "NAVEND":
                _window.Dispatcher.BeginInvoke(new Action(() => SetProgressVisible(false)));
                break;
            case "TITLE":
                var title = DashboardHostProtocol.Decode(payload);
                _window.Dispatcher.BeginInvoke(new Action(() =>
                {
                    if (_window.FindName("PageTitle") is TextBlock pageTitle && !string.IsNullOrWhiteSpace(title))
                        pageTitle.Text = title.Length > 42 ? title[..42] + "…" : title;
                }));
                break;
            case "SOURCE":
                var source = DashboardHostProtocol.Decode(payload);
                _window.Dispatcher.BeginInvoke(new Action(() =>
                {
                    if (_window.FindName("PageSubtitle") is TextBlock subtitle
                        && Uri.TryCreate(source, UriKind.Absolute, out var sourceUri))
                    {
                        subtitle.Text = "  ·  " + sourceUri.Host;
                    }
                }));
                break;
        }
    }

    private void Process_ErrorDataReceived(object sender, DataReceivedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(e.Data))
            App.Log("DashboardHost stderr: " + e.Data);
    }

    private void Process_Exited(object? sender, EventArgs e)
    {
        if (sender is not Process exited)
            return;

        var exitCode = TryGetExitCode(exited);
        var runtime = DateTimeOffset.UtcNow - _lastStartUtc;
        _window.Dispatcher.BeginInvoke(new Action(async () =>
        {
            if (!ReferenceEquals(_process, exited))
                return;

            _surface.DetachDashboardWindow();
            _process = null;
            _windowHandleSource?.TrySetException(
                new InvalidOperationException("DashboardHost exited before supplying a window handle."));
            _windowHandleSource = null;
            SetProgressVisible(false);

            if (_disposed || _stopping)
                return;

            App.Log($"Dedicated DashboardHost exited unexpectedly: code={exitCode}; runtimeMs={runtime.TotalMilliseconds:0}");
            ShowStatus(
                "Dashboard 独立进程已退出，AtlasDesk 主窗口和其他页面未受影响。\n\n退出码：" + exitCode,
                allowRestart: true);

            if (runtime < TimeSpan.FromSeconds(25))
                _rapidExitCount++;
            else
                _rapidExitCount = 0;

            if (_rapidExitCount <= 1
                && _window.FindName("DashboardView") is FrameworkElement dashboardView
                && dashboardView.IsVisible)
            {
                App.Log("Attempting one automatic dedicated DashboardHost restart");
                await Task.Delay(900);
                await EnsureHostRunningAsync();
            }
        }));
    }

    private void StopHost(bool graceful)
    {
        var process = _process;
        _process = null;
        _windowHandleSource = null;
        _surface.DetachDashboardWindow();
        if (process is null)
            return;

        _stopping = true;
        try
        {
            if (!HasExited(process) && graceful)
            {
                try
                {
                    process.StandardInput.WriteLine("shutdown");
                    process.StandardInput.Flush();
                    _ = process.WaitForExit(1200);
                }
                catch { }
            }

            if (!HasExited(process))
                process.Kill(entireProcessTree: true);
        }
        catch (Exception ex)
        {
            App.Log("Stopping dedicated DashboardHost failed: " + ex.Message);
        }
        finally
        {
            process.OutputDataReceived -= Process_OutputDataReceived;
            process.ErrorDataReceived -= Process_ErrorDataReceived;
            process.Exited -= Process_Exited;
            process.Dispose();
            _stopping = false;
        }
    }

    private void ShowStatus(string message, bool allowRestart)
    {
        if (!_window.Dispatcher.CheckAccess())
        {
            _window.Dispatcher.BeginInvoke(new Action(() => ShowStatus(message, allowRestart)));
            return;
        }

        _statusText.Text = message;
        _restartButton.Visibility = allowRestart ? Visibility.Visible : Visibility.Collapsed;
        _statusOverlay.Visibility = Visibility.Visible;
    }

    private void HideStatus()
    {
        if (!_window.Dispatcher.CheckAccess())
        {
            _window.Dispatcher.BeginInvoke(new Action(HideStatus));
            return;
        }

        _statusOverlay.Visibility = Visibility.Collapsed;
        _restartButton.Visibility = Visibility.Collapsed;
    }

    private void SetProgressVisible(bool visible)
    {
        if (_window.FindName("NavigationProgress") is FrameworkElement progress)
            progress.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
    }

    private static bool HasExited(Process process)
    {
        try { return process.HasExited; }
        catch { return true; }
    }

    private static int TryGetExitCode(Process process)
    {
        try { return process.ExitCode; }
        catch { return int.MinValue; }
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
            App.Log($"Read MainWindow field {fieldName} failed: {ex.Message}");
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
            App.Log($"Write MainWindow field {fieldName} failed: {ex.Message}");
        }
    }

    private void WriteMainWindowField(string fieldName, bool value)
        => WriteMainWindowField<bool>(fieldName, value);

    private void Window_Closed(object? sender, EventArgs e) => Dispose();

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;

        if (_window.FindName("DashboardView") is FrameworkElement dashboardView)
            dashboardView.IsVisibleChanged -= DashboardView_IsVisibleChanged;
        _window.LayoutUpdated -= Window_LayoutUpdated;
        _window.Closed -= Window_Closed;
        _restartButton.Click -= RestartButton_Click;
        foreach (var (button, handler) in _commandHandlers)
            button.Click -= handler;
        _commandHandlers.Clear();
        StopHost(graceful: true);
    }
}
