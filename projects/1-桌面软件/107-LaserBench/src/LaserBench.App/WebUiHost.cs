using System.Reflection;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LaserBench;

internal static class WebUiAssets
{
    private const string Prefix = "LaserBench.WebUi.";

    internal static string Extract()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var names = assembly.GetManifestResourceNames();
        if (!names.Contains(Prefix + "index.html", StringComparer.Ordinal))
            throw new InvalidOperationException("LaserBench Web UI index.html is missing. Build WebUi before publishing the desktop host.");
        if (!names.Any(name => name.StartsWith(Prefix + "assets.", StringComparison.Ordinal)))
            throw new InvalidOperationException("LaserBench Web UI assets are missing. Build WebUi before publishing the desktop host.");

        var version = assembly.GetName().Version?.ToString(3) ?? "0.0.0";
        var root = Path.Combine(AppPaths.RuntimeDir, "WebUi", version);
        Directory.CreateDirectory(root);
        Directory.CreateDirectory(Path.Combine(root, "assets"));

        foreach (var resource in names.Where(name => name.StartsWith(Prefix, StringComparison.Ordinal)))
        {
            string relative;
            if (resource == Prefix + "index.html") relative = "index.html";
            else if (resource.StartsWith(Prefix + "assets.", StringComparison.Ordinal))
                relative = Path.Combine("assets", resource[(Prefix + "assets.").Length..]);
            else continue;

            var destination = Path.Combine(root, relative);
            using var input = assembly.GetManifestResourceStream(resource)
                ?? throw new InvalidOperationException($"Missing embedded UI resource: {resource}");
            using var output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.Read);
            input.CopyTo(output);
        }
        return root;
    }
}

internal sealed class WebUiHost : IDisposable
{
    private const string Origin = "https://laserbench.local";
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
    private static readonly HashSet<string> AllowedMethods = new(StringComparer.Ordinal)
    {
        "app.getSnapshot",
        "app.setLabel",
        "app.setCaptureSelection",
        "app.capture",
        "app.screenshot",
        "app.record",
        "app.setConfig",
        "app.refreshData",
        "app.openFolder",
        "app.pickExperimentFolder",
        "app.probeInterfaces",
        "beam.setZ",
        "beam.setAttenuation"
    };

