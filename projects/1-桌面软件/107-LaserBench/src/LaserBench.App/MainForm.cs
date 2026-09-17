using System.Diagnostics;
using System.Drawing.Imaging;

namespace LaserBench;

internal sealed class MainForm : Form
{
    private readonly AppConfig _config;
    private readonly IInstrumentProvider _provider;
    private readonly CaptureService _captureService;
    private readonly TopBarControl _topBar;
    private readonly SidebarControl _sidebar;
    private readonly Panel _contentHost = new() { Dock = DockStyle.Fill, BackColor = UiTheme.PlotBack };
    private readonly DashboardControl _dashboard;
    private readonly ScreenRecorder _recorder;
    private CancellationTokenSource? _captureCancellation;
    private string _currentPage = "dashboard";

    public MainForm()
    {
        Text = "LaserBench";
        BackColor = UiTheme.Back;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(1100, 700);
        Size = new Size(1500, 900);
        WindowState = FormWindowState.Maximized;
        AutoScaleMode = AutoScaleMode.Dpi;
        KeyPreview = true;

        _config = AppConfigStore.Load();
        _provider = new SimulatorProvider();
        _captureService = new CaptureService(_provider);
        _topBar = new TopBarControl(_config, _provider) { Dock = DockStyle.Top, Height = 34 };
        _sidebar = new SidebarControl(_config) { Dock = DockStyle.Left };
        _dashboard = new DashboardControl(_provider, _config) { Dock = DockStyle.Fill };
        _recorder = new ScreenRecorder(this);

        var body = new Panel { Dock = DockStyle.Fill, BackColor = UiTheme.PlotBack };
        body.Controls.Add(_contentHost);
        body.Controls.Add(_sidebar);
        Controls.Add(body);
        Controls.Add(_topBar);

        _dashboard.OpenModuleRequested += OpenModule;
        _topBar.CaptureClicked += async (_, _) => await ToggleCaptureAsync();
        _topBar.ScreenshotClicked += (_, _) => SaveScreenshot();
        _topBar.RecordClicked += (_, _) => ToggleRecording();
        _topBar.LabelConfirmed += _ => AppConfigStore.Save(_config);
        _topBar.CaptureSelectionChanged += (_, _) => AppConfigStore.Save(_config);
        _sidebar.NavigateRequested += Navigate;
        _sidebar.ExpandedChanged += _ => PerformLayout();

        ShowDashboard();
        FormClosing += (_, _) =>
        {
            try { if (_recorder.IsRecording) _recorder.Stop(); } catch { }
            AppConfigStore.Save(_config);
        };
    }

    private void Navigate(string key)
    {
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
        _currentPage = "dashboard";
        _sidebar.SetActive("dashboard");
        ShowContent(_dashboard);
    }

    private void OpenModule(ModuleKind kind)
    {
        _currentPage = kind.ToString().ToLowerInvariant();
        _sidebar.SetActive(_currentPage);
        var page = new ModulePageControl(kind, _dashboard, _config) { Dock = DockStyle.Fill };
        ShowContent(page, disposePrevious: true);
    }

    private void ShowData()
    {
        _currentPage = "data";
        _sidebar.SetActive("data");
        ShowContent(new DataPageControl(_config) { Dock = DockStyle.Fill }, disposePrevious: true);
    }

    private void ShowSettings()
    {
        _currentPage = "settings";
        _sidebar.SetActive("settings");
        var page = new SettingsPageControl(_config) { Dock = DockStyle.Fill };
        page.AliasesChanged += (_, _) =>
        {
            _topBar.RefreshAliases();
            _dashboard.Invalidate(true);
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
            MessageBox.Show(this, ex.Message, "Screenshot failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void ToggleRecording()
    {
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
            _topBar.SetRecording(false);
            MessageBox.Show(this, ex.Message, "Recording failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}
