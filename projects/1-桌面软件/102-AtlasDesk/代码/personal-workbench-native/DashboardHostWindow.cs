using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.Diagnostics;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;

namespace PersonalWorkbench;

/// <summary>
/// Runs only in the --dashboard-host AtlasDesk process. No instance of this
/// window or its WebView2 control exists in the primary AtlasDesk process.
/// </summary>
public sealed class DashboardHostWindow : Window
{
    public const string ProtocolPrefix = "ATLASDESK_DASHBOARD";

    private readonly DashboardHostLaunchOptions _options;
    private readonly WebView2 _webView;
    private readonly Border _errorSurface;
    private readonly TextBlock _errorText;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly SemaphoreSlim _commandGate = new(1, 1);

    private CoreWebView2Environment? _environment;
    private Window? _authenticationWindow;
    private WebView2? _authenticationView;
    private IntPtr _windowHandle;
    private DateTimeOffset _lastRendererReload = DateTimeOffset.MinValue;
    private bool _closing;

    public DashboardHostWindow(DashboardHostLaunchOptions options)
    {
        _options = options;
        Title = "AtlasDesk Dashboard Host";
        Width = 1200;
        Height = 800;
        MinWidth = 320;
        MinHeight = 240;
        Left = -32000;
        Top = -32000;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        Background = Brushes.White;

        var root = new Grid { Background = Brushes.White };
        _webView = new WebView2
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            ZoomFactor = 1.0
        };
        root.Children.Add(_webView);

