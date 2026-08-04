using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;

namespace AtlasDesk.DashboardHost;

internal sealed class DashboardHostForm : Form
{
    private const int WmSetFocus = 0x0007;
    private const int WmMouseActivate = 0x0021;
    private const int MaActivate = 1;

    private readonly DashboardHostOptions _options;
    private readonly WebView2 _webView;
    private readonly Panel _errorPanel;
    private readonly Label _errorLabel;
    private readonly System.Windows.Forms.Timer _parentTimer;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly SemaphoreSlim _commandGate = new(1, 1);

    private CoreWebView2Environment? _environment;
    private Form? _authenticationForm;
    private WebView2? _authenticationView;
    private DateTimeOffset _lastRendererReload = DateTimeOffset.MinValue;
    private bool _authenticationSucceeded;
    private bool _closing;

    public DashboardHostForm(DashboardHostOptions options)
    {
        _options = options;
        Text = "AtlasDesk Dashboard Host";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Location = new Point(-30000, -30000);
        ClientSize = new Size(1200, 800);
        MinimumSize = new Size(320, 240);
        BackColor = Color.White;
        KeyPreview = true;

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            BackColor = Color.White,
            DefaultBackgroundColor = Color.White,
            ZoomFactor = 1.0,
            TabStop = true
        };
        _webView.Enter += (_, _) => FocusBrowserInput("webview-enter");
        Controls.Add(_webView);

        _errorLabel = new Label
        {
            AutoSize = false,
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 10F),
            ForeColor = Color.FromArgb(91, 104, 122),
            Padding = new Padding(28)
        };
        _errorPanel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(247, 249, 252),
            Visible = false
        };
        _errorPanel.Controls.Add(_errorLabel);
        Controls.Add(_errorPanel);
        _errorPanel.BringToFront();

        _parentTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        _parentTimer.Tick += ParentTimer_Tick;

        Shown += Form_Shown;
        FormClosing += Form_FormClosing;
        FormClosed += Form_FormClosed;
        DashboardHostProtocol.Log("startup-probe:dedicated-host-form-constructed");
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WmMouseActivate)
        {
            base.WndProc(ref m);
            m.Result = new IntPtr(MaActivate);
            FocusBrowserInput("wm-mouseactivate");
            return;
        }

        if (m.Msg == WmSetFocus)
        {
            base.WndProc(ref m);
            FocusBrowserInput("wm-setfocus");
            return;
        }

        base.WndProc(ref m);
    }

    private async void Form_Shown(object? sender, EventArgs e)
    {
        DashboardHostProtocol.Log("startup-probe:dedicated-host-form-shown");
        _parentTimer.Start();
        _ = Task.Run(ReadCommandsAsync);
        await InitializeWebViewAsync();
    }

    private void Form_FormClosing(object? sender, FormClosingEventArgs e)
    {
        _closing = true;
        _parentTimer.Stop();
        _lifetime.Cancel();
    }

    private void Form_FormClosed(object? sender, FormClosedEventArgs e)
    {
        try { _authenticationForm?.Close(); } catch { }
        try { _authenticationView?.Dispose(); } catch { }
        try { _webView.Dispose(); } catch { }
        _parentTimer.Dispose();
        DashboardHostProtocol.Emit(
            "CLOSED",
            Environment.ExitCode.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            Directory.CreateDirectory(_options.ProfileDirectory);
            var environmentOptions = new CoreWebView2EnvironmentOptions
            {
                AdditionalBrowserArguments = "--disable-gpu"
            };

            DashboardHostProtocol.Log(
                "Creating dedicated WinForms WebView2 environment at " + _options.ProfileDirectory);
            _environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: _options.ProfileDirectory,
                options: environmentOptions);
            await _webView.EnsureCoreWebView2Async(_environment);
            ConfigureCore(_webView.CoreWebView2, isMainDashboard: true);
            _webView.CoreWebView2.Navigate(_options.DashboardUrl);

            DashboardHostProtocol.Emit(
                "HWND",
                Handle.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture));
            DashboardHostProtocol.Emit("READY");
            DashboardHostProtocol.Log(
                "Dedicated WinForms DashboardHost ready before HWND handoff; GPU disabled; DOM injection disabled");
            BeginInvoke(new Action(() => FocusBrowserInput("initial-ready")));
        }
        catch (Exception ex)
        {
            ShowError("独立 Dashboard 进程初始化失败。\r\n\r\n" + ex.Message);
            DashboardHostProtocol.Error(ex);
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

        core.NavigationStarting += async (_, args) =>
        {
            if (isMainDashboard
                && IsAuthenticationUri(args.Uri)
                && !IsSameDashboardOrigin(args.Uri))
            {
                args.Cancel = true;
                DashboardHostProtocol.Emit(
                    "AUTHOPEN",
                    DashboardHostProtocol.Encode(args.Uri ?? string.Empty));
                _ = await EnsureAuthenticationWindowAsync(args.Uri);
                return;
            }

            if (ShouldOpenExternally(args.Uri))
            {
                args.Cancel = true;
                OpenExternalUri(args.Uri);
                DashboardHostProtocol.Log(
                    "External navigation redirected from dedicated DashboardHost: " + args.Uri);
                return;
            }

            DashboardHostProtocol.Emit(
                "NAVSTART",
                DashboardHostProtocol.Encode(args.Uri ?? string.Empty));
        };

        core.NavigationCompleted += (_, args) =>
        {
            DashboardHostProtocol.Emit(
                "NAVEND",
                args.IsSuccess ? "success" : "failure:" + args.WebErrorStatus);
            if (args.IsSuccess)
            {
                _errorPanel.Visible = false;
                if (!isMainDashboard && IsSameDashboardOrigin(core.Source))
                    CompleteAuthentication(core.Source);
            }
            else if (isMainDashboard)
            {
                ShowError("Dashboard 页面载入失败：" + args.WebErrorStatus);
            }
        };

        core.SourceChanged += (_, _) => DashboardHostProtocol.Emit(
            "SOURCE",
            DashboardHostProtocol.Encode(core.Source ?? string.Empty));
        core.DocumentTitleChanged += (_, _) => DashboardHostProtocol.Emit(
            "TITLE",
            DashboardHostProtocol.Encode(core.DocumentTitle ?? string.Empty));
        core.NewWindowRequested += async (_, args) =>
            await HandleNewWindowRequestedAsync(core, args, isMainDashboard);
        core.ProcessFailed += (_, args) =>
            HandleProcessFailed(args, isMainDashboard);
    }

    private void HandleProcessFailed(CoreWebView2ProcessFailedEventArgs args, bool isMainDashboard)
    {
        var detail = $"kind={args.ProcessFailedKind}; reason={args.Reason}; exitCode={args.ExitCode}; description={args.ProcessDescription}";
        DashboardHostProtocol.Emit("PROCESSFAILED", DashboardHostProtocol.Encode(detail));
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
                DashboardHostProtocol.Log(
                    "Dedicated DashboardHost observed an auto-recoverable process failure: " + detail);
                break;

            case CoreWebView2ProcessFailedKind.RenderProcessUnresponsive:
            case CoreWebView2ProcessFailedKind.RenderProcessExited:
                BeginInvoke(new Action(() => ReloadRendererWithCooldown(detail)));
                break;

            case CoreWebView2ProcessFailedKind.BrowserProcessExited:
                DashboardHostProtocol.Log(
                    "Dedicated WebView2 browser process exited; terminating only AtlasDesk.DashboardHost");
                Environment.ExitCode = 73;
                BeginInvoke(new Action(Close));
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
            DashboardHostProtocol.Log("Renderer reload suppressed by cooldown: " + reason);
            return;
        }

        _lastRendererReload = now;
        try
        {
            DashboardHostProtocol.Log("Reloading dedicated Dashboard renderer: " + reason);
            _webView.CoreWebView2.Reload();
        }
        catch (Exception ex)
        {
            DashboardHostProtocol.Log(
                "Renderer reload failed; exiting only AtlasDesk.DashboardHost: " + ex);
            Environment.ExitCode = 74;
            Close();
        }
    }

    private async Task HandleNewWindowRequestedAsync(
        CoreWebView2 sourceCore,
        CoreWebView2NewWindowRequestedEventArgs args,
        bool isMainDashboard)
    {
        var deferral = args.GetDeferral();
        try
        {
            if (IsSameDashboardOrigin(args.Uri))
            {
                args.Handled = true;
                _webView.CoreWebView2?.Navigate(args.Uri);
                if (!isMainDashboard)
                    CompleteAuthentication(args.Uri);
                return;
            }

            if (IsAuthenticationUri(args.Uri) && _environment is not null)
            {
                args.Handled = true;
                if (!isMainDashboard)
                {
                    sourceCore.Navigate(args.Uri);
                    return;
                }

                var popupView = await EnsureAuthenticationWindowAsync(initialUri: null);
                if (popupView?.CoreWebView2 is not null)
                    args.NewWindow = popupView.CoreWebView2;
                else
                    OpenExternalUri(args.Uri);
                return;
            }

            args.Handled = true;
            OpenExternalUri(args.Uri);
        }
        catch (Exception ex)
        {
            DashboardHostProtocol.Log("Dedicated Dashboard new-window handling failed: " + ex);
            args.Handled = true;
            OpenExternalUri(args.Uri);
        }
        finally
        {
            deferral.Complete();
        }
    }

    private async Task<WebView2?> EnsureAuthenticationWindowAsync(string? initialUri)
    {
        if (_environment is null || _closing)
            return null;

        if (_authenticationForm is { IsDisposed: false } existingForm
            && _authenticationView is { IsDisposed: false } existingView)
        {
            if (!existingForm.Visible)
                existingForm.Show();
            existingForm.Activate();
            existingForm.BringToFront();
            if (!string.IsNullOrWhiteSpace(initialUri) && existingView.CoreWebView2 is not null)
                existingView.CoreWebView2.Navigate(initialUri);
            existingView.Focus();
            return existingView;
        }

        try { _authenticationForm?.Close(); } catch { }
        try { _authenticationView?.Dispose(); } catch { }

        var popupView = new WebView2
        {
            Dock = DockStyle.Fill,
            TabStop = true,
            BackColor = Color.White,
            DefaultBackgroundColor = Color.White
        };
        var popup = new Form
        {
            Text = "AtlasDesk 登录验证",
            Width = 1080,
            Height = 760,
            MinimumSize = new Size(720, 520),
            StartPosition = FormStartPosition.CenterScreen,
            BackColor = Color.White,
            ShowInTaskbar = true,
            FormBorderStyle = FormBorderStyle.Sizable
        };
        popup.Controls.Add(popupView);

        _authenticationSucceeded = false;
        _authenticationForm = popup;
        _authenticationView = popupView;
        popup.FormClosed += (_, _) => AuthenticationPopup_FormClosed(popup, popupView);
        popup.Show();

        try
        {
            await popupView.EnsureCoreWebView2Async(_environment);
            ConfigureCore(popupView.CoreWebView2, isMainDashboard: false);
            if (!string.IsNullOrWhiteSpace(initialUri))
                popupView.CoreWebView2.Navigate(initialUri);
            popup.Activate();
            popup.BringToFront();
            popupView.Focus();
            return popupView;
        }
        catch (Exception ex)
        {
            DashboardHostProtocol.Log("Authentication popup initialization failed: " + ex);
            try { popup.Close(); } catch { }
            return null;
        }
    }

    private void CompleteAuthentication(string? callbackUri)
    {
        if (_authenticationForm is null || _authenticationForm.IsDisposed)
            return;

        _authenticationSucceeded = true;
        DashboardHostProtocol.Log("Authentication returned to Dashboard origin: " + callbackUri);
        try { _authenticationForm.Close(); } catch { }
    }

    private void AuthenticationPopup_FormClosed(Form popup, WebView2 popupView)
    {
        var succeeded = _authenticationSucceeded;
        try { popupView.Dispose(); } catch { }
        if (ReferenceEquals(_authenticationForm, popup)) _authenticationForm = null;
        if (ReferenceEquals(_authenticationView, popupView)) _authenticationView = null;
        _authenticationSucceeded = false;

        DashboardHostProtocol.Emit("AUTHCLOSED", succeeded ? "success" : "cancelled");
        if (!succeeded || _closing)
            return;

        try
        {
            _webView.CoreWebView2?.Navigate(_options.DashboardUrl);
            BeginInvoke(new Action(() => FocusBrowserInput("authentication-completed")));
        }
        catch (Exception ex)
        {
            DashboardHostProtocol.Log("Dashboard navigation after authentication failed: " + ex);
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
                if (IsDisposed || _closing)
                    break;
                BeginInvoke(new Action(() => ExecuteCommand(command)));
            }
        }
        catch (Exception ex) when (!_closing)
        {
            DashboardHostProtocol.Log("Dedicated DashboardHost command channel ended: " + ex.Message);
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
                case "focus":
                    FocusBrowserInput("command");
                    break;
                case "shutdown":
                    Close();
                    break;
            }
        }
        catch (Exception ex)
        {
            DashboardHostProtocol.Emit("COMMANDERROR", DashboardHostProtocol.Encode(ex.ToString()));
        }
    }

    private void ExecuteSerialized(Action action)
    {
        if (!_commandGate.Wait(0))
        {
            DashboardHostProtocol.Log("Dedicated DashboardHost command ignored while another command is active");
            return;
        }

        try { action(); }
        finally { _commandGate.Release(); }
    }

    private void FocusBrowserInput(string reason)
    {
        if (_closing || IsDisposed || !_webView.IsHandleCreated)
            return;

        var currentThread = GetCurrentThreadId();
        var foreground = GetForegroundWindow();
        var foregroundThread = foreground == IntPtr.Zero
            ? 0
            : GetWindowThreadProcessId(foreground, out _);
        var attached = false;
        try
        {
            if (foregroundThread != 0 && foregroundThread != currentThread)
                attached = AttachThreadInput(currentThread, foregroundThread, true);

            if (Handle != IntPtr.Zero)
                _ = SetActiveWindow(Handle);
            _webView.Select();
            _webView.Focus();
            _ = SetFocus(_webView.Handle);
            DashboardHostProtocol.Emit("FOCUS", DashboardHostProtocol.Encode(reason));
        }
        catch (Exception ex)
        {
            DashboardHostProtocol.Log("Dashboard input focus transfer failed: " + ex.Message);
        }
        finally
        {
            if (attached)
                _ = AttachThreadInput(currentThread, foregroundThread, false);
        }
    }

    private void ParentTimer_Tick(object? sender, EventArgs e)
    {
        try
        {
            using var parent = Process.GetProcessById(_options.ParentProcessId);
            if (!parent.HasExited)
                return;
        }
        catch
        {
            // Missing parent means the primary process has ended.
        }

        DashboardHostProtocol.Log("AtlasDesk parent process ended; closing dedicated DashboardHost");
        Close();
    }

    private bool ShouldOpenExternally(string? target)
    {
        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri))
            return true;
        if (uri.Scheme is not ("http" or "https"))
            return true;
        return !IsSameDashboardOrigin(uri.AbsoluteUri) && !IsAuthenticationUri(uri.AbsoluteUri);
    }

    private bool IsSameDashboardOrigin(string? target)
    {
        if (!Uri.TryCreate(target, UriKind.Absolute, out var targetUri)
            || !Uri.TryCreate(_options.DashboardUrl, UriKind.Absolute, out var dashboardUri))
        {
            return false;
        }

        return string.Equals(targetUri.Scheme, dashboardUri.Scheme, StringComparison.OrdinalIgnoreCase)
               && string.Equals(targetUri.Host, dashboardUri.Host, StringComparison.OrdinalIgnoreCase)
               && targetUri.Port == dashboardUri.Port;
    }

    private static bool IsAuthenticationUri(string? target)
    {
        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri))
            return false;

        var host = uri.Host;
        if (host.EndsWith(".cloudflareaccess.com", StringComparison.OrdinalIgnoreCase)
            || string.Equals(host, "accounts.google.com", StringComparison.OrdinalIgnoreCase)
            || string.Equals(host, "login.microsoftonline.com", StringComparison.OrdinalIgnoreCase)
            || string.Equals(host, "appleid.apple.com", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (!string.Equals(host, "github.com", StringComparison.OrdinalIgnoreCase))
            return false;

        var path = uri.AbsolutePath;
        return path.StartsWith("/login", StringComparison.OrdinalIgnoreCase)
               || path.StartsWith("/session", StringComparison.OrdinalIgnoreCase)
               || path.StartsWith("/sessions", StringComparison.OrdinalIgnoreCase)
               || path.StartsWith("/password_reset", StringComparison.OrdinalIgnoreCase)
               || path.StartsWith("/webauthn", StringComparison.OrdinalIgnoreCase)
               || path.StartsWith("/two-factor", StringComparison.OrdinalIgnoreCase);
    }

    private void ShowError(string message)
    {
        _errorLabel.Text = message;
        _errorPanel.Visible = true;
        _errorPanel.BringToFront();
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
            DashboardHostProtocol.Log("Unable to open external Dashboard link: " + ex);
        }
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);

    [DllImport("user32.dll")]
    private static extern IntPtr SetActiveWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hwnd);
}
