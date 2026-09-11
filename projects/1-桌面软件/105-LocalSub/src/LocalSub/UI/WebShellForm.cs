using System.Reflection;
using System.Text.Json;
using LocalSub.Core;
using LocalSub.Models;
using LocalSub.Services;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LocalSub.UI;

internal static class WebUiAssets
{
    const string Prefix = "LocalSub.WebUi.";
    static readonly (string Resource, string Relative)[] Required =
    [
        (Prefix + "index.html", "index.html"),
        (Prefix + "assets.app.js", Path.Combine("assets", "app.js")),
        (Prefix + "assets.app.css", Path.Combine("assets", "app.css"))
    ];

    internal static void ValidateEmbeddedResources()
    {
        var names = Assembly.GetExecutingAssembly().GetManifestResourceNames().ToHashSet(StringComparer.Ordinal);
        foreach (var item in Required)
            if (!names.Contains(item.Resource))
                throw new InvalidOperationException($"LocalSub WebUi resource is missing: {item.Resource}. Build WebUi before publish.");
    }

    internal static string Extract()
    {
        ValidateEmbeddedResources();
        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";
        var root = Path.Combine(Path.GetTempPath(), "LocalSub", "WebUi", version);
        Directory.CreateDirectory(root);
        Directory.CreateDirectory(Path.Combine(root, "assets"));

        var assembly = Assembly.GetExecutingAssembly();
        foreach (var item in Required)
        {
            var destination = Path.Combine(root, item.Relative);
            using var input = assembly.GetManifestResourceStream(item.Resource)
                ?? throw new InvalidOperationException($"Unable to open embedded WebUi resource {item.Resource}.");
            using var output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.Read);
            input.CopyTo(output);
        }
        return root;
    }
}

public sealed class WebShellForm : Form
{
    const string Origin = "https://localsub.local";
    static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };
    static readonly HashSet<string> AllowedMethods = new(StringComparer.Ordinal)
    {
        "app.getSnapshot",
        "app.navigate",
        "live.start",
        "live.stop",
        "model.list",
        "model.select"
    };
    static readonly HashSet<string> AllowedPages = new(StringComparer.Ordinal)
    {
        "live", "batch", "models", "settings", "docs"
    };

    readonly WebView2 _web = new() { Dock = DockStyle.Fill, BackColor = Color.FromArgb(243, 246, 249) };
    readonly Label _loading = new()
    {
        Dock = DockStyle.Fill,
        Text = "LocalSub 正在加载新界面…",
        TextAlign = ContentAlignment.MiddleCenter,
        ForeColor = Color.FromArgb(102, 116, 128),
        Font = new Font("Segoe UI", 10F)
    };
    readonly CoreWorkerClient _core = new();
    readonly LiveSessionController _live;
    readonly ModelCatalogController _models;
    readonly AppSettings _settings;
    readonly bool _smoke;
    readonly HashSet<string> _smokeMethods = new(StringComparer.Ordinal);

    string _activePage = "live";
    string _coreState = "stopped";
    string? _coreError;
    int _snapshotPushPending;
    bool _disposed;

    public WebShellForm(bool smoke = false)
    {
        _smoke = smoke;
        _settings = AppSettings.Load();
        _models = new ModelCatalogController();
        _live = new LiveSessionController(_core);

        Text = "LocalSub";
        Width = 1180;
        Height = 760;
        MinimumSize = new Size(900, 640);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(243, 246, 249);
        Controls.Add(_loading);
        Controls.Add(_web);
        _web.Visible = false;

        _live.Changed += OnLiveChanged;
        _core.ConnectionBroken += OnCoreConnectionBroken;
        Shown += async (_, _) => await InitializeAsync();
        FormClosed += async (_, _) => await DisposeOwnedResourcesAsync();
    }

    internal static void ValidateBridgeContract()
    {
        var expected = new[] { "app.getSnapshot", "app.navigate", "live.start", "live.stop", "model.list", "model.select" };
        if (AllowedMethods.Count != expected.Length || expected.Any(x => !AllowedMethods.Contains(x)))
            throw new InvalidOperationException("LocalSub WebUi bridge whitelist changed unexpectedly.");
    }

    async Task InitializeAsync()
    {
        try
        {
            ValidateBridgeContract();
            var assets = WebUiAssets.Extract();
            var userData = Path.Combine(PortablePaths.BaseDir, "WebView2", "Main");
            Directory.CreateDirectory(userData);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
            await _web.EnsureCoreWebView2Async(environment);
            var core = _web.CoreWebView2;

            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsWebMessageEnabled = true;
            core.SetVirtualHostNameToFolderMapping("localsub.local", assets, CoreWebView2HostResourceAccessKind.DenyCors);
            core.WebMessageReceived += OnWebMessageReceived;
            core.NewWindowRequested += (_, args) => args.Handled = true;
            core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
            core.NavigationStarting += (_, args) =>
            {
                if (!args.Uri.StartsWith(Origin + "/", StringComparison.OrdinalIgnoreCase)) args.Cancel = true;
            };
            core.NavigationCompleted += (_, args) =>
            {
                if (!args.IsSuccess) return;
                _loading.Visible = false;
                _web.Visible = true;
                _web.BringToFront();
            };

            core.Navigate(_smoke ? Origin + "/index.html?smoke=1" : Origin + "/index.html");
        }
        catch (Exception ex)
        {
            _loading.Text = "LocalSub 新界面无法启动\r\n\r\n" + ex.Message + "\r\n\r\n请确认 Microsoft Edge WebView2 Runtime 已安装。";
            _loading.ForeColor = Color.FromArgb(151, 67, 62);
            if (_smoke) throw;
        }
    }

    async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        BridgeRequest? request = null;
        try
        {
            request = JsonSerializer.Deserialize<BridgeRequest>(args.WebMessageAsJson, JsonOptions);
            if (request == null || string.IsNullOrWhiteSpace(request.Id) || string.IsNullOrWhiteSpace(request.Method))
                throw new InvalidOperationException("Invalid LocalSub WebUi bridge request.");
            if (!AllowedMethods.Contains(request.Method))
                throw new InvalidOperationException("不允许的界面命令。");

            object result;
            switch (request.Method)
            {
                case "app.getSnapshot":
                    result = await BuildSnapshotAsync(probeCore: true);
                    break;
                case "app.navigate":
                    result = await NavigateAsync(request.Params);
                    break;
                case "live.start":
                    result = await StartLiveAsync(request.Params);
                    break;
                case "live.stop":
                    result = await StopLiveAsync();
                    break;
                case "model.list":
                    result = ListModels();
                    break;
                case "model.select":
                    result = SelectModel(request.Params);
                    break;
                default:
                    throw new InvalidOperationException("不允许的界面命令。");
            }

            Reply(request.Id, true, result, null);
            RecordSmokeMethod(request.Method);
        }
        catch (Exception ex)
        {
            if (_smoke && request?.Method is "live.start" or "model.select")
                RecordSmokeMethod(request.Method);
            Reply(request?.Id ?? string.Empty, false, null, ex.Message);
        }
    }

    async Task<object> NavigateAsync(JsonElement? parameters)
    {
        if (!TryReadString(parameters, "page", out var page))
            throw new InvalidOperationException("Missing app.navigate page.");
        if (!AllowedPages.Contains(page))
            throw new InvalidOperationException("不允许的页面。");

        _activePage = page;
        if (page == "live") _live.RefreshConfiguration();
        if (page == "models") _models.Refresh();
        return await BuildSnapshotAsync(probeCore: false);
    }

    async Task<object> StartLiveAsync(JsonElement? parameters)
    {
        if (!TryReadString(parameters, "source", out var source))
            throw new InvalidOperationException("请选择实时音源。");
        if (!TryReadString(parameters, "modelId", out var modelId))
            throw new InvalidOperationException("请选择实时识别模型。");

        await _live.StartAsync(source, modelId);
        _coreState = _core.WorkerProcessId.HasValue ? "ready" : _coreState;
        _coreError = null;
        return BuildSnapshot();
    }

    async Task<object> StopLiveAsync()
    {
        await _live.StopAsync();
        return BuildSnapshot();
    }

    object ListModels()
    {
        _models.Refresh();
        return BuildSnapshot();
    }

    object SelectModel(JsonElement? parameters)
    {
        if (!TryReadString(parameters, "target", out var target))
            throw new InvalidOperationException("请选择模型默认用途。");
        if (!TryReadString(parameters, "modelId", out var modelId))
            throw new InvalidOperationException("请选择模型。");

        _models.SelectDefault(target, modelId);
        if (target == "live") _live.RefreshConfiguration();
        return BuildSnapshot();
    }

    async Task<object> BuildSnapshotAsync(bool probeCore)
    {
        if (probeCore) await ProbeCoreAsync();
        return BuildSnapshot();
    }

    object BuildSnapshot()
    {
        var live = _live.Snapshot;
        var busy = live.State is "starting" or "stopping";
        var operation = live.State is "starting" or "running" or "stopping" ? "realtime" : null;

        return new
        {
            app = new
            {
                productVersion = typeof(WebShellForm).Assembly.GetName().Version?.ToString(3) ?? "0.1.1",
                activePage = _activePage,
                busy,
                lastError = live.LastError
            },
            core = new
            {
                state = _coreState,
                pid = _core.WorkerProcessId,
                generation = _core.ConnectionGeneration,
                currentOperation = operation,
                lastError = _coreError
            },
            live,
            batch = new
            {
                queued = 0,
                state = "idle",
                status = "现有后台转写继续由 Core 执行"
            },
            models = _models.Snapshot,
            settings = new
            {
                audioSource = live.Source,
                resourceProfile = _settings.ResourceProfile.ToString(),
                subtitleAutoSize = _settings.SubtitleAutoSize,
                subtitleFontSize = _settings.SubtitleFontSize
            }
        };
    }

    async Task ProbeCoreAsync()
    {
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await _core.PingAsync(timeout.Token);
            _coreState = "ready";
            _coreError = null;
        }
        catch (Exception ex)
        {
            _coreState = "failed";
            _coreError = ex.Message;
        }
    }

    void OnLiveChanged()
    {
        var live = _live.Snapshot;
        if (_core.WorkerProcessId.HasValue && live.State is "starting" or "running" or "stopping")
        {
            _coreState = "ready";
            _coreError = null;
        }
        else if (live.State == "failed" && !_core.WorkerProcessId.HasValue)
        {
            _coreState = "failed";
            _coreError = live.LastError;
        }

        ScheduleSnapshotPush();
    }

    void OnCoreConnectionBroken(string message)
    {
        _coreState = "failed";
        _coreError = message;
        ScheduleSnapshotPush();
    }

    void ScheduleSnapshotPush()
    {
        if (_disposed || _web.CoreWebView2 == null) return;
        if (Interlocked.Exchange(ref _snapshotPushPending, 1) != 0) return;

        try
        {
            BeginInvoke(new Action(() =>
            {
                try
                {
                    if (!_disposed && _web.CoreWebView2 != null)
                        PostEvent("app.snapshot", BuildSnapshot());
                }
                finally
                {
                    Interlocked.Exchange(ref _snapshotPushPending, 0);
                }
            }));
        }
        catch
        {
            Interlocked.Exchange(ref _snapshotPushPending, 0);
        }
    }

    void PostEvent(string eventName, object payload)
    {
        if (_web.CoreWebView2 == null) return;
        var json = JsonSerializer.Serialize(new { kind = "event", @event = eventName, payload }, JsonOptions);
        _web.CoreWebView2.PostWebMessageAsJson(json);
    }

    void Reply(string id, bool ok, object? result, string? error)
    {
        if (string.IsNullOrWhiteSpace(id) || _web.CoreWebView2 == null) return;
        var json = JsonSerializer.Serialize(new { kind = "response", id, ok, result, error }, JsonOptions);
        _web.CoreWebView2.PostWebMessageAsJson(json);
    }

    void RecordSmokeMethod(string method)
    {
        if (!_smoke) return;
        _smokeMethods.Add(method);
        if (!_smokeMethods.Contains("app.getSnapshot") ||
            !_smokeMethods.Contains("live.stop") ||
            !_smokeMethods.Contains("live.start") ||
            !_smokeMethods.Contains("model.list") ||
            !_smokeMethods.Contains("model.select")) return;

        Directory.CreateDirectory(PortablePaths.LogsDir);
        File.WriteAllText(
            Path.Combine(PortablePaths.LogsDir, "webui-smoke-ready.txt"),
            $"webview2=ready{Environment.NewLine}bridge=app.getSnapshot{Environment.NewLine}bridge=live.stop{Environment.NewLine}bridge=live.start{Environment.NewLine}bridge=model.list{Environment.NewLine}bridge=model.select{Environment.NewLine}");
    }

    static bool TryReadString(JsonElement? parameters, string propertyName, out string value)
    {
        value = "";
        if (!parameters.HasValue ||
            parameters.Value.ValueKind != JsonValueKind.Object ||
            !parameters.Value.TryGetProperty(propertyName, out var node) ||
            node.ValueKind != JsonValueKind.String)
            return false;

        value = node.GetString()?.Trim() ?? "";
        return value.Length > 0;
    }

    async Task DisposeOwnedResourcesAsync()
    {
        if (_disposed) return;
        _disposed = true;

        _live.Changed -= OnLiveChanged;
        _core.ConnectionBroken -= OnCoreConnectionBroken;
        try { await _live.DisposeAsync(); } catch { }
        try { await _core.DisposeAsync(); } catch { }

        try
        {
            if (_web.CoreWebView2 != null) _web.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
        }
        catch { }
        try { _web.Dispose(); } catch { }
    }

    sealed record BridgeRequest(string Id, string? Method, JsonElement? Params);
}
