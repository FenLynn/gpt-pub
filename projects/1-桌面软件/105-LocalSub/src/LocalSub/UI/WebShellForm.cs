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
        "app.navigate"
    };
    static readonly HashSet<string> AllowedPages = new(StringComparer.Ordinal)
    {
        "live", "batch", "models", "settings", "about"
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
    readonly bool _smoke;
    string _activePage = "live";
    bool _bridgeRoundTripObserved;
    bool _disposed;

    public WebShellForm(bool smoke = false)
    {
        _smoke = smoke;
        Text = "LocalSub";
        Width = 1180;
        Height = 760;
        MinimumSize = new Size(900, 640);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(243, 246, 249);
        Controls.Add(_loading);
        Controls.Add(_web);
        _web.Visible = false;
        Shown += async (_, _) => await InitializeAsync();
        FormClosed += (_, _) => DisposeOwnedResources();
    }

    internal static void ValidateBridgeContract()
    {
        var expected = new[] { "app.getSnapshot", "app.navigate" };
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
            core.Navigate(Origin + "/index.html");
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

            object result = request.Method switch
            {
                "app.getSnapshot" => await BuildSnapshotAsync(),
                "app.navigate" => await NavigateAsync(request.Params),
                _ => throw new InvalidOperationException("不允许的界面命令。")
            };
            Reply(request.Id, true, result, null);

            if (_smoke && request.Method == "app.getSnapshot" && !_bridgeRoundTripObserved)
            {
                _bridgeRoundTripObserved = true;
                Directory.CreateDirectory(PortablePaths.LogsDir);
                File.WriteAllText(
                    Path.Combine(PortablePaths.LogsDir, "webui-smoke-ready.txt"),
                    $"webview2=ready{Environment.NewLine}bridge=app.getSnapshot{Environment.NewLine}");
            }
        }
        catch (Exception ex)
        {
            Reply(request?.Id ?? string.Empty, false, null, ex.Message);
        }
    }

    async Task<object> NavigateAsync(JsonElement? parameters)
    {
        if (!parameters.HasValue ||
            parameters.Value.ValueKind != JsonValueKind.Object ||
            !parameters.Value.TryGetProperty("page", out var pageNode) ||
            pageNode.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException("Missing app.navigate page.");

        var page = pageNode.GetString() ?? "";
        if (!AllowedPages.Contains(page)) throw new InvalidOperationException("不允许的页面。");
        _activePage = page;
        return await BuildSnapshotAsync();
    }

    async Task<object> BuildSnapshotAsync()
    {
        string coreState;
        string? coreError = null;
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await _core.PingAsync(timeout.Token);
            coreState = "ready";
        }
        catch (Exception ex)
        {
            coreState = "failed";
            coreError = ex.Message;
        }

        var settings = AppSettings.Load();
        var catalog = new ModelCatalogService().Load();
        var models = new ModelManager(settings);
        var installedCount = catalog.Count(models.IsInstalled);

        return new
        {
            app = new
            {
                productVersion = typeof(WebShellForm).Assembly.GetName().Version?.ToString(3) ?? "0.1.1",
                activePage = _activePage,
                busy = false,
                lastError = (string?)null
            },
            core = new
            {
                state = coreState,
                pid = _core.WorkerProcessId,
                generation = _core.ConnectionGeneration,
                currentOperation = (string?)null,
                lastError = coreError
            },
            live = new
            {
                state = "idle",
                source = settings.AudioSource == AudioSourceMode.PotPlayer ? "PotPlayer" : "所有音频",
                modelName = "由现有实时页选择",
                level = 0.0,
                status = "实时链已迁入 LocalSub.Core，Web 控制将在 Phase 2B 接入"
            },
            batch = new
            {
                queued = 0,
                state = "idle",
                status = "现有后台转写继续由 Core 执行"
            },
            models = new
            {
                catalogCount = catalog.Count,
                installedCount,
                status = $"{installedCount} 个本地模型可用"
            },
            settings = new
            {
                audioSource = settings.AudioSource.ToString(),
                resourceProfile = settings.ResourceProfile.ToString(),
                subtitleAutoSize = settings.SubtitleAutoSize,
                subtitleFontSize = settings.SubtitleFontSize
            }
        };
    }

    void Reply(string id, bool ok, object? result, string? error)
    {
        if (string.IsNullOrWhiteSpace(id) || _web.CoreWebView2 == null) return;
        var json = JsonSerializer.Serialize(new { id, ok, result, error }, JsonOptions);
        _web.CoreWebView2.PostWebMessageAsJson(json);
    }

    void DisposeOwnedResources()
    {
        if (_disposed) return;
        _disposed = true;
        try
        {
            if (_web.CoreWebView2 != null) _web.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
        }
        catch { }
        try { _core.DisposeAsync().AsTask().GetAwaiter().GetResult(); } catch { }
        try { _web.Dispose(); } catch { }
    }

    sealed record BridgeRequest(string Id, string? Method, JsonElement? Params);
}
