using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;
using System.Drawing;

namespace AtlasDesk.DashboardHost;

internal sealed class DashboardHostForm : Form
{
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
            ZoomFactor = 1.0
        };
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

        core.NavigationStarting += (_, args) =>
        {
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
            await HandleNewWindowRequestedAsync(args);
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

    private async Task HandleNewWindowRequestedAsync(CoreWebView2NewWindowRequestedEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            if (IsSameDashboardOrigin(args.Uri))
            {
                args.Handled = true;
                _webView.CoreWebView2?.Navigate(args.Uri);
                return;
            }

            if (!IsAuthenticationUri(args.Uri) || _environment is null)
            {
                args.Handled = true;
                OpenExternalUri(args.Uri);
                return;
            }

            try { _authenticationForm?.Close(); } catch { }
            try { _authenticationView?.Dispose(); } catch { }

            var popupView = new WebView2 { Dock = DockStyle.Fill };
            var popup = new Form
            {
                Text = "AtlasDesk 登录验证",
                Width = 1080,
                Height = 760,
                MinimumSize = new Size(720, 520),
                StartPosition = FormStartPosition.CenterScreen,
                BackColor = Color.White,
                ShowInTaskbar = true
            };
            popup.Controls.Add(popupView);
            popup.Show(this);
            await popupView.EnsureCoreWebView2Async(_environment);
            ConfigureCore(popupView.CoreWebView2, isMainDashboard: false);
            args.NewWindow = popupView.CoreWebView2;
            args.Handled = true;
            _authenticationForm = popup;
            _authenticationView = popupView;
            popup.FormClosed += (_, _) =>
            {
                try { popupView.Dispose(); } catch { }
                if (ReferenceEquals(_authenticationForm, popup)) _authenticationForm = null;
                if (ReferenceEquals(_authenticationView, popupView)) _authenticationView = null;
                try { _webView.CoreWebView2?.Reload(); } catch { }
            };
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
        return host.EndsWith(".cloudflareaccess.com", StringComparison.OrdinalIgnoreCase)
               || string.Equals(host, "github.com", StringComparison.OrdinalIgnoreCase)
               || string.Equals(host, "accounts.google.com", StringComparison.OrdinalIgnoreCase)
               || string.Equals(host, "login.microsoftonline.com", StringComparison.OrdinalIgnoreCase);
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
}