        _errorText = new TextBlock
        {
            Margin = new Thickness(28),
            FontSize = 13,
            Foreground = new SolidColorBrush(Color.FromRgb(91, 104, 122)),
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            TextAlignment = TextAlignment.Center
        };
        _errorSurface = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(247, 249, 252)),
            Visibility = Visibility.Collapsed,
            Child = _errorText
        };
        root.Children.Add(_errorSurface);
        Content = root;

        SourceInitialized += Window_SourceInitialized;
        Loaded += Window_Loaded;
        Closed += Window_Closed;
    }

    private void Window_SourceInitialized(object? sender, EventArgs e)
    {
        // Keep the helper top-level and off-screen until its WebView2 controller is
        // fully initialized. Reparenting a WPF window before EnsureCoreWebView2Async
        // completes can deadlock native controller creation.
        _windowHandle = new WindowInteropHelper(this).Handle;
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        _ = ReadCommandsAsync();
        _ = WatchParentProcessAsync();
        await InitializeWebViewAsync();
    }

    private void Window_Closed(object? sender, EventArgs e)
    {
        _closing = true;
        _lifetime.Cancel();
        try { _authenticationWindow?.Close(); } catch { }
        try { _authenticationView?.Dispose(); } catch { }
        try { _webView.Dispose(); } catch { }
        Emit("CLOSED", Environment.ExitCode.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            Directory.CreateDirectory(_options.ProfileDirectory);
            var environmentOptions = new CoreWebView2EnvironmentOptions
            {
                // The user's failure happens during interactive rendering without any
                // managed exception. Keep hardware acceleration out of this isolated,
                // dashboard-only process while preserving the main AtlasDesk GPU path.
                AdditionalBrowserArguments = "--disable-gpu"
            };

            EmitLog("Creating isolated WebView2 environment at " + _options.ProfileDirectory);
            _environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: _options.ProfileDirectory,
                options: environmentOptions);
            await _webView.EnsureCoreWebView2Async(_environment);
            ConfigureCore(_webView.CoreWebView2, isMainDashboard: true);
            _webView.Source = new Uri(_options.DashboardUrl);

            if (_windowHandle == IntPtr.Zero)
                _windowHandle = new WindowInteropHelper(this).Handle;
            if (_windowHandle == IntPtr.Zero)
                throw new InvalidOperationException("DashboardHost window handle is unavailable after WebView2 initialization.");

            // HWND is deliberately handed to the parent only after WebView2 is ready.
            // The parent may now call SetParent without blocking controller creation.
            Emit("HWND", _windowHandle.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture));
            Emit("READY", string.Empty);
            EmitLog("Isolated Dashboard WebView2 initialized before HWND handoff; GPU disabled; DOM injection disabled");
        }
        catch (Exception ex)
        {
            ShowError("独立 Dashboard 进程初始化失败。\n\n" + ex.Message);
            Emit("ERROR", Encode(ex.ToString()));
        }
    }

    private void ConfigureCore(CoreWebView2 core, bool isMainDashboard)
    {
        core.Settings.AreDefaultScriptDialogsEnabled = true;
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = true;
        core.Settings.AreBrowserAcceleratorKeysEnabled = true;

        core.NavigationStarting += (_, args) =>
        {
            if (DashboardInteractionCoordinator.ShouldOpenExternally(args.Uri, _options.DashboardUrl))
            {
                args.Cancel = true;
                OpenExternalUri(args.Uri);
                EmitLog("External navigation redirected from isolated Dashboard: " + args.Uri);
                return;
            }

            Emit("NAVSTART", Encode(args.Uri ?? string.Empty));
        };

        core.NavigationCompleted += (_, args) =>
        {
            Emit("NAVEND", args.IsSuccess
                ? "success"
                : "failure:" + args.WebErrorStatus);
            if (args.IsSuccess)
            {
                _errorSurface.Visibility = Visibility.Collapsed;
            }
            else if (isMainDashboard)
            {
                ShowError("Dashboard 页面载入失败：" + args.WebErrorStatus);
            }
        };

        core.SourceChanged += (_, _) =>
            Emit("SOURCE", Encode(core.Source ?? string.Empty));
        core.DocumentTitleChanged += (_, _) =>
            Emit("TITLE", Encode(core.DocumentTitle ?? string.Empty));
        core.NewWindowRequested += async (_, args) =>
            await HandleNewWindowRequestedAsync(args);
        core.ProcessFailed += (_, args) =>
            HandleProcessFailed(args, isMainDashboard);
    }

    private void HandleProcessFailed(CoreWebView2ProcessFailedEventArgs args, bool isMainDashboard)
    {
        var detail = $"kind={args.ProcessFailedKind}; reason={args.Reason}; exitCode={args.ExitCode}; description={args.ProcessDescription}";
        Emit("PROCESSFAILED", Encode(detail));
        if (!isMainDashboard || _closing)
            return;

        switch (args.ProcessFailedKind)
        {
            case CoreWebView2ProcessFailedKind.GpuProcessExited:
            case CoreWebView2ProcessFailedKind.UtilityProcessExited:
            case CoreWebView2ProcessFailedKind.FrameRenderProcessExited:
            case CoreWebView2ProcessFailedKind.PpapiBrokerProcessExited:
            case CoreWebView2ProcessFailedKind.PpapiPluginProcessExited:
            case CoreWebView2ProcessFailedKind.SandboxHelperProcessExited:
            case CoreWebView2ProcessFailedKind.UnknownProcessExited:
                EmitLog("Isolated WebView2 reported an auto-recoverable process failure: " + detail);
                break;

            case CoreWebView2ProcessFailedKind.RenderProcessUnresponsive:
            case CoreWebView2ProcessFailedKind.RenderProcessExited:
                _ = Dispatcher.BeginInvoke(new Action(() => ReloadRendererWithCooldown(detail)));
                break;

            case CoreWebView2ProcessFailedKind.BrowserProcessExited:
                EmitLog("Isolated WebView2 browser process exited; terminating only DashboardHost");
                Environment.ExitCode = 73;
                _ = Dispatcher.BeginInvoke(new Action(Close));
                break;
        }
    }

    private void ReloadRendererWithCooldown(string reason)
    {
        if (_closing || _webView.CoreWebView2 is null)
            return;

        var now = DateTimeOffset.UtcNow;
        if (now - _lastRendererReload < TimeSpan.FromSeconds(12))
        {
            EmitLog("Renderer reload suppressed by cooldown: " + reason);
            return;
        }

        _lastRendererReload = now;
        try
        {
            EmitLog("Reloading isolated Dashboard renderer: " + reason);
            _webView.CoreWebView2.Reload();
        }
        catch (Exception ex)
        {
            EmitLog("Renderer reload failed; restarting only DashboardHost: " + ex);
            Environment.ExitCode = 74;
            Close();
        }
    }

    private async Task HandleNewWindowRequestedAsync(CoreWebView2NewWindowRequestedEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            var target = DashboardNavigationPolicy.Classify(args.Uri, _options.DashboardUrl);
            EmitLog($"Isolated Dashboard new window: {args.Uri} [{target}]");

            if (target == DashboardNavigationTarget.ExternalBrowser)
            {
                args.Handled = true;
                OpenExternalUri(args.Uri);
                return;
            }

            if (target == DashboardNavigationTarget.MainDashboard)
            {
                args.Handled = true;
                _webView.CoreWebView2?.Navigate(args.Uri);
                return;
            }

            if (_environment is null)
            {
                args.Handled = true;
                OpenExternalUri(args.Uri);
                return;
            }

            try { _authenticationWindow?.Close(); } catch { }
            try { _authenticationView?.Dispose(); } catch { }

            var popupView = new WebView2();
            var popup = new Window
            {
                Title = "AtlasDesk 登录验证",
                Width = 1080,
                Height = 760,
                MinWidth = 720,
                MinHeight = 520,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                Background = Brushes.White,
                Content = popupView,
                ShowInTaskbar = true
            };

            await popupView.EnsureCoreWebView2Async(_environment);
            ConfigureCore(popupView.CoreWebView2, isMainDashboard: false);
            args.NewWindow = popupView.CoreWebView2;
            args.Handled = true;
            _authenticationWindow = popup;
            _authenticationView = popupView;
            popup.Closed += (_, _) =>
            {
                try { popupView.Dispose(); } catch { }
                if (ReferenceEquals(_authenticationWindow, popup)) _authenticationWindow = null;
                if (ReferenceEquals(_authenticationView, popupView)) _authenticationView = null;
                try { _webView.CoreWebView2?.Reload(); } catch { }
            };
            popup.Show();
        }
        catch (Exception ex)
        {
            EmitLog("Isolated Dashboard new-window handling failed: " + ex);
            args.Handled = true;
            OpenExternalUri(args.Uri);
        }
        finally
        {
            deferral.Complete();
        }
    }

    private async Task ReadCommandsAsync()
    {
        try
        {
            while (!_lifetime.IsCancellationRequested)
            {
                var command = await Console.In.ReadLineAsync();
                if (command is null)
                    break;
                await Dispatcher.InvokeAsync(() => ExecuteCommand(command));
            }
        }
        catch (Exception ex) when (!_closing)
        {
            EmitLog("DashboardHost command channel ended: " + ex.Message);
        }
    }

    private void ExecuteCommand(string command)
    {
        if (_closing)
            return;

        try
        {
            switch (command.Trim().ToLowerInvariant())
            {
                case "reload":
                    ExecuteSerialized(() => _webView.CoreWebView2?.Reload());
                    break;
                case "home":
                    ExecuteSerialized(() => _webView.CoreWebView2?.Navigate(_options.DashboardUrl));
                    break;
                case "back":
                    ExecuteSerialized(() =>
                    {
                        if (_webView.CoreWebView2?.CanGoBack == true)
                            _webView.CoreWebView2.GoBack();
                    });
                    break;
                case "forward":
                    ExecuteSerialized(() =>
                    {
                        if (_webView.CoreWebView2?.CanGoForward == true)
                            _webView.CoreWebView2.GoForward();
                    });
                    break;
                case "shutdown":
                    Close();
                    break;
            }
        }
        catch (Exception ex)
        {
            Emit("COMMANDERROR", Encode(ex.ToString()));
        }
    }

    private void ExecuteSerialized(Action action)
    {
        if (!_commandGate.Wait(0))
        {
            EmitLog("DashboardHost command ignored while another command is active");
            return;
        }

        try { action(); }
        finally { _commandGate.Release(); }
    }

    private async Task WatchParentProcessAsync()
    {
        while (!_lifetime.IsCancellationRequested)
        {
            try
            {
                using var parent = Process.GetProcessById(_options.ParentProcessId);
                if (parent.HasExited)
                    break;
            }
            catch
            {
                break;
            }

            try { await Task.Delay(1000, _lifetime.Token); }
            catch (OperationCanceledException) { return; }
        }

        if (!_closing)
        {
            EmitLog("AtlasDesk parent process ended; closing isolated DashboardHost");
            _ = Dispatcher.BeginInvoke(new Action(Close));
        }
    }

    private void ShowError(string message)
    {
        _errorText.Text = message;
        _errorSurface.Visibility = Visibility.Visible;
    }

    private static void OpenExternalUri(string? target)
    {
        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https"))
            return;

        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            EmitLog("Unable to open external Dashboard link: " + ex);
        }
    }

    private static void EmitLog(string message) => Emit("LOG", Encode(message));

    private static void Emit(string kind, string payload)
    {
        try
        {
            Console.Out.WriteLine(ProtocolPrefix + "|" + kind + "|" + payload);
            Console.Out.Flush();
        }
        catch
        {
            // The parent might already be gone. The helper must still shut down cleanly.
        }
    }

    public static string Encode(string value)
        => Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? string.Empty));
}
