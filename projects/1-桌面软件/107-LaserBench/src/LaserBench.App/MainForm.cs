namespace LaserBench;

internal sealed class MainForm : Form
{
    private readonly bool _safeMode;
    private readonly Panel _bootPanel = new() { Dock = DockStyle.Fill, BackColor = Color.FromArgb(239, 246, 251) };
    private readonly Label _bootLabel = new()
    {
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleCenter,
        Font = new Font("Segoe UI", 11f, FontStyle.Regular),
        ForeColor = Color.FromArgb(35, 61, 83),
        Text = "LaserBench\r\n正在初始化工作区..."
    };

    private AppConfig? _config;
    private IInstrumentProvider? _provider;
    private CaptureService? _captureService;
    private ScreenRecorder? _recorder;
    private WebUiHost? _webUi;
    private CancellationTokenSource? _captureCancellation;
    private bool _workspaceReady;
    private string _captureState = "idle";
    private string _lastCaptureMessage = "尚未执行采集";
    private DateTime? _lastCaptureAt;

    internal string CaptureState => _captureState;
    internal string LastCaptureMessage => _lastCaptureMessage;
    internal DateTime? LastCaptureAt => _lastCaptureAt;
    internal bool IsCapturing => _captureCancellation is not null;
    internal bool IsRecording => _recorder?.IsRecording == true;

    public MainForm(bool safeMode = false)
    {
        _safeMode = safeMode;
        Text = safeMode ? "LaserBench [安全模式]" : "LaserBench";
        BackColor = Color.FromArgb(239, 246, 251);
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
            try { _captureCancellation?.Cancel(); } catch { }
            try { if (_recorder?.IsRecording == true) _recorder.Stop(); } catch (Exception ex) { StartupDiagnostics.Crash("recorder shutdown", ex); }
            try { if (_provider is IDisposable disposableProvider) disposableProvider.Dispose(); } catch (Exception ex) { StartupDiagnostics.Crash("instrument provider shutdown", ex); }
            try { if (_config is not null) AppConfigStore.Save(_config); } catch (Exception ex) { StartupDiagnostics.Crash("config save on close", ex); }
            try { _webUi?.Dispose(); } catch (Exception ex) { StartupDiagnostics.Crash("webui shutdown", ex); }
        };
    }

    private void InitializeWorkspace()
    {
        if (_workspaceReady || _webUi is not null) return;
        try
        {
            SetBootText("LaserBench\r\n正在读取配置...");
            StartupDiagnostics.Stage("config-load", "begin");
            _config = AppConfigStore.Load();
            StartupDiagnostics.Stage("config-load");

            SetBootText("LaserBench\r\n正在建立仪器接口控制层...");
            var providerSelection = InstrumentProviderFactory.Create(_config);
            StartupDiagnostics.Stage("instrument-interfaces", string.Join("; ", providerSelection.Interfaces.Select(x => $"{x.Kind}:{x.State}:{x.Endpoint}")));

            SetBootText("LaserBench\r\n正在启动混合仪器数据平面...");
            StartupDiagnostics.Stage("instrument-dataplane", "begin");
            _provider = providerSelection.Provider;
            _captureService = new CaptureService(_provider);
            var probe = _provider.Snapshot(_config);
            StartupDiagnostics.Stage("instrument-dataplane", $"source={providerSelection.DataSource}; power={probe.Power.Count}; spectrum={probe.Spectrum.Count}; beam={probe.Beam.Count}");

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
            else StartupDiagnostics.Stage("recorder", "skipped in safe mode");

            SetBootText("LaserBench\r\n正在加载 WebView2 + Vue 界面...");
            StartupDiagnostics.Stage("webui", "begin");
            Controls.Clear();
            _webUi = WebUiHost.Attach(this, _config, _provider);
            _recorder?.SetPreviewSource(_webUi.CaptureRecordingPreviewAsync);
            _webUi.Ready += () =>
            {
                _workspaceReady = true;
                StartupDiagnostics.Stage("workspace-ready", _safeMode ? "safe mode; webui" : "normal mode; webui");
            };
            _webUi.Failed += ex => StartupDiagnostics.Crash("webui host failed", ex);
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
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Color.FromArgb(243, 247, 250), Padding = new Padding(36) };
        var title = new Label
        {
            AutoSize = false,
            Dock = DockStyle.Top,
            Height = 44,
            Font = new Font("Segoe UI Semibold", 15f, FontStyle.Bold),
            ForeColor = Color.FromArgb(38, 55, 70),
            Text = "LaserBench 已启动，但工作区初始化失败。"
        };
        var details = new TextBox
        {
            Dock = DockStyle.Fill,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            BorderStyle = BorderStyle.FixedSingle,
            Font = new Font("Consolas", 9f),
            Text = $"{exception}\r\n\r\n诊断日志：\r\n{StartupDiagnostics.CrashLogPath}\r\n\r\n可在 PowerShell 中尝试安全模式：\r\n.\\LaserBench.App.exe --safe"
        };
        panel.Controls.Add(details);
        panel.Controls.Add(title);
        SuspendLayout();
        Controls.Clear();
        Controls.Add(panel);
        ResumeLayout(true);
        Text = "LaserBench [启动诊断]";
    }

    internal async Task<object> ToggleCaptureFromWebAsync()
    {
        if (_captureService is null || _config is null)
            throw new InvalidOperationException("采集服务尚未就绪。");

        if (_captureCancellation is not null)
        {
            _captureState = "stopping";
            _captureCancellation.Cancel();
            _webUi?.PushNow();
            return new { message = "正在停止采集。" };
        }

        var frozen = CloneConfig(_config);
        _captureState = "starting";
        _captureCancellation = new CancellationTokenSource();
        _webUi?.PushNow();
        try
        {
            _captureState = "running";
            _webUi?.PushNow();
            var result = await _captureService.CaptureAsync(frozen, _captureCancellation.Token);
            if (!result.Cancelled && frozen.AutoScreenshot)
                await SaveScreenshotFromWebAsync(result.RequestedAt, frozen.ConfirmedLabel);
            if (result.Errors.Count > 0)
                throw new InvalidOperationException(string.Join(Environment.NewLine, result.Errors));
            _lastCaptureAt = DateTime.Now;
            _lastCaptureMessage = result.Cancelled ? "采集已停止" : $"采集完成，共保存 {result.Files.Count} 个文件";
            return new { message = _lastCaptureMessage };
        }
        catch (OperationCanceledException)
        {
            _lastCaptureAt = DateTime.Now;
            _lastCaptureMessage = "采集已停止";
            return new { message = _lastCaptureMessage };
        }
        finally
        {
            _captureCancellation.Dispose();
            _captureCancellation = null;
            _captureState = "idle";
            _webUi?.PushNow();
        }
    }

    internal Task<object> SaveScreenshotFromWebAsync()
        => SaveScreenshotFromWebAsync(DateTime.Now, _config?.ConfirmedLabel ?? string.Empty);

    private async Task<object> SaveScreenshotFromWebAsync(DateTime timestamp, string label)
    {
        if (_webUi is null) throw new InvalidOperationException("Web UI 尚未就绪。");
        Directory.CreateDirectory(AppPaths.PicDir);
        var partial = Path.Combine(AppPaths.PicDir, $".{Guid.NewGuid():N}.png.partial");
        try
        {
            await using (var stream = new FileStream(partial, FileMode.Create, FileAccess.Write, FileShare.None))
                await _webUi.CapturePreviewAsync(stream);
            var baseName = SafeFile.ComposeBaseName(timestamp, "dashboard", label);
            var file = SafeFile.MovePartialToUnique(partial, AppPaths.PicDir, baseName, ".png");
            return new { message = "截图已保存。", file = Path.GetFileName(file) };
        }
        catch
        {
            try { if (File.Exists(partial)) File.Delete(partial); } catch { }
            throw;
        }
    }

    internal object ToggleRecordingFromWeb()
    {
        if (_config is null) throw new InvalidOperationException("配置尚未就绪。");
        if (_safeMode) throw new InvalidOperationException("安全模式下已禁用窗口录像。");
        if (_recorder is null) throw new InvalidOperationException("窗口录像当前不可用，请查看启动日志。");

        if (_recorder.IsRecording) _recorder.Stop();
        else _recorder.Start(_config.ConfirmedLabel);
        _webUi?.PushNow();
        return new { recording = _recorder.IsRecording };
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
        Scope2Alias = source.Scope2Alias,
        PowerWindow = source.PowerWindow,
        OsaStart = source.OsaStart,
        OsaStop = source.OsaStop,
        ScopeTimeSpan = source.ScopeTimeSpan,
        ScopeFftMax = source.ScopeFftMax,
        ScopeCh1 = source.ScopeCh1,
        ScopeCh2 = source.ScopeCh2,
        DashboardPower1 = source.DashboardPower1,
        DashboardPower2 = source.DashboardPower2,
        DashboardMath1 = source.DashboardMath1,
        PowerActiveTrace = source.PowerActiveTrace,
        PowerAverageSamples = source.PowerAverageSamples,
        PowerOffset = source.PowerOffset,
        PowerScale = source.PowerScale,
        PowerNormalize = source.PowerNormalize,
        PowerNormalizeValue = source.PowerNormalizeValue,
        PowerDensity = source.PowerDensity,
        PowerAreaCm2 = source.PowerAreaCm2,
        PowerPassFail = source.PowerPassFail,
        PowerLow = source.PowerLow,
        PowerHigh = source.PowerHigh,
        OsaResolution = source.OsaResolution,
        OsaSensitivity = source.OsaSensitivity,
        OsaAverage = source.OsaAverage,
        OsaRefLevel = source.OsaRefLevel,
        OsaDbPerDiv = source.OsaDbPerDiv,
        OsaShowRef = source.OsaShowRef,
        OsaSweepMode = source.OsaSweepMode,
        OsaMarkerPeak = source.OsaMarkerPeak,
        OsaSamplePoints = source.OsaSamplePoints,
        OsaVideoBandwidthHz = source.OsaVideoBandwidthHz,
        OsaTraceMode = source.OsaTraceMode,
        OsaSmoothingPoints = source.OsaSmoothingPoints,
        OsaWavelengthOffsetNm = source.OsaWavelengthOffsetNm,
        OsaWavelengthReference = source.OsaWavelengthReference,
        OsaAutoPeakSearch = source.OsaAutoPeakSearch,
        OsaPeakThresholdDb = source.OsaPeakThresholdDb,
        BeamRunMode = source.BeamRunMode,
        BeamWidthMethod = source.BeamWidthMethod,
        BeamAutoOutlier = source.BeamAutoOutlier,
        BeamShowX = source.BeamShowX,
        BeamShowY = source.BeamShowY,
        ScopeVoltsDiv = source.ScopeVoltsDiv,
        ScopeOffset = source.ScopeOffset,
        ScopeCoupling = source.ScopeCoupling,
        ScopeTriggerSource = source.ScopeTriggerSource,
        ScopeTriggerLevel = source.ScopeTriggerLevel,
        ScopeTriggerSlope = source.ScopeTriggerSlope,
        ScopeAcquisition = source.ScopeAcquisition,
        ScopeAverage = source.ScopeAverage,
        PowerInterfaceEnabled = source.PowerInterfaceEnabled,
        PowerInterfaceEndpoint = source.PowerInterfaceEndpoint,
        SpectrumInterfaceEnabled = source.SpectrumInterfaceEnabled,
        SpectrumInterfaceEndpoint = source.SpectrumInterfaceEndpoint,
        BeamInterfaceEnabled = source.BeamInterfaceEnabled,
        BeamInterfaceEndpoint = source.BeamInterfaceEndpoint,
        ScopeInterfaceEnabled = source.ScopeInterfaceEnabled,
        ScopeInterfaceEndpoint = source.ScopeInterfaceEndpoint
    };
}
