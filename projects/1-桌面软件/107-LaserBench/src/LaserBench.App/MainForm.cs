using System.Drawing.Imaging;

namespace LaserBench;

internal sealed class MainForm : Form
{
    private readonly bool _safeMode;
    private readonly Panel _contentHost = new() { Dock = DockStyle.Fill, BackColor = Color.White };
    private readonly Panel _bootPanel = new() { Dock = DockStyle.Fill, BackColor = Color.White };
    private readonly Label _bootLabel = new()
    {
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleCenter,
        Font = new Font("Segoe UI", 11f, FontStyle.Regular),
        ForeColor = Color.FromArgb(66, 78, 92),
        Text = "LaserBench\r\nInitializing workspace..."
    };

    private AppConfig? _config;
    private IInstrumentProvider? _provider;
    private CaptureService? _captureService;
    private TopBarControl? _topBar;
    private SidebarControl? _sidebar;
    private DashboardControl? _dashboard;
    private ScreenRecorder? _recorder;
    private CancellationTokenSource? _captureCancellation;
    private string _currentPage = "dashboard";
    private bool _workspaceReady;

    public MainForm(bool safeMode = false)
    {
        _safeMode = safeMode;
        Text = safeMode ? "LaserBench [Safe Mode]" : "LaserBench";
        BackColor = Color.White;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(1100, 700);
        Size = new Size(1500, 900);
        WindowState = FormWindowState.Maximized;
        AutoScaleMode = AutoScaleMode.Dpi;
        KeyPreview = true;

        _bootPanel.Controls.Add(_bootLabel);
        Controls.Add(_bootPanel);

        Shown += (_, _) =>
        {
            StartupDiagnostics.Stage("window-shown");
            BeginInvoke(new Action(InitializeWorkspace));
        };

        FormClosing += (_, _) =>
        {
            try { if (_recorder?.IsRecording == true) _recorder.Stop(); } catch (Exception ex) { StartupDiagnostics.Crash("recorder shutdown", ex); }
            try { if (_config is not null) AppConfigStore.Save(_config); } catch (Exception ex) { StartupDiagnostics.Crash("config save on close", ex); }
        };
    }

    private void InitializeWorkspace()
    {
        if (_workspaceReady) return;

        try
        {
            SetBootText("LaserBench\r\nLoading configuration...");
            StartupDiagnostics.Stage("config-load", "begin");
            _config = AppConfigStore.Load();
            StartupDiagnostics.Stage("config-load");

            SetBootText("LaserBench\r\nStarting simulator...");
            StartupDiagnostics.Stage("simulator", "begin");
            _provider = new SimulatorProvider();
            _captureService = new CaptureService(_provider);
            var probe = _provider.Snapshot(_config);
            StartupDiagnostics.Stage("simulator", $"power={probe.Power.Count}; spectrum={probe.Spectrum.Count}; beam={probe.Beam.Count}");

            SetBootText("LaserBench\r\nBuilding dashboard...");
            StartupDiagnostics.Stage("topbar", "begin");
            _topBar = new TopBarControl(_config, _provider) { Dock = DockStyle.Top, Height = 34 };
            StartupDiagnostics.Stage("topbar");

            StartupDiagnostics.Stage("sidebar", "begin");
            _sidebar = new SidebarControl(_config) { Dock = DockStyle.Left };
            StartupDiagnostics.Stage("sidebar");

            StartupDiagnostics.Stage("dashboard", "begin");
            _dashboard = new DashboardControl(_provider, _config) { Dock = DockStyle.Fill };
            StartupDiagnostics.Stage("dashboard");

            var body = new Panel { Dock = DockStyle.Fill, BackColor = UiTheme.PlotBack };
            body.Controls.Add(_contentHost);
            body.Controls.Add(_sidebar);

            SuspendLayout();
            Controls.Clear();
            Controls.Add(body);
            Controls.Add(_topBar);
            ResumeLayout(true);

            _dashboard.OpenModuleRequested += OpenModule;
            _topBar.CaptureClicked += async (_, _) => await ToggleCaptureAsync();
            _topBar.ScreenshotClicked += (_, _) => SaveScreenshot();
            _topBar.RecordClicked += (_, _) => ToggleRecording();
            _topBar.LabelConfirmed += _ => AppConfigStore.Save(_config);
            _topBar.CaptureSelectionChanged += (_, _) => AppConfigStore.Save(_config);
            _sidebar.NavigateRequested += Navigate;
            _sidebar.ExpandedChanged += _ => PerformLayout();

            if (!_safeMode)
            {
                try
                {
                    StartupDiagnostics.Stage("recorder", "begin");
                    _recorder = new ScreenRecorder(this);
                    StartupDiagnostics.Stage("recorder");
                }
                catch (Exception ex)
                {
                    StartupDiagnostics.Crash("recorder initialization", ex);
                    _recorder = null;
                }
            }
            else
            {
                StartupDiagnostics.Stage("recorder", "skipped in safe mode");
            }

            ShowDashboard();
            _workspaceReady = true;
            StartupDiagnostics.Stage("workspace-ready", _safeMode ? "safe mode" : "normal mode");
        }
        catch (Exception ex)
        {
            StartupDiagnostics.Crash("workspace initialization", ex);
            ShowStartupFailure(ex);
        }
    }

    private void SetBootText(string text)
    {
        _bootLabel.Text = text;
        _bootLabel.Refresh();
    }

    private void ShowStartupFailure(Exception exception)
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Color.White, Padding = new Padding(36) };
        var title = new Label
        {
            AutoSize = false,
            Dock = DockStyle.Top,
            Height = 44,
            Font = new Font("Segoe UI Semibold", 15f, FontStyle.Bold),
            ForeColor = Color.FromArgb(42, 55, 69),
            Text = "LaserBench started, but the workspace could not be initialized."
        };
        var details = new TextBox
        {
            Dock = DockStyle.Fill,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            BorderStyle = BorderStyle.FixedSingle,
            Font = new Font("Consolas", 9f),
            Text = $"{exception}\r\n\r\nDiagnostic log:\r\n{StartupDiagnostics.CrashLogPath}\r\n\r\nTry safe mode from PowerShell:\r\n.\\LaserBench.App.exe --safe"
        };
        panel.Controls.Add(details);
        panel.Controls.Add(title);

        SuspendLayout();
        Controls.Clear();
        Controls.Add(panel);
        ResumeLayout(true);
        Text = "LaserBench [Startup diagnostics]";
    }

    private void Navigate(string key)
    {
        if (!_workspaceReady) return;
        switch (key)
        {
            case "dashboard": ShowDashboard(); break;
            case "power": OpenModule(ModuleKind.Power); break;
            case "spectrum": OpenModule(ModuleKind.Spectrum); break;
            case "beam": OpenModule(ModuleKind.Beam); break;
            case "scope": OpenModule(ModuleKind.Scope); break;
            case "data": ShowData(); break;
            case "settings": ShowSettings(); break;
        }
    }

    private void ShowDashboard()
    {
        if (_dashboard is null || _sidebar is null) return;
        _currentPage = "dashboard";
        _sidebar.SetActive("dashboard");
        ShowContent(_dashboard);
    }

    private void OpenModule(ModuleKind kind)
    {
        if (_dashboard is null || _sidebar is null || _config is null) return;
        _currentPage = kind.ToString().ToLowerInvariant();
        _sidebar.SetActive(_currentPage);
        var page = new ModulePageControl(kind, _dashboard, _config) { Dock = DockStyle.Fill };
        ShowContent(page, disposePrevious: true);
    }

    private void ShowData()
    {
        if (_sidebar is null || _config is null) return;
        _currentPage = "data";
        _sidebar.SetActive("data");
        ShowContent(new DataPageControl(_config) { Dock = DockStyle.Fill }, disposePrevious: true);
    }

    private void ShowSettings()
    {
        if (_sidebar is null || _config is null) return;
        _currentPage = "settings";
        _sidebar.SetActive("settings");
        var page = new SettingsPageControl(_config) { Dock = DockStyle.Fill };
        page.AliasesChanged += (_, _) =>
        {
            _topBar?.RefreshAliases();
            _dashboard?.Invalidate(true);
        };
        ShowContent(page, disposePrevious: true);
    }

    private void ShowContent(Control control, bool disposePrevious = false)
    {
        var previous = _contentHost.Controls.Cast<Control>().FirstOrDefault();
        if (ReferenceEquals(previous, control)) return;
        _contentHost.Controls.Clear();
        if (disposePrevious && previous is not null && !ReferenceEquals(previous, _dashboard)) previous.Dispose();
        _contentHost.Controls.Add(control);
        control.Dock = DockStyle.Fill;
    }

    private async Task ToggleCaptureAsync()
    {
        if (_captureService is null || _config is null || _topBar is null) return;

        if (_captureCancellation is not null)
        {
            _captureCancellation.Cancel();
            return;
        }

        var frozen = CloneConfig(_config);
        _captureCancellation = new CancellationTokenSource();
        _topBar.SetCapturing(true);
        try
        {
            var result = await _captureService.CaptureAsync(frozen, _captureCancellation.Token);
            if (!result.Cancelled && frozen.AutoScreenshot) SaveScreenshot(result.RequestedAt, frozen.ConfirmedLabel);
            if (result.Errors.Count > 0)
                MessageBox.Show(this, string.Join(Environment.NewLine, result.Errors), "LaserBench capture", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        catch (Exception ex)
        {
            StartupDiagnostics.Crash("capture", ex);
            MessageBox.Show(this, ex.Message, "LaserBench capture", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally
        {
            _captureCancellation.Dispose();
            _captureCancellation = null;
            _topBar.SetCapturing(false);
        }
    }

    private static AppConfig CloneConfig(AppConfig source) => new()
    {
        ConfirmedLabel = source.ConfirmedLabel,
        CurrentExperimentFolder = source.CurrentExperimentFolder,
        CapturePower = source.CapturePower,
        CaptureSpectrum = source.CaptureSpectrum,
        CaptureBeam = source.CaptureBeam,
        CaptureScope = source.CaptureScope,
        AutoScreenshot = source.AutoScreenshot,
        SidebarExpanded = source.SidebarExpanded,
        BeamZ = source.BeamZ,
        BeamAttenuation = source.BeamAttenuation,
        Power1Alias = source.Power1Alias,
        Power2Alias = source.Power2Alias,
        Math1Alias = source.Math1Alias,
        Osa1Alias = source.Osa1Alias,
        BeamAlias = source.BeamAlias,
        Scope1Alias = source.Scope1Alias,
        Scope2Alias = source.Scope2Alias
    };

    private void SaveScreenshot(DateTime? timestamp = null, string? label = null)
    {
        if (_config is null) return;
        try
        {
            var time = timestamp ?? DateTime.Now;
            var safeLabel = label ?? _config.ConfirmedLabel;
            using var bitmap = new Bitmap(Math.Max(1, ClientSize.Width), Math.Max(1, ClientSize.Height), PixelFormat.Format24bppRgb);
            DrawToBitmap(bitmap, new Rectangle(Point.Empty, ClientSize));
            var partial = Path.Combine(AppPaths.PicDir, $".{Guid.NewGuid():N}.png.partial");
            bitmap.Save(partial, ImageFormat.Png);
            var source = _currentPage == "dashboard" ? "dashboard" : _currentPage;
            var baseName = SafeFile.ComposeBaseName(time, source, safeLabel);
            SafeFile.MovePartialToUnique(partial, AppPaths.PicDir, baseName, ".png");
        }
        catch (Exception ex)
        {
            StartupDiagnostics.Crash("screenshot", ex);
            MessageBox.Show(this, ex.Message, "Screenshot failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void ToggleRecording()
    {
        if (_topBar is null || _config is null) return;
        if (_safeMode)
        {
            MessageBox.Show(this, "Recording is disabled in safe mode.", "LaserBench safe mode", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (_recorder is null)
        {
            MessageBox.Show(this, $"Recording is unavailable. See {StartupDiagnostics.CrashLogPath} if initialization failed.", "LaserBench", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        try
        {
            if (_recorder.IsRecording)
            {
                _recorder.Stop();
                _topBar.SetRecording(false);
            }
            else
            {
                _recorder.Start(_config.ConfirmedLabel);
                _topBar.SetRecording(true);
            }
        }
        catch (Exception ex)
        {
            StartupDiagnostics.Crash("recording", ex);
            _topBar.SetRecording(false);
            MessageBox.Show(this, ex.Message, "Recording failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}