    private readonly MainForm _form;
    private readonly AppConfig _config;
    private readonly IInstrumentProvider _provider;
    private readonly Panel _surface = new() { Dock = DockStyle.Fill, BackColor = Color.FromArgb(239, 246, 251) };
    private readonly Label _loading = new()
    {
        Dock = DockStyle.Fill,
        Text = "LaserBench\r\n正在加载新界面…",
        TextAlign = ContentAlignment.MiddleCenter,
        ForeColor = Color.FromArgb(86, 111, 132),
        Font = new Font("Segoe UI", 10.5f)
    };
    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill, BackColor = Color.White, Visible = false };
    private readonly System.Windows.Forms.Timer _pushTimer = new() { Interval = 250 };
    private bool _ready;
    private bool _disposed;

    public event Action? Ready;
    public event Action<Exception>? Failed;

    private WebUiHost(MainForm form, AppConfig config, IInstrumentProvider provider)
    {
        _form = form;
        _config = config;
        _provider = provider;
        _surface.Controls.Add(_loading);
        _surface.Controls.Add(_webView);
        _form.Controls.Add(_surface);
        _surface.BringToFront();
        _pushTimer.Tick += (_, _) => PushSnapshot();
        _ = InitializeAsync();
    }

    internal static WebUiHost Attach(MainForm form, AppConfig config, IInstrumentProvider provider)
        => new(form, config, provider);

    internal WebView2 View => _webView;

    internal void PushNow() => PushSnapshot();

    internal async Task CapturePreviewAsync(Stream stream)
    {
        if (!_ready || _webView.CoreWebView2 is null)
            throw new InvalidOperationException("Web UI is not ready for capture.");
        await _webView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
    }

    internal async Task CaptureRecordingPreviewAsync(Stream stream)
    {
        if (!_ready || _webView.CoreWebView2 is null)
            throw new InvalidOperationException("Web UI is not ready for recording capture.");
        await _webView.CoreWebView2.ExecuteScriptAsync("document.documentElement.classList.add('record-capture')");
        try
        {
            await _webView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
        }
        finally
        {
            try { await _webView.CoreWebView2.ExecuteScriptAsync("document.documentElement.classList.remove('record-capture')"); } catch { }
        }
    }

    private async Task InitializeAsync()
    {
        try
        {
            StartupDiagnostics.Stage("webui-assets", "begin");
            var assetsRoot = WebUiAssets.Extract();
            StartupDiagnostics.Stage("webui-assets", assetsRoot);

            var userData = Path.Combine(AppPaths.RuntimeDir, "WebView2");
            Directory.CreateDirectory(userData);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
            await _webView.EnsureCoreWebView2Async(environment);
            var core = _webView.CoreWebView2 ?? throw new InvalidOperationException("WebView2 initialization returned no CoreWebView2 instance.");

            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsWebMessageEnabled = true;
            core.SetVirtualHostNameToFolderMapping("laserbench.local", assetsRoot, CoreWebView2HostResourceAccessKind.DenyCors);
            core.WebMessageReceived += OnWebMessageReceived;
            core.NavigationStarting += (_, args) =>
            {
                if (!args.Uri.StartsWith(Origin + "/", StringComparison.OrdinalIgnoreCase)) args.Cancel = true;
            };
            core.NewWindowRequested += (_, args) => args.Handled = true;
            core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
            core.NavigationCompleted += async (_, args) =>
            {
                if (!args.IsSuccess) return;
                try
                {
                    var vectorsMounted = false;
                    for (var attempt = 0; attempt < 40; attempt++)
                    {
                        var state = await core.ExecuteScriptAsync("document.documentElement.dataset.acqVectors || ''");
                        if (state.Contains("mounted", StringComparison.OrdinalIgnoreCase))
                        {
                            vectorsMounted = true;
                            break;
                        }
                        await Task.Delay(100);
                    }
                    if (!vectorsMounted)
                        throw new TimeoutException("WebView2 acquisition vector icons did not mount.");

                    var structure = await core.ExecuteScriptAsync(
                        "(()=>{const all=document.querySelectorAll('.topbar .module-toggle svg.acq-vector');" +
                        "const active=document.querySelector('.topbar .module-toggle.active');" +
                        "if(all.length!==4)return false;if(!active)return true;" +
                        "return [active,...active.querySelectorAll('*')].some(n=>typeof n.getAnimations==='function'&&n.getAnimations().length>0)})()");
                    if (!string.Equals(structure, "true", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("WebView2 acquisition vector structure/animation is incomplete.");

                    var rendered = await core.ExecuteScriptAsync(
                        "(()=>{const active=document.querySelector('.topbar .module-toggle.active');if(!active)return true;" +
                        "const target=[active,...active.querySelectorAll('*')].find(n=>typeof n.getAnimations==='function'&&n.getAnimations().length>0);" +
                        "if(!target)return false;const a=target.getAnimations()[0];if(!a)return false;" +
                        "const wasPaused=a.playState==='paused';a.pause();a.currentTime=600;" +
                        "const s1=getComputedStyle(target);const v1=s1.transform+'|'+s1.opacity;" +
                        "a.currentTime=2600;const s2=getComputedStyle(target);const v2=s2.transform+'|'+s2.opacity;" +
                        "if(!wasPaused)a.play();return v1!==v2})()");
                    if (!string.Equals(rendered, "true", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("WebView2 acquisition vector CSS animation does not produce distinct rendered states.");

                    StartupDiagnostics.Stage("webui-acq-vectors", "verified");
                    _ready = true;
                    _loading.Visible = false;
                    _webView.Visible = true;
                    _webView.BringToFront();
                    _pushTimer.Start();
                    StartupDiagnostics.Stage("webui-ready");
                    PushSnapshot();
                    Ready?.Invoke();
                }
                catch (Exception ex)
                {
                    StartupDiagnostics.Crash("webui acquisition vector verification", ex);
                    _loading.Text = "LaserBench 新界面资源校验失败\r\n\r\n" + ex.Message;
                    _loading.ForeColor = Color.FromArgb(151, 67, 62);
                    Failed?.Invoke(ex);
                }
            };
            core.Navigate(Origin + "/index.html");
        }
        catch (Exception ex)
        {
            StartupDiagnostics.Crash("webui initialization", ex);
            _loading.Text = "LaserBench 新界面无法启动\r\n\r\n" + ex.Message + "\r\n\r\n请确认 Microsoft Edge WebView2 Runtime 已安装。";
            _loading.ForeColor = Color.FromArgb(151, 67, 62);
            Failed?.Invoke(ex);
        }
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        BridgeRequest? request = null;
        try
        {
            request = JsonSerializer.Deserialize<BridgeRequest>(args.WebMessageAsJson, JsonOptions);
            if (request is null || string.IsNullOrWhiteSpace(request.Id) || !AllowedMethods.Contains(request.Method ?? string.Empty))
                throw new InvalidOperationException("不允许的界面命令。");

            object? result = request.Method switch
            {
                "app.getSnapshot" => BuildSnapshot(),
                "app.setLabel" => SetLabel(request.Params),
                "app.setCaptureSelection" => SetCaptureSelection(request.Params),
                "app.capture" => await _form.ToggleCaptureFromWebAsync(),
                "app.screenshot" => await _form.SaveScreenshotFromWebAsync(),
                "app.record" => _form.ToggleRecordingFromWeb(),
                "app.setConfig" => SetConfig(request.Params),
                "app.refreshData" => BuildSnapshot(),
                "app.openFolder" => OpenFolder(request.Params),
                "app.pickExperimentFolder" => PickExperimentFolder(),
                "app.probeInterfaces" => ProbeInterfaces(request.Params),
                "beam.setZ" => SetBeamZ(request.Params),
                "beam.setAttenuation" => SetBeamAttenuation(request.Params),
                _ => throw new InvalidOperationException("不允许的界面命令。")
            };
            Reply(request.Id, true, result, null);
            PushSnapshot();
        }
        catch (Exception ex)
        {
            Reply(request?.Id ?? string.Empty, false, null, ex.Message);
        }
    }

    private object SetLabel(JsonElement? value)
    {
        _config.ConfirmedLabel = ReadString(value, "label").Trim();
        AppConfigStore.Save(_config);
        return new { snapshot = BuildSnapshot() };
    }

    private object SetCaptureSelection(JsonElement? value)
    {
        var module = ReadString(value, "module");
        var selected = ReadBool(value, "selected");
        switch (module)
        {
            case "power": _config.CapturePower = selected; break;
            case "spectrum": _config.CaptureSpectrum = selected; break;
            case "beam": _config.CaptureBeam = selected; break;
            case "scope": _config.CaptureScope = selected; break;
            default: throw new InvalidOperationException("未知采集模块。");
        }
        AppConfigStore.Save(_config);
        return new { snapshot = BuildSnapshot() };
    }

    private object SetConfig(JsonElement? value)
    {
        if (!value.HasValue || value.Value.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("设置参数无效。");
        var v=value.Value;
        if (v.TryGetProperty("experimentFolder",out var folder) && folder.ValueKind==JsonValueKind.String)
            _config.CurrentExperimentFolder=(folder.GetString()??string.Empty).Trim();
        if (v.TryGetProperty("autoScreenshot",out var auto) && (auto.ValueKind==JsonValueKind.True || auto.ValueKind==JsonValueKind.False))
            _config.AutoScreenshot=auto.GetBoolean();
        if (v.TryGetProperty("powerWindow",out var pw) && pw.ValueKind==JsonValueKind.Number) _config.PowerWindow=Math.Clamp(pw.GetDouble(),30,3600);
        if (v.TryGetProperty("osaStart",out var os) && os.ValueKind==JsonValueKind.Number) _config.OsaStart=Math.Clamp(os.GetDouble(),600,1700);
        if (v.TryGetProperty("osaStop",out var oe) && oe.ValueKind==JsonValueKind.Number) _config.OsaStop=Math.Clamp(oe.GetDouble(),600,1700);
        if (_config.OsaStop<=_config.OsaStart) _config.OsaStop=_config.OsaStart+1;
        if (v.TryGetProperty("scopeTimeSpan",out var st) && st.ValueKind==JsonValueKind.Number) _config.ScopeTimeSpan=Math.Clamp(st.GetDouble(),0.01,1000);
        if (v.TryGetProperty("scopeFftMax",out var sf) && sf.ValueKind==JsonValueKind.Number) _config.ScopeFftMax=Math.Clamp(sf.GetDouble(),0.1,500);
        if (v.TryGetProperty("scopeCh1",out var c1) && (c1.ValueKind==JsonValueKind.True||c1.ValueKind==JsonValueKind.False)) _config.ScopeCh1=c1.GetBoolean();
        if (v.TryGetProperty("scopeCh2",out var c2) && (c2.ValueKind==JsonValueKind.True||c2.ValueKind==JsonValueKind.False)) _config.ScopeCh2=c2.GetBoolean();
        if (v.TryGetProperty("dashboardPower1",out var dp1) && (dp1.ValueKind==JsonValueKind.True||dp1.ValueKind==JsonValueKind.False)) _config.DashboardPower1=dp1.GetBoolean();
        if (v.TryGetProperty("dashboardPower2",out var dp2) && (dp2.ValueKind==JsonValueKind.True||dp2.ValueKind==JsonValueKind.False)) _config.DashboardPower2=dp2.GetBoolean();
        if (v.TryGetProperty("dashboardMath1",out var dm1) && (dm1.ValueKind==JsonValueKind.True||dm1.ValueKind==JsonValueKind.False)) _config.DashboardMath1=dm1.GetBoolean();

        if (v.TryGetProperty("powerActiveTrace",out var pat) && pat.ValueKind==JsonValueKind.Number) _config.PowerActiveTrace=Math.Clamp(pat.GetInt32(),0,2);
        if (v.TryGetProperty("powerAverageSamples",out var pas) && pas.ValueKind==JsonValueKind.Number) _config.PowerAverageSamples=Math.Clamp(pas.GetInt32(),1,200);
        if (v.TryGetProperty("powerOffset",out var po) && po.ValueKind==JsonValueKind.Number) _config.PowerOffset=Math.Clamp(po.GetDouble(),-1e9,1e9);
        if (v.TryGetProperty("powerScale",out var ps) && ps.ValueKind==JsonValueKind.Number) _config.PowerScale=Math.Clamp(ps.GetDouble(),-1e6,1e6);
        if (v.TryGetProperty("powerNormalize",out var pn) && (pn.ValueKind==JsonValueKind.True||pn.ValueKind==JsonValueKind.False)) _config.PowerNormalize=pn.GetBoolean();
        if (v.TryGetProperty("powerNormalizeValue",out var pnv) && pnv.ValueKind==JsonValueKind.Number) _config.PowerNormalizeValue=Math.Clamp(Math.Abs(pnv.GetDouble()),1e-12,1e12);
        if (v.TryGetProperty("powerDensity",out var pd) && (pd.ValueKind==JsonValueKind.True||pd.ValueKind==JsonValueKind.False)) _config.PowerDensity=pd.GetBoolean();
        if (v.TryGetProperty("powerAreaCm2",out var pa) && pa.ValueKind==JsonValueKind.Number) _config.PowerAreaCm2=Math.Clamp(Math.Abs(pa.GetDouble()),1e-9,1e9);
        if (v.TryGetProperty("powerPassFail",out var ppf) && (ppf.ValueKind==JsonValueKind.True||ppf.ValueKind==JsonValueKind.False)) _config.PowerPassFail=ppf.GetBoolean();
        if (v.TryGetProperty("powerLow",out var pl) && pl.ValueKind==JsonValueKind.Number) _config.PowerLow=Math.Clamp(pl.GetDouble(),-1e9,1e9);
        if (v.TryGetProperty("powerHigh",out var ph) && ph.ValueKind==JsonValueKind.Number) _config.PowerHigh=Math.Clamp(ph.GetDouble(),-1e9,1e9);
        if (v.TryGetProperty("power1DisplayUnit",out var p1du) && p1du.ValueKind==JsonValueKind.String) _config.Power1DisplayUnit=NormalizePowerUnit(p1du.GetString());
        if (v.TryGetProperty("power2DisplayUnit",out var p2du) && p2du.ValueKind==JsonValueKind.String) _config.Power2DisplayUnit=NormalizePowerUnit(p2du.GetString());
        if (v.TryGetProperty("math1DisplayUnit",out var m1du) && m1du.ValueKind==JsonValueKind.String) _config.Math1DisplayUnit=NormalizeCustomUnit(m1du.GetString());
        if (v.TryGetProperty("power1AxisMin",out var p1amin) && p1amin.ValueKind==JsonValueKind.Number) _config.Power1AxisMin=Math.Clamp(p1amin.GetDouble(),-1e12,1e12);
        if (v.TryGetProperty("power1AxisMax",out var p1amax) && p1amax.ValueKind==JsonValueKind.Number) _config.Power1AxisMax=Math.Clamp(p1amax.GetDouble(),-1e12,1e12);
        if (v.TryGetProperty("power2AxisMin",out var p2amin) && p2amin.ValueKind==JsonValueKind.Number) _config.Power2AxisMin=Math.Clamp(p2amin.GetDouble(),-1e12,1e12);
        if (v.TryGetProperty("power2AxisMax",out var p2amax) && p2amax.ValueKind==JsonValueKind.Number) _config.Power2AxisMax=Math.Clamp(p2amax.GetDouble(),-1e12,1e12);
        if (v.TryGetProperty("math1AxisMin",out var m1amin) && m1amin.ValueKind==JsonValueKind.Number) _config.Math1AxisMin=Math.Clamp(m1amin.GetDouble(),-1e12,1e12);
        if (v.TryGetProperty("math1AxisMax",out var m1amax) && m1amax.ValueKind==JsonValueKind.Number) _config.Math1AxisMax=Math.Clamp(m1amax.GetDouble(),-1e12,1e12);

        if (v.TryGetProperty("osaResolution",out var ores) && ores.ValueKind==JsonValueKind.Number) _config.OsaResolution=Math.Clamp(ores.GetDouble(),0.001,10);
        if (v.TryGetProperty("osaSensitivity",out var osen) && osen.ValueKind==JsonValueKind.String) _config.OsaSensitivity=(osen.GetString()??"MID").Trim().ToUpperInvariant();
        if (v.TryGetProperty("osaAverage",out var oa) && oa.ValueKind==JsonValueKind.Number) _config.OsaAverage=Math.Clamp(oa.GetInt32(),1,999);
        if (v.TryGetProperty("osaRefLevel",out var orl) && orl.ValueKind==JsonValueKind.Number) _config.OsaRefLevel=Math.Clamp(orl.GetDouble(),-90,30);
        if (v.TryGetProperty("osaDbPerDiv",out var odb) && odb.ValueKind==JsonValueKind.Number) _config.OsaDbPerDiv=Math.Clamp(odb.GetDouble(),0.1,10);
        if (v.TryGetProperty("osaShowRef",out var osr) && (osr.ValueKind==JsonValueKind.True||osr.ValueKind==JsonValueKind.False)) _config.OsaShowRef=osr.GetBoolean();
        if (v.TryGetProperty("osaSweepMode",out var osm) && osm.ValueKind==JsonValueKind.String) _config.OsaSweepMode=(osm.GetString()??"REPEAT").Trim().ToUpperInvariant();
        if (v.TryGetProperty("osaMarkerPeak",out var omp) && (omp.ValueKind==JsonValueKind.True||omp.ValueKind==JsonValueKind.False)) _config.OsaMarkerPeak=omp.GetBoolean();
        if (v.TryGetProperty("osaSamplePoints",out var osp) && osp.ValueKind==JsonValueKind.Number) _config.OsaSamplePoints=Math.Clamp(osp.GetInt32(),101,10001);
        if (v.TryGetProperty("osaVideoBandwidthHz",out var ovb) && ovb.ValueKind==JsonValueKind.Number) _config.OsaVideoBandwidthHz=Math.Clamp(ovb.GetDouble(),1,1_000_000);
        if (v.TryGetProperty("osaTraceMode",out var otm) && otm.ValueKind==JsonValueKind.String) _config.OsaTraceMode=(otm.GetString()??"WRITE").Trim().ToUpperInvariant();
        if (v.TryGetProperty("osaSmoothingPoints",out var osmp) && osmp.ValueKind==JsonValueKind.Number) _config.OsaSmoothingPoints=Math.Clamp(osmp.GetInt32(),1,101);
        if (v.TryGetProperty("osaWavelengthOffsetNm",out var owo) && owo.ValueKind==JsonValueKind.Number) _config.OsaWavelengthOffsetNm=Math.Clamp(owo.GetDouble(),-100,100);
        if (v.TryGetProperty("osaWavelengthReference",out var owr) && owr.ValueKind==JsonValueKind.String) _config.OsaWavelengthReference=(owr.GetString()??"AIR").Trim().ToUpperInvariant();
        if (v.TryGetProperty("osaAutoPeakSearch",out var oap) && (oap.ValueKind==JsonValueKind.True||oap.ValueKind==JsonValueKind.False)) _config.OsaAutoPeakSearch=oap.GetBoolean();
        if (v.TryGetProperty("osaPeakThresholdDb",out var opt) && opt.ValueKind==JsonValueKind.Number) _config.OsaPeakThresholdDb=Math.Clamp(opt.GetDouble(),0,100);

        if (v.TryGetProperty("beamRunMode",out var brm) && brm.ValueKind==JsonValueKind.String) _config.BeamRunMode=(brm.GetString()??"AUTO").Trim().ToUpperInvariant();
        if (v.TryGetProperty("beamWidthMethod",out var bwm) && bwm.ValueKind==JsonValueKind.String) _config.BeamWidthMethod=(bwm.GetString()??"D4SIGMA").Trim().ToUpperInvariant();
        if (v.TryGetProperty("beamAutoOutlier",out var bao) && (bao.ValueKind==JsonValueKind.True||bao.ValueKind==JsonValueKind.False)) _config.BeamAutoOutlier=bao.GetBoolean();
        if (v.TryGetProperty("beamShowX",out var bsx) && (bsx.ValueKind==JsonValueKind.True||bsx.ValueKind==JsonValueKind.False)) _config.BeamShowX=bsx.GetBoolean();
        if (v.TryGetProperty("beamShowY",out var bsy) && (bsy.ValueKind==JsonValueKind.True||bsy.ValueKind==JsonValueKind.False)) _config.BeamShowY=bsy.GetBoolean();

        if (v.TryGetProperty("scopeVoltsDiv",out var svd) && svd.ValueKind==JsonValueKind.Number) _config.ScopeVoltsDiv=Math.Clamp(Math.Abs(svd.GetDouble()),0.001,1000);
        if (v.TryGetProperty("scopeOffset",out var so) && so.ValueKind==JsonValueKind.Number) _config.ScopeOffset=Math.Clamp(so.GetDouble(),-1000,1000);
        if (v.TryGetProperty("scopeCoupling",out var scp) && scp.ValueKind==JsonValueKind.String) _config.ScopeCoupling=NormalizeScopeCoupling(scp.GetString());
        if (v.TryGetProperty("scopeActiveChannel",out var sacn) && sacn.ValueKind==JsonValueKind.Number) _config.ScopeActiveChannel=Math.Clamp(sacn.GetInt32(),1,2);
        if (v.TryGetProperty("scopeCh1VoltsDiv",out var sc1v) && sc1v.ValueKind==JsonValueKind.Number) _config.ScopeCh1VoltsDiv=Math.Clamp(Math.Abs(sc1v.GetDouble()),0.001,1000);
        if (v.TryGetProperty("scopeCh1Offset",out var sc1o) && sc1o.ValueKind==JsonValueKind.Number) _config.ScopeCh1Offset=Math.Clamp(sc1o.GetDouble(),-1000,1000);
        if (v.TryGetProperty("scopeCh1Coupling",out var sc1c) && sc1c.ValueKind==JsonValueKind.String) _config.ScopeCh1Coupling=NormalizeScopeCoupling(sc1c.GetString());
        if (v.TryGetProperty("scopeCh2VoltsDiv",out var sc2v) && sc2v.ValueKind==JsonValueKind.Number) _config.ScopeCh2VoltsDiv=Math.Clamp(Math.Abs(sc2v.GetDouble()),0.001,1000);
        if (v.TryGetProperty("scopeCh2Offset",out var sc2o) && sc2o.ValueKind==JsonValueKind.Number) _config.ScopeCh2Offset=Math.Clamp(sc2o.GetDouble(),-1000,1000);
        if (v.TryGetProperty("scopeCh2Coupling",out var sc2c) && sc2c.ValueKind==JsonValueKind.String) _config.ScopeCh2Coupling=NormalizeScopeCoupling(sc2c.GetString());
        if (v.TryGetProperty("scopeTriggerSource",out var sts) && sts.ValueKind==JsonValueKind.String) _config.ScopeTriggerSource=(sts.GetString()??"CH1").Trim().ToUpperInvariant();
        if (v.TryGetProperty("scopeTriggerLevel",out var stl) && stl.ValueKind==JsonValueKind.Number) _config.ScopeTriggerLevel=Math.Clamp(stl.GetDouble(),-1000,1000);
        if (v.TryGetProperty("scopeTriggerSlope",out var stsl) && stsl.ValueKind==JsonValueKind.String) _config.ScopeTriggerSlope=(stsl.GetString()??"RISING").Trim().ToUpperInvariant();
        if (v.TryGetProperty("scopeAcquisition",out var sac) && sac.ValueKind==JsonValueKind.String) _config.ScopeAcquisition=(sac.GetString()??"SAMPLE").Trim().ToUpperInvariant();
        if (v.TryGetProperty("scopeAverage",out var sav) && sav.ValueKind==JsonValueKind.Number) _config.ScopeAverage=Math.Clamp(sav.GetInt32(),2,1024);

        if (v.TryGetProperty("powerInterfaceEnabled",out var pie) && (pie.ValueKind==JsonValueKind.True||pie.ValueKind==JsonValueKind.False)) _config.PowerInterfaceEnabled=pie.GetBoolean();
        if (v.TryGetProperty("powerInterfaceEndpoint",out var pip) && pip.ValueKind==JsonValueKind.String) _config.PowerInterfaceEndpoint=(pip.GetString()??"AUTO").Trim();
        if (v.TryGetProperty("spectrumInterfaceEnabled",out var sie) && (sie.ValueKind==JsonValueKind.True||sie.ValueKind==JsonValueKind.False)) _config.SpectrumInterfaceEnabled=sie.GetBoolean();
        if (v.TryGetProperty("spectrumInterfaceEndpoint",out var sip) && sip.ValueKind==JsonValueKind.String) _config.SpectrumInterfaceEndpoint=(sip.GetString()??"TCPIP::AUTO").Trim();
        if (v.TryGetProperty("beamInterfaceEnabled",out var bie) && (bie.ValueKind==JsonValueKind.True||bie.ValueKind==JsonValueKind.False)) _config.BeamInterfaceEnabled=bie.GetBoolean();
        if (v.TryGetProperty("beamInterfaceEndpoint",out var bip) && bip.ValueKind==JsonValueKind.String) _config.BeamInterfaceEndpoint=(bip.GetString()??"AUTO").Trim();
        if (v.TryGetProperty("scopeInterfaceEnabled",out var scie) && (scie.ValueKind==JsonValueKind.True||scie.ValueKind==JsonValueKind.False)) _config.ScopeInterfaceEnabled=scie.GetBoolean();
        if (v.TryGetProperty("scopeInterfaceEndpoint",out var scip) && scip.ValueKind==JsonValueKind.String) _config.ScopeInterfaceEndpoint=(scip.GetString()??"TCPIP::AUTO").Trim();

        if (v.TryGetProperty("aliases",out var aliases) && aliases.ValueKind==JsonValueKind.Object)
        {
            static string Alias(JsonElement a,string key,string current)
                => a.TryGetProperty(key,out var p) && p.ValueKind==JsonValueKind.String && !string.IsNullOrWhiteSpace(p.GetString()) ? p.GetString()!.Trim() : current;
            _config.Power1Alias=Alias(aliases,"power1",_config.Power1Alias);
            _config.Power2Alias=Alias(aliases,"power2",_config.Power2Alias);
            _config.Math1Alias=Alias(aliases,"math1",_config.Math1Alias);
            _config.Osa1Alias=Alias(aliases,"osa1",_config.Osa1Alias);
            _config.BeamAlias=Alias(aliases,"beam",_config.BeamAlias);
            _config.Scope1Alias=Alias(aliases,"scope1",_config.Scope1Alias);
            _config.Scope2Alias=Alias(aliases,"scope2",_config.Scope2Alias);
        }
        AppConfigStore.Save(_config);
        return new { snapshot=BuildSnapshot() };
    }

    private static string NormalizePowerUnit(string? value)
    {
        var unit=(value??"kW").Trim();
        return unit is "kW" or "W" or "mW" ? unit : "kW";
    }

    private static string NormalizeCustomUnit(string? value)
    {
        var unit=(value??string.Empty).Trim();
        return unit.Length>12 ? unit[..12] : unit;
    }

    private static string NormalizeScopeCoupling(string? value)
    {
        var coupling=(value??"DC").Trim().ToUpperInvariant();
        return coupling is "DC" or "AC" or "GND" ? coupling : "DC";
    }

    private object ProbeInterfaces(JsonElement? value)
    {
        if (_provider is not IInstrumentRuntimeControl control)
            return new { message = "当前 Provider 不支持运行时硬件 Probe。", snapshot = BuildSnapshot() };

        ModuleKind? kind = null;
        if (value.HasValue && value.Value.ValueKind == JsonValueKind.Object &&
            value.Value.TryGetProperty("kind", out var kindProperty) && kindProperty.ValueKind == JsonValueKind.String)
        {
            kind = (kindProperty.GetString() ?? string.Empty).Trim().ToLowerInvariant() switch
            {
                "power" => ModuleKind.Power,
                "spectrum" => ModuleKind.Spectrum,
                "beam" => ModuleKind.Beam,
                "scope" => ModuleKind.Scope,
                "" => null,
                _ => throw new InvalidOperationException("未知硬件 Probe 模块。")
            };
        }

        control.RequestProbe(kind);
        return new { message = kind is null ? "已请求重新探测全部真实接口。" : $"已请求重新探测 {kind}。", snapshot = BuildSnapshot() };
    }

    private object PickExperimentFolder()
    {
        Directory.CreateDirectory(AppPaths.ExpDir);
        var root = Path.GetFullPath(AppPaths.ExpDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var current = string.IsNullOrWhiteSpace(_config.CurrentExperimentFolder)
            ? root
            : Path.Combine(root, _config.CurrentExperimentFolder);
        if (!Directory.Exists(current)) current = root;

        using var dialog = new FolderBrowserDialog
        {
            Description = "选择或新建实验文件夹（data\\exp 下一级）",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = true,
            InitialDirectory = current,
            SelectedPath = current
        };
        if (dialog.ShowDialog(_form) != DialogResult.OK || string.IsNullOrWhiteSpace(dialog.SelectedPath))
            return new { cancelled = true, folder = _config.CurrentExperimentFolder };

        var selected = Path.GetFullPath(dialog.SelectedPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (string.Equals(selected, root, StringComparison.OrdinalIgnoreCase))
        {
            _config.CurrentExperimentFolder = string.Empty;
            AppConfigStore.Save(_config);
            return new { cancelled = false, folder = string.Empty, path = root };
        }

        var parent = Path.GetDirectoryName(selected)?.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (!string.Equals(parent, root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("请选择 data\\exp 下一级实验文件夹；可在选择窗口中直接新建文件夹。");

        _config.CurrentExperimentFolder = Path.GetFileName(selected);
        AppConfigStore.Save(_config);
        return new { cancelled = false, folder = _config.CurrentExperimentFolder, path = selected };
    }

    private object OpenFolder(JsonElement? value)
    {
        var kind=ReadString(value,"kind");
        var path=kind switch
        {
            "exp" => AppPaths.ResolveExperimentDirectory(_config),
            "pic" => AppPaths.PicDir,
            "video" => AppPaths.VideoDir,
            "root" => AppPaths.Root,
            _ => throw new InvalidOperationException("未知目录。")
        };
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute=true });
        return new { path };
    }

    private object SetBeamZ(JsonElement? value)
    {
        _config.BeamZ = Math.Clamp(ReadDouble(value, "value"), -24, 24);
        AppConfigStore.Save(_config);
        return new { snapshot = BuildSnapshot() };
    }

    private object SetBeamAttenuation(JsonElement? value)
    {
        _config.BeamAttenuation = Math.Clamp(ReadDouble(value, "value"), 0, 40);
        AppConfigStore.Save(_config);
        return new { snapshot = BuildSnapshot() };
    }

    private object BuildSnapshot()
    {
        var snap = _provider.Snapshot(_config);
        var runtime = _provider as IInstrumentRuntimeStatusSource;
        var interfaceStates = runtime?.InterfaceStatuses ?? InstrumentBackendRegistry.InspectAll(_config);
        var firstHistory = _provider.PowerHistory(0, _config.PowerWindow, 720);
        var end = firstHistory.LastOrDefault().Time;
        var colors = new[] { "#075ee6", "#ff8200", "#08a84f" };
        var traces = snap.Power.Select((trace, index) =>
        {
            var history = _provider.PowerHistory(index, _config.PowerWindow, 720)
                .Select(point => new { x = point.Time - end, y = point.Value })
                .ToArray();
            return new { trace.Name, trace.Unit, trace.Value, trace.MaxValue, color = colors[Math.Min(index, colors.Length - 1)], points = history };
        }).ToArray();

        var spectrumMain = snap.Spectrum.Where(p=>p.X>=_config.OsaStart && p.X<=_config.OsaStop).Select(p => new { x = p.X, y = p.Y }).ToArray();
        var spectrumRef = snap.Spectrum.Where(p=>p.X>=_config.OsaStart && p.X<=_config.OsaStop).Select(p => new { x = p.X, y = Math.Max(-100, p.Y - 5.5 - 2.5 * Math.Exp(-0.5 * Math.Pow((p.X - snap.CenterWavelength) / 0.7, 2))) }).ToArray();
        var beam = snap.Beam.Select(p => new { x = p.Z, y = p.X * 1000.0 }).ToArray();
        var beamY = snap.Beam.Select(p => new { x = p.Z, y = p.Y * 1000.0 }).ToArray();
        var nearest = snap.Beam.OrderBy(p => Math.Abs(p.Z - _config.BeamZ)).FirstOrDefault();
        var scopeTime = snap.ScopeTime;
        var scopeFft = snap.ScopeFft;

        return new
        {
            version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.5.1",
            mode = runtime?.DataPlaneMode ?? (_provider.IsSimulator ? "SIM" : "HW"),
            timestamp = snap.Timestamp,
            label = _config.ConfirmedLabel,
            capturing = _form.IsCapturing,
            captureState = _form.CaptureState,
            lastCaptureMessage = _form.LastCaptureMessage,
            lastCaptureAt = _form.LastCaptureAt,
            recording = _form.IsRecording,
            captureSelection = new
            {
                power = _config.CapturePower,
                spectrum = _config.CaptureSpectrum,
                beam = _config.CaptureBeam,
                scope = _config.CaptureScope
            },
            config = new
            {
                experimentFolder = _config.CurrentExperimentFolder,
                autoScreenshot = _config.AutoScreenshot,
                aliases = new
                {
                    power1=_config.Power1Alias,power2=_config.Power2Alias,math1=_config.Math1Alias,osa1=_config.Osa1Alias,
                    beam=_config.BeamAlias,scope1=_config.Scope1Alias,scope2=_config.Scope2Alias
                },
                rootPath = AppPaths.Root,
                powerWindow=_config.PowerWindow, osaStart=_config.OsaStart, osaStop=_config.OsaStop,
                scopeTimeSpan=_config.ScopeTimeSpan, scopeFftMax=_config.ScopeFftMax, scopeCh1=_config.ScopeCh1, scopeCh2=_config.ScopeCh2,
                dashboardPower1=_config.DashboardPower1, dashboardPower2=_config.DashboardPower2, dashboardMath1=_config.DashboardMath1,
                powerActiveTrace=_config.PowerActiveTrace, powerAverageSamples=_config.PowerAverageSamples, powerOffset=_config.PowerOffset,
                powerScale=_config.PowerScale, powerNormalize=_config.PowerNormalize, powerNormalizeValue=_config.PowerNormalizeValue,
                powerDensity=_config.PowerDensity, powerAreaCm2=_config.PowerAreaCm2, powerPassFail=_config.PowerPassFail,
                powerLow=_config.PowerLow, powerHigh=_config.PowerHigh,
                power1DisplayUnit=_config.Power1DisplayUnit, power2DisplayUnit=_config.Power2DisplayUnit, math1DisplayUnit=_config.Math1DisplayUnit,
                power1AxisMin=_config.Power1AxisMin, power1AxisMax=_config.Power1AxisMax,
                power2AxisMin=_config.Power2AxisMin, power2AxisMax=_config.Power2AxisMax,
                math1AxisMin=_config.Math1AxisMin, math1AxisMax=_config.Math1AxisMax,
                osaResolution=_config.OsaResolution, osaSensitivity=_config.OsaSensitivity, osaAverage=_config.OsaAverage,
                osaRefLevel=_config.OsaRefLevel, osaDbPerDiv=_config.OsaDbPerDiv, osaShowRef=_config.OsaShowRef,
                osaSweepMode=_config.OsaSweepMode, osaMarkerPeak=_config.OsaMarkerPeak,
                osaSamplePoints=_config.OsaSamplePoints, osaVideoBandwidthHz=_config.OsaVideoBandwidthHz,
                osaTraceMode=_config.OsaTraceMode, osaSmoothingPoints=_config.OsaSmoothingPoints,
                osaWavelengthOffsetNm=_config.OsaWavelengthOffsetNm, osaWavelengthReference=_config.OsaWavelengthReference,
                osaAutoPeakSearch=_config.OsaAutoPeakSearch, osaPeakThresholdDb=_config.OsaPeakThresholdDb,
                beamRunMode=_config.BeamRunMode, beamWidthMethod=_config.BeamWidthMethod, beamAutoOutlier=_config.BeamAutoOutlier,
                beamShowX=_config.BeamShowX, beamShowY=_config.BeamShowY,
                scopeVoltsDiv=_config.ScopeVoltsDiv, scopeOffset=_config.ScopeOffset, scopeCoupling=_config.ScopeCoupling,
                scopeActiveChannel=_config.ScopeActiveChannel,
                scopeCh1VoltsDiv=_config.ScopeCh1VoltsDiv, scopeCh1Offset=_config.ScopeCh1Offset, scopeCh1Coupling=_config.ScopeCh1Coupling,
                scopeCh2VoltsDiv=_config.ScopeCh2VoltsDiv, scopeCh2Offset=_config.ScopeCh2Offset, scopeCh2Coupling=_config.ScopeCh2Coupling,
                scopeTriggerSource=_config.ScopeTriggerSource, scopeTriggerLevel=_config.ScopeTriggerLevel,
                scopeTriggerSlope=_config.ScopeTriggerSlope, scopeAcquisition=_config.ScopeAcquisition, scopeAverage=_config.ScopeAverage,
                powerInterfaceEnabled=_config.PowerInterfaceEnabled, powerInterfaceEndpoint=_config.PowerInterfaceEndpoint,
                spectrumInterfaceEnabled=_config.SpectrumInterfaceEnabled, spectrumInterfaceEndpoint=_config.SpectrumInterfaceEndpoint,
                beamInterfaceEnabled=_config.BeamInterfaceEnabled, beamInterfaceEndpoint=_config.BeamInterfaceEndpoint,
                scopeInterfaceEnabled=_config.ScopeInterfaceEnabled, scopeInterfaceEndpoint=_config.ScopeInterfaceEndpoint
            },
            interfaces = interfaceStates.Select(x => new
            {
                kind=x.Kind.ToString().ToLowerInvariant(),
                x.DriverId, x.DeviceName, x.VendorSoftware, x.InterfaceName,
                x.Enabled, x.DataPlaneReady, x.Endpoint, x.State, x.Message,
                x.Identity, x.LastSampleAt, x.FailureCount
            }).ToArray(),
            data = BuildDataSummary(),
            devices = BuildDevices(),
            power = new { traces },
            spectrum = new
            {
                centerWavelength = snap.CenterWavelength,
                linewidth3Db = snap.Linewidth3Db,
                linewidthRms = snap.LinewidthRms,
                power = snap.SpectrumPower,
                traces = new object[]
                {
                    new { name = _config.Osa1Alias.ToUpperInvariant(), color = "#075ee6", points = spectrumMain },
                    new { name = "Ref", color = "#ff7a00", points = spectrumRef }
                }
            },
            beam = new
            {
                z = _config.BeamZ,
                attenuation = _config.BeamAttenuation,
                m2x = snap.M2X,
                m2y = snap.M2Y,
                m2mean = snap.M2Mean,
                spotWidthX = (nearest?.X ?? 0.12) * 1000.0,
                spotWidthY = (nearest?.Y ?? 0.13) * 1000.0,
                caustic = new object[]
                {
                    new { name = "X", color = "#075ee6", markers = true, points = beam },
                    new { name = "Y", color = "#ff2b20", markers = true, points = beamY }
                }
            },
            scope = new
            {
                sampleRate = snap.ScopeSampleRateSaPerSecond,
                time = new object[]
                {
                    new { name = _config.Scope1Alias.ToUpperInvariant(), color = "#075ee6", points = scopeTime.Select(p => new { x = p.X, y = p.Ch1 }).ToArray() },
                    new { name = _config.Scope2Alias.ToUpperInvariant(), color = "#ff7a00", points = scopeTime.Select(p => new { x = p.X, y = p.Ch2 }).ToArray() }
                }.Where((_,i)=>i==0?_config.ScopeCh1:_config.ScopeCh2).ToArray(),
                fft = new object[]
                {
                    new { name = _config.Scope1Alias.ToUpperInvariant(), color = "#075ee6", points = scopeFft.Select(p => new { x = p.X, y = p.Ch1 }).ToArray() },
                    new { name = _config.Scope2Alias.ToUpperInvariant(), color = "#ff7a00", points = scopeFft.Select(p => new { x = p.X, y = p.Ch2 }).ToArray() }
                }.Where((_,i)=>i==0?_config.ScopeCh1:_config.ScopeCh2).ToArray()
            }
        };
    }

    private object BuildDataSummary()
    {
        var exp=AppPaths.ResolveExperimentDirectory(_config);
        var allFiles=Directory.EnumerateFiles(exp).Select(path=>new FileInfo(path)).ToArray();
        var files=allFiles
            .AsEnumerable()
            .OrderByDescending(f=>f.LastWriteTime)
            .Take(100)
            .Select(f=>new { name=f.Name, size=f.Length, modified=f.LastWriteTime, extension=f.Extension.TrimStart('.').ToLowerInvariant(), group=ParseDataGroup(f.Name) })
            .ToArray();
        return new
        {
            experimentFolder=Path.GetFileName(exp),
            fileCount=allFiles.Length,
            files,
            pictureCount=Directory.Exists(AppPaths.PicDir)?Directory.EnumerateFiles(AppPaths.PicDir,"*.png").Count():0,
            videoCount=Directory.Exists(AppPaths.VideoDir)?Directory.EnumerateFiles(AppPaths.VideoDir,"*.avi").Count():0
        };
    }

    private static string ParseDataGroup(string name)
    {
        var stem=Path.GetFileNameWithoutExtension(name);
        var parts=stem.Split('_',StringSplitOptions.RemoveEmptyEntries);
        return parts.Length>0 && parts[0].Length==6 && parts[0].All(char.IsDigit) ? parts[0] : "other";
    }

    private object[] BuildDevices()
    {
        var powerIndex = 0;
        return _provider.Devices.Select(device =>
        {
            string alias = device.Kind switch
            {
                ModuleKind.Power => powerIndex++ == 0 ? _config.Power1Alias : _config.Power2Alias,
                ModuleKind.Spectrum => _config.Osa1Alias,
                ModuleKind.Beam => _config.BeamAlias,
                ModuleKind.Scope => "scope",
                _ => device.Alias
            };
            return new { alias, kind = device.Kind.ToString().ToLowerInvariant(), status = device.Connected ? "online" : "offline" };
        }).Cast<object>().ToArray();
    }

    private void PushSnapshot()
    {
        if (_disposed || !_ready || _webView.IsDisposed || _webView.CoreWebView2 is null) return;
        try
        {
            var json = JsonSerializer.Serialize(new { type = "snapshot", payload = BuildSnapshot() }, JsonOptions);
            _webView.CoreWebView2.PostWebMessageAsJson(json);
        }
        catch (Exception ex)
        {
            StartupDiagnostics.Crash("webui snapshot push", ex);
        }
    }

    private void Reply(string id, bool ok, object? result, string? error)
    {
        if (string.IsNullOrWhiteSpace(id) || _webView.CoreWebView2 is null) return;
        var json = JsonSerializer.Serialize(new { type = "reply", id, ok, result, error }, JsonOptions);
        _webView.CoreWebView2.PostWebMessageAsJson(json);
    }

    private static string ReadString(JsonElement? element, string name)
    {
        if (!element.HasValue || element.Value.ValueKind != JsonValueKind.Object || !element.Value.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException($"Missing string parameter: {name}");
        return property.GetString() ?? string.Empty;
    }

    private static bool ReadBool(JsonElement? element, string name)
    {
        if (!element.HasValue || element.Value.ValueKind != JsonValueKind.Object || !element.Value.TryGetProperty(name, out var property))
            throw new InvalidOperationException($"Missing boolean parameter: {name}");
        return property.GetBoolean();
    }

    private static double ReadDouble(JsonElement? element, string name)
    {
        if (!element.HasValue || element.Value.ValueKind != JsonValueKind.Object || !element.Value.TryGetProperty(name, out var property))
            throw new InvalidOperationException($"Missing numeric parameter: {name}");
        return property.GetDouble();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _pushTimer.Stop();
        _pushTimer.Dispose();
        try { if (_webView.CoreWebView2 is not null) _webView.CoreWebView2.WebMessageReceived -= OnWebMessageReceived; } catch { }
        _webView.Dispose();
        _surface.Dispose();
    }

    private sealed record BridgeRequest(string Id, string Method, JsonElement? Params);
}