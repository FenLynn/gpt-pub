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

                    await core.ExecuteScriptAsync(
                        "(()=>{const e=document.querySelector('.topbar .module-toggle.active');" +
                        "if(!e){window.__lbAcqAnimT=null;return null;}" +
                        "const a=[e,...e.querySelectorAll('*')].flatMap(n=>typeof n.getAnimations==='function'?n.getAnimations():[]).find(x=>x.playState==='running');" +
                        "window.__lbAcqAnimT=a&&typeof a.currentTime==='number'?a.currentTime:-1;return window.__lbAcqAnimT})()");
                    await Task.Delay(320);
                    var moving = await core.ExecuteScriptAsync(
                        "(()=>{if(window.__lbAcqAnimT===null)return true;const e=document.querySelector('.topbar .module-toggle.active');" +
                        "if(!e)return false;const a=[e,...e.querySelectorAll('*')].flatMap(n=>typeof n.getAnimations==='function'?n.getAnimations():[]).find(x=>x.playState==='running');" +
                        "return !!a&&typeof a.currentTime==='number'&&a.currentTime>window.__lbAcqAnimT+150})()");
                    if (!string.Equals(moving, "true", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("WebView2 acquisition vector CSS animation is not advancing.");

                    StartupDiagnostics.Stage("webui-acq-vectors", "running");
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
            version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.4.24",
            mode = _provider.IsSimulator ? "SIM" : "HW",
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
                dashboardPower1=_config.DashboardPower1, dashboardPower2=_config.DashboardPower2, dashboardMath1=_config.DashboardMath1
            },
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
