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
    private const int WmSysCommand = 0x0112;
    private const int ScClose = 0xF060;
    private const int MaActivate = 1;
    private const int GwlStyle = -16;
    private const int GwlExStyle = -20;

    private const long WsChild = 0x40000000L;
    private const long WsVisible = 0x10000000L;
    private const long WsPopup = unchecked((long)0x80000000);
    private const long WsCaption = 0x00C00000L;
    private const long WsThickFrame = 0x00040000L;
    private const long WsSysMenu = 0x00080000L;
    private const long WsMinimizeBox = 0x00020000L;
    private const long WsMaximizeBox = 0x00010000L;
    private const long WsExAppWindow = 0x00040000L;
    private const long WsExToolWindow = 0x00000080L;

    private const uint SwpNoZOrder = 0x0004;
    private const uint SwpFrameChanged = 0x0020;
    private const uint SwpShowWindow = 0x0040;
    private const int SwShow = 5;

    private readonly DashboardHostOptions _options;
    private readonly WebView2 _webView;
    private readonly Panel _errorPanel;
    private readonly Label _errorLabel;
    private readonly System.Windows.Forms.Timer _parentTimer;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly SemaphoreSlim _commandGate = new(1, 1);

    private CoreWebView2Environment? _environment;
    private DateTimeOffset _lastRendererReload = DateTimeOffset.MinValue;
    private IntPtr _embeddedParent;
    private long _embeddedStyle;
    private long _embeddedExStyle;
    private bool _authenticationActive;
    private bool _authenticationDetached;
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

        _parentTimer = new System.Windows.Forms.Timer { Interval = 500 };
        _parentTimer.Tick += ParentTimer_Tick;

        Shown += Form_Shown;
        FormClosing += Form_FormClosing;
        FormClosed += Form_FormClosed;
        DashboardHostProtocol.Log("startup-probe:dedicated-host-form-constructed");
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WmSysCommand
            && ((int)m.WParam.ToInt64() & 0xFFF0) == ScClose
            && _authenticationActive
            && !_closing)
        {
            CancelAuthentication("window-close");
            m.Result = IntPtr.Zero;
            return;
        }

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
        if (!_closing && _authenticationActive && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            CancelAuthentication("form-closing");
            return;
        }

        _closing = true;
        _parentTimer.Stop();
        _lifetime.Cancel();
    }

    private void Form_FormClosed(object? sender, FormClosedEventArgs e)
    {
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
            var proxy = DashboardProxyConfiguration.Resolve();
            var environmentOptions = new CoreWebView2EnvironmentOptions
            {
                AdditionalBrowserArguments = proxy.BrowserArguments
            };

            DashboardHostProtocol.Log(
                "Creating dedicated WinForms WebView2 environment at " + _options.ProfileDirectory);
            DashboardHostProtocol.Log("DashboardHost network route: " + proxy.Description);
            _environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: _options.ProfileDirectory,
                options: environmentOptions);
            await _webView.EnsureCoreWebView2Async(_environment);
            ConfigureCore(_webView.CoreWebView2);
            _webView.CoreWebView2.Navigate(_options.DashboardUrl);

            DashboardHostProtocol.Emit(
                "HWND",
                Handle.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture));
            DashboardHostProtocol.Emit("READY");
            DashboardHostProtocol.Log(
                "Dedicated WinForms DashboardHost ready before HWND handoff; one WebView owns Dashboard and Access authentication");
            BeginInvoke(new Action(() => FocusBrowserInput("initial-ready")));
        }
        catch (Exception ex)
        {
            ShowError("独立 Dashboard 进程初始化失败。\r\n\r\n" + ex.Message);
            DashboardHostProtocol.Error(ex);
        }
    }

    private void ConfigureCore(CoreWebView2 core)
    {
        core.Settings.AreDefaultScriptDialogsEnabled = true;
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = true;
        core.Settings.AreBrowserAcceleratorKeysEnabled = true;

        core.NavigationStarting += (_, args) =>
        {
            if (IsAuthenticationFlowUri(args.Uri))
            {
                EnterAuthenticationMode(args.Uri);
            }
            else if (ShouldOpenExternally(args.Uri))
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

        core.NavigationCompleted += async (_, args) =>
        {
            DashboardHostProtocol.Emit(
                "NAVEND",
                args.IsSuccess ? "success" : "failure:" + args.WebErrorStatus);
            if (!args.IsSuccess)
            {
                if (!_authenticationActive)
                    ShowError("Dashboard 页面载入失败：" + args.WebErrorStatus);
                return;
            }

            _errorPanel.Visible = false;
            if (_authenticationActive
                && IsDashboardApplicationUri(core.Source)
                && await HasApplicationAccessCookieAsync(core))
            {
                CompleteAuthentication(core.Source);
            }
        };

        core.SourceChanged += (_, _) => DashboardHostProtocol.Emit(
            "SOURCE",
            DashboardHostProtocol.Encode(core.Source ?? string.Empty));
        core.DocumentTitleChanged += (_, _) => DashboardHostProtocol.Emit(
            "TITLE",
            DashboardHostProtocol.Encode(core.DocumentTitle ?? string.Empty));
        core.NewWindowRequested += (_, args) => HandleNewWindowRequested(core, args);
        core.ProcessFailed += (_, args) => HandleProcessFailed(args);
    }

    private void HandleNewWindowRequested(CoreWebView2 core, CoreWebView2NewWindowRequestedEventArgs args)
    {
        try
        {
            if (IsAuthenticationFlowUri(args.Uri) || IsSameDashboardOrigin(args.Uri))
            {
                args.Handled = true;
                if (IsAuthenticationFlowUri(args.Uri))
                    EnterAuthenticationMode(args.Uri);
                core.Navigate(args.Uri);
                DashboardHostProtocol.Log(
                    "New-window authentication kept in the existing Dashboard WebView: " + args.Uri);
                return;
            }

            args.Handled = true;
            OpenExternalUri(args.Uri);
        }
        catch (Exception ex)
        {
            DashboardHostProtocol.Log("Dedicated Dashboard new-window handling failed: " + ex);
            args.Handled = true;
        }
    }

    private void EnterAuthenticationMode(string? target)
    {
        if (_closing)
            return;

        if (!_authenticationActive)
        {
            _authenticationActive = true;
            DashboardHostProtocol.Emit(
                "AUTHMODE",
                "start|" + DashboardHostProtocol.Encode(target ?? string.Empty));
            DashboardHostProtocol.Log(
                "Access authentication started in the existing Dashboard WebView: " + target);
        }

        _errorPanel.Visible = false;
        TryDetachForAuthentication();
    }

    private void TryDetachForAuthentication()
    {
        if (!_authenticationActive || _authenticationDetached || Handle == IntPtr.Zero)
            return;

        var parent = GetParent(Handle);
        if (parent == IntPtr.Zero || !IsWindow(parent))
            return;

        try
        {
            _embeddedParent = parent;
            _embeddedStyle = GetWindowStyle(Handle);
            _embeddedExStyle = GetWindowExStyle(Handle);

            _ = SetParent(Handle, IntPtr.Zero);
            var style = _embeddedStyle;
            style &= ~WsChild;
            style |= WsPopup | WsVisible | WsCaption | WsThickFrame | WsSysMenu | WsMinimizeBox | WsMaximizeBox;
            SetWindowStyle(Handle, style);

            var exStyle = _embeddedExStyle;
            exStyle &= ~WsExToolWindow;
            exStyle |= WsExAppWindow;
            SetWindowExStyle(Handle, exStyle);

            Text = "AtlasDesk · Cloudflare Access 登录";
            var workingArea = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 800);
            var width = Math.Min(1120, Math.Max(760, workingArea.Width - 120));
            var height = Math.Min(820, Math.Max(560, workingArea.Height - 100));
            var x = workingArea.Left + Math.Max(0, (workingArea.Width - width) / 2);
            var y = workingArea.Top + Math.Max(0, (workingArea.Height - height) / 2);
            _ = SetWindowPos(
                Handle,
                IntPtr.Zero,
                x,
                y,
                width,
                height,
                SwpFrameChanged | SwpShowWindow);
            _ = ShowWindow(Handle, SwShow);
            _ = SetForegroundWindow(Handle);
            _authenticationDetached = true;
            DashboardHostProtocol.Emit("AUTHWINDOW", "detached");
            BeginInvoke(new Action(() => FocusBrowserInput("authentication-detached")));
        }
        catch (Exception ex)
        {
            DashboardHostProtocol.Log("Unable to detach DashboardHost for authentication: " + ex);
        }
    }

    private async Task<bool> HasApplicationAccessCookieAsync(CoreWebView2 core)
    {
        try
        {
            var cookies = await core.CookieManager.GetCookiesAsync(_options.DashboardUrl);
            var found = cookies.Any(cookie =>
                string.Equals(cookie.Name, "CF_Authorization", StringComparison.OrdinalIgnoreCase));
            DashboardHostProtocol.Log(
                found
                    ? "Cloudflare application authorization cookie confirmed in the same WebView profile"
                    : "Dashboard origin returned without CF_Authorization; authentication window remains open");
            return found;
        }
        catch (Exception ex)
        {
            DashboardHostProtocol.Log("Unable to verify Cloudflare application cookie: " + ex.Message);
            return false;
        }
    }

    private void CompleteAuthentication(string? callbackUri)
    {
        if (!_authenticationActive)
            return;

        DashboardHostProtocol.Log(
            "Access authentication completed in the same Dashboard WebView: " + callbackUri);
        RestoreEmbeddedMode("success");
    }

    private void CancelAuthentication(string reason)
    {
        if (!_authenticationActive || _closing)
            return;

        try { _webView.CoreWebView2?.Stop(); } catch { }
        DashboardHostProtocol.Log("Access authentication cancelled: " + reason);
        RestoreEmbeddedMode("cancelled");
        ShowError("Cloudflare Access 登录已取消。\r\n\r\n点击 Dashboard 顶部刷新或首页按钮可重新开始登录。\r\n认证必须从开始到回调始终使用同一个 Dashboard 浏览器，不能中途切换到 Chrome。");
    }

    private void RestoreEmbeddedMode(string result)
    {
        var parent = _embeddedParent;
        try
        {
            if (_authenticationDetached && parent != IntPtr.Zero && IsWindow(parent))
            {
                _ = SetParent(Handle, parent);
                SetWindowStyle(Handle, _embeddedStyle);
                SetWindowExStyle(Handle, _embeddedExStyle);

                if (!GetClientRect(parent, out var rect))
                    rect = new Rect { Right = Math.Max(1, Width), Bottom = Math.Max(1, Height) };
                _ = SetWindowPos(
                    Handle,
                    IntPtr.Zero,
                    0,
                    0,
                    Math.Max(1, rect.Right - rect.Left),
                    Math.Max(1, rect.Bottom - rect.Top),
                    SwpNoZOrder | SwpFrameChanged | SwpShowWindow);
                _ = ShowWindow(Handle, SwShow);
            }
        }
        catch (Exception ex)
        {
            DashboardHostProtocol.Log("Unable to re-embed DashboardHost after authentication: " + ex);
        }
        finally
        {
            Text = "AtlasDesk Dashboard Host";
            _authenticationActive = false;
            _authenticationDetached = false;
            _embeddedParent = IntPtr.Zero;
            _embeddedStyle = 0;
            _embeddedExStyle = 0;
            DashboardHostProtocol.Emit("AUTHMODE", result);
            BeginInvoke(new Action(() => FocusBrowserInput("authentication-" + result)));
        }
    }

    private void HandleProcessFailed(CoreWebView2ProcessFailedEventArgs args)
    {
        var detail = $"kind={args.ProcessFailedKind}; reason={args.Reason}; exitCode={args.ExitCode}; description={args.ProcessDescription}";
        DashboardHostProtocol.Emit("PROCESSFAILED", DashboardHostProtocol.Encode(detail));
        if (_closing)
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
                _closing = true;
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
            _closing = true;
            Close();
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
                    ExecuteSerialized(() =>
                    {
                        _errorPanel.Visible = false;
                        _webView.CoreWebView2?.Reload();
                    });
                    break;
                case "home":
                    ExecuteSerialized(() =>
                    {
                        _errorPanel.Visible = false;
                        _webView.CoreWebView2?.Navigate(_options.DashboardUrl);
                    });
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
                case "test-auth-flow":
                    if (Uri.TryCreate(_options.DashboardUrl, UriKind.Absolute, out var testUri)
                        && testUri.IsLoopback)
                    {
                        var target = new Uri(testUri, "/cdn-cgi/access/login");
                        _webView.CoreWebView2?.Navigate(target.AbsoluteUri);
                    }
                    break;
                case "shutdown":
                    _closing = true;
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
        if (_authenticationActive && !_authenticationDetached)
            TryDetachForAuthentication();

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
        _closing = true;
        Close();
    }

    private bool ShouldOpenExternally(string? target)
    {
        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri))
            return true;
        if (uri.Scheme is not ("http" or "https"))
            return true;
        if (IsSameDashboardOrigin(uri.AbsoluteUri) || IsAuthenticationFlowUri(uri.AbsoluteUri))
            return false;
        return true;
    }

    private bool IsDashboardApplicationUri(string? target)
    {
        if (!IsSameDashboardOrigin(target)
            || !Uri.TryCreate(target, UriKind.Absolute, out var uri))
        {
            return false;
        }

        return !uri.AbsolutePath.StartsWith("/cdn-cgi/access/", StringComparison.OrdinalIgnoreCase);
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

    private bool IsAuthenticationFlowUri(string? target)
    {
        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri))
            return false;

        if (uri.AbsolutePath.StartsWith("/cdn-cgi/access/", StringComparison.OrdinalIgnoreCase))
            return true;

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

        if (_authenticationActive)
            return true;

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

    private static long GetWindowStyle(IntPtr hwnd)
        => IntPtr.Size == 8
            ? GetWindowLongPtr(hwnd, GwlStyle).ToInt64()
            : GetWindowLong(hwnd, GwlStyle);

    private static long GetWindowExStyle(IntPtr hwnd)
        => IntPtr.Size == 8
            ? GetWindowLongPtr(hwnd, GwlExStyle).ToInt64()
            : GetWindowLong(hwnd, GwlExStyle);

    private static void SetWindowStyle(IntPtr hwnd, long style)
    {
        if (IntPtr.Size == 8)
            _ = SetWindowLongPtr(hwnd, GwlStyle, new IntPtr(style));
        else
            _ = SetWindowLong(hwnd, GwlStyle, unchecked((int)style));
    }

    private static void SetWindowExStyle(IntPtr hwnd, long style)
    {
        if (IntPtr.Size == 8)
            _ = SetWindowLongPtr(hwnd, GwlExStyle, new IntPtr(style));
        else
            _ = SetWindowLong(hwnd, GwlExStyle, unchecked((int)style));
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
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

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr hwnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr child, IntPtr newParent);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr hwnd);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetClientRect(IntPtr hwnd, out Rect rect);

    [DllImport("user32.dll", EntryPoint = "GetWindowLong", SetLastError = true)]
    private static extern int GetWindowLong(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLong", SetLastError = true)]
    private static extern int SetWindowLong(IntPtr hwnd, int index, int newValue);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr newValue);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(
        IntPtr hwnd,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr hwnd, int command);
}
