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
        "settings.update",
        "settings.previewSubtitle",
        "live.start",
        "live.stop",
        "model.list",
        "model.select",
        "model.download",
        "model.repair",
        "model.cancel",
        "model.delete",
        "batch.pickFiles",
        "batch.analyze",
        "batch.transcribe",
        "batch.transcribeAll",
        "batch.retry",
        "batch.pickOutputDirectory",
        "batch.export",
        "batch.exportAll",
        "batch.openOutputDirectory",
        "batch.remove",
        "batch.clear",
        "batch.exportTxt",
        "batch.cancel",
        "diagnostics.liveLevelAck"
    };
    static readonly HashSet<string> AllowedPages = new(StringComparer.Ordinal)
    {
        "home", "live", "batch", "models", "settings", "docs", "about"
    };

    readonly WebView2 _web = new()
    {
        Dock = DockStyle.Fill,
        BackColor = Color.FromArgb(241, 247, 251),
        DefaultBackgroundColor = Color.FromArgb(241, 247, 251)
    };
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
    readonly BatchWebController _batch;
    readonly AppSettings _settings;
    readonly bool _smoke;
    readonly HashSet<string> _smokeMethods = new(StringComparer.Ordinal);
    readonly System.Windows.Forms.Timer _autoStartTimer = new() { Interval = 1500 };

    string _activePage = "home";
    string _coreState = "stopped";
    string? _coreError;
    int _snapshotPushPending;
    int _levelPushPending;
    float _latestLiveLevel;
    long _meterWindowStarted;
    int _meterEventCount;
    float _meterMin = 1f;
    float _meterMax;
    bool _autoStartPending;
    bool _autoStartBusy;
    string _autoStartStatus = "";
    bool _disposed;

    internal event Action? TrayStateChanged;
    internal bool IsLiveRunning => _live.Snapshot.State == "running";
    internal string TrayStatusText
    {
        get
        {
            var live = _live.Snapshot;
            if (_autoStartPending && !string.IsNullOrWhiteSpace(_autoStartStatus)) return _autoStartStatus;
            return live.State switch
            {
                "running" => "实时字幕运行中",
                "starting" => "实时字幕启动中",
                "stopping" => "实时字幕停止中",
                "failed" => "实时字幕异常",
                _ => "待命"
            };
        }
    }

    public WebShellForm(bool smoke = false)
    {
        _smoke = smoke;
        _settings = AppSettings.Load();
        _models = new ModelCatalogController(_core);
        _batch = new BatchWebController(_core);
        _live = new LiveSessionController(_core);

        Text = "LocalSub";
        Icon = AppIcon.Create();
        Width = 1100;
        Height = 825;
        MinimumSize = new Size(900, 675);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(241, 247, 251);
        Controls.Add(_loading);
        Controls.Add(_web);
        _web.Visible = false;

        _live.Changed += OnLiveChanged;
        _live.LevelChanged += OnLiveLevelChanged;
        _models.Changed += OnModelsChanged;
        _batch.Changed += OnBatchChanged;
        _core.ConnectionBroken += OnCoreConnectionBroken;
        _autoStartTimer.Tick += async (_, _) => await TryAutoStartLiveAsync();
        _autoStartPending = !_smoke && _settings.AutoStartLive;
        Shown += async (_, _) => await InitializeAsync();
        FormClosed += async (_, _) => await DisposeOwnedResourcesAsync();
    }

    internal static void ValidateBridgeContract()
    {
        var expected = new[] { "app.getSnapshot", "app.navigate", "settings.update", "settings.previewSubtitle", "live.start", "live.stop", "model.list", "model.select", "model.download", "model.repair", "model.cancel", "model.delete", "batch.pickFiles", "batch.analyze", "batch.transcribe", "batch.transcribeAll", "batch.retry", "batch.pickOutputDirectory", "batch.export", "batch.exportAll", "batch.openOutputDirectory", "batch.remove", "batch.clear", "batch.exportTxt", "batch.cancel", "diagnostics.liveLevelAck" };
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
            core.NavigationCompleted += async (_, args) =>
            {
                if (!args.IsSuccess) return;
                _loading.Visible = false;
                _web.Visible = true;
                _web.BringToFront();

                if (_smoke)
                {
                    await Task.Delay(700);
                    if (!_disposed && _web.CoreWebView2 != null)
                        PostEvent("live.level", new { value = 0.73f });
                }
            };

            core.Navigate(_smoke ? Origin + "/index.html?smoke=1" : Origin + "/index.html");
            if (_autoStartPending)
            {
                _autoStartTimer.Start();
                _ = TryAutoStartLiveAsync();
            }
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
                case "settings.update":
                    result = await UpdateSettingsAsync(request.Params);
                    break;
                case "settings.previewSubtitle":
                    result = await PreviewSubtitleAsync();
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
                case "model.download":
                    result = await DownloadModelAsync(request.Params);
                    break;
                case "model.repair":
                    result = await RepairModelAsync(request.Params);
                    break;
                case "model.cancel":
                    result = CancelModel();
                    break;
                case "model.delete":
                    result = await DeleteModelAsync(request.Params);
                    break;
                case "batch.pickFiles":
                    result = PickBatchFiles();
                    break;
                case "batch.analyze":
                    result = await AnalyzeBatchAsync(request.Params);
                    break;
                case "batch.transcribe":
                    result = await TranscribeBatchAsync(request.Params);
                    break;
                case "batch.transcribeAll":
                    result = await TranscribeAllBatchAsync(request.Params);
                    break;
                case "batch.retry":
                    result = await RetryBatchAsync(request.Params);
                    break;
                case "batch.pickOutputDirectory":
                    result = PickBatchOutputDirectory();
                    break;
                case "batch.export":
                    result = ExportBatch(request.Params);
                    break;
                case "batch.exportAll":
                    result = ExportAllBatch();
                    break;
                case "batch.openOutputDirectory":
                    result = OpenBatchOutputDirectory();
                    break;
                case "batch.remove":
                    result = RemoveBatch(request.Params);
                    break;
                case "batch.clear":
                    result = ClearBatch();
                    break;
                case "batch.exportTxt":
                    result = ExportBatchTxt(request.Params);
                    break;
                case "batch.cancel":
                    result = CancelBatch();
                    break;
                case "diagnostics.liveLevelAck":
                    result = RecordBrowserLevelAck(request.Params);
                    break;
                default:
                    throw new InvalidOperationException("不允许的界面命令。");
            }

            Reply(request.Id, true, result, null);
            RecordSmokeMethod(request.Method);
        }
        catch (Exception ex)
        {
            if (_smoke && request?.Method is "live.start" or "model.select" or "model.download" or "model.repair" or "model.delete")
                RecordSmokeMethod(request.Method);
            Reply(request?.Id ?? string.Empty, false, null, ex.Message);
        }
    }

    object RecordBrowserLevelAck(JsonElement? parameters)
    {
        var value = 0f;
        if (parameters.HasValue &&
            parameters.Value.ValueKind == JsonValueKind.Object &&
            parameters.Value.TryGetProperty("value", out var valueNode) &&
            valueNode.TryGetSingle(out var parsed))
            value = Math.Clamp(parsed, 0, 1);

        try
        {
            PortablePaths.EnsureBaseFolders();
            File.AppendAllText(
                Path.Combine(PortablePaths.LogsDir, "meter-browser.log"),
                $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] value={value:0.0000}{Environment.NewLine}");
        }
        catch { }

        return new { recorded = true, value };
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

    internal async Task ToggleLiveFromTrayAsync()
    {
        _autoStartPending = false;
        _autoStartTimer.Stop();
        var live = _live.Snapshot;
        if (live.State == "running")
        {
            await _live.StopAsync();
            TrayStateChanged?.Invoke();
            return;
        }

        if (live.State is "starting" or "stopping")
            throw new InvalidOperationException("实时字幕正在切换状态，请稍候。");
        if (string.IsNullOrWhiteSpace(live.ModelId))
            throw new InvalidOperationException("没有可用的实时识别模型。");

        await _live.StartAsync(live.SourceId, live.ModelId);
        _coreState = _core.WorkerProcessId.HasValue ? "ready" : _coreState;
        _coreError = null;
        TrayStateChanged?.Invoke();
    }

    async Task TryAutoStartLiveAsync()
    {
        if (_disposed || !_autoStartPending || _autoStartBusy) return;
        _autoStartBusy = true;
        try
        {
            var current = AppSettings.Load();
            if (!current.AutoStartLive)
            {
                _autoStartPending = false;
                _autoStartTimer.Stop();
                _autoStartStatus = "";
                return;
            }

            _live.RefreshConfiguration();
            var live = _live.Snapshot;
            if (live.State == "running")
            {
                _autoStartPending = false;
                _autoStartTimer.Stop();
                _autoStartStatus = "";
                return;
            }
            if (live.State is "starting" or "stopping") return;

            if (live.SourceId == "potplayer" && !IsPotPlayerDetected())
            {
                _autoStartStatus = "等待 PotPlayer";
                TrayStateChanged?.Invoke();
                ScheduleSnapshotPush();
                return;
            }

            if (!live.CanStart || string.IsNullOrWhiteSpace(live.ModelId))
            {
                _autoStartStatus = "等待实时模型";
                TrayStateChanged?.Invoke();
                ScheduleSnapshotPush();
                return;
            }

            _autoStartStatus = "自动启动中";
            TrayStateChanged?.Invoke();
            ScheduleSnapshotPush();
            await _live.StartAsync(live.SourceId, live.ModelId);
            _coreState = _core.WorkerProcessId.HasValue ? "ready" : _coreState;
            _coreError = null;
            _autoStartPending = false;
            _autoStartStatus = "";
            _autoStartTimer.Stop();
            TrayStateChanged?.Invoke();
        }
        catch (Exception ex)
        {
            _coreError = ex.Message;
            if (_live.Snapshot.SourceId == "potplayer" && !IsPotPlayerDetected())
            {
                _autoStartStatus = "等待 PotPlayer";
            }
            else
            {
                _autoStartPending = false;
                _autoStartTimer.Stop();
                _autoStartStatus = "自动启动失败";
            }
            TrayStateChanged?.Invoke();
            ScheduleSnapshotPush();
        }
        finally
        {
            _autoStartBusy = false;
        }
    }

    async Task<object> UpdateSettingsAsync(JsonElement? parameters)
    {
        if (!parameters.HasValue || parameters.Value.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("设置参数无效。");

        var wasAutoStartPending = _autoStartPending;
        var p = parameters.Value;

        if (TryReadOptionalString(p, "audioSource", out var source))
            _settings.AudioSource = source switch
            {
                "potplayer" => AudioSourceMode.PotPlayer,
                "allAudio" => AudioSourceMode.AllAudio,
                _ => throw new InvalidOperationException("不支持的默认音源。")
            };

        if (TryReadOptionalString(p, "resourceProfile", out var profile))
            _settings.ResourceProfile = profile switch
            {
                "Eco" => ResourceProfile.Eco,
                "MaxPerformance" => ResourceProfile.MaxPerformance,
                "Auto" => ResourceProfile.Auto,
                _ => throw new InvalidOperationException("不支持的资源策略。")
            };

        if (TryReadOptionalBool(p, "minimizeToTray", out var minimizeToTray)) _settings.MinimizeToTray = minimizeToTray;
        if (TryReadOptionalBool(p, "startWithWindows", out var startWithWindows)) _settings.StartWithWindows = startWithWindows;
        if (TryReadOptionalBool(p, "silentStartup", out var silentStartup)) _settings.SilentStartup = silentStartup;
        if (TryReadOptionalBool(p, "autoStartLive", out var autoStartLive)) _settings.AutoStartLive = autoStartLive;
        if (TryReadOptionalBool(p, "showLiveLevelHistory", out var showHistory)) _settings.ShowLiveLevelHistory = showHistory;
        if (TryReadOptionalBool(p, "subtitleAutoSize", out var autoSize)) _settings.SubtitleAutoSize = autoSize;

        if (TryReadOptionalInt(p, "subtitleFontSize", out var fontSize)) _settings.SubtitleFontSize = Math.Clamp(fontSize, 20, 52);
        if (TryReadOptionalInt(p, "subtitleAutoScalePercent", out var autoScale)) _settings.SubtitleAutoScalePercent = Math.Clamp(autoScale, 60, 160);
        if (TryReadOptionalInt(p, "subtitleBottomOffset", out var bottomOffset)) _settings.SubtitleBottomOffset = Math.Clamp(bottomOffset, 0, 300);
        if (TryReadOptionalInt(p, "subtitleMaxWidthPercent", out var maxWidth)) _settings.SubtitleMaxWidthPercent = Math.Clamp(maxWidth, 50, 100);
        if (TryReadOptionalInt(p, "subtitleBackgroundOpacity", out var backgroundOpacity)) _settings.SubtitleBackgroundOpacity = Math.Clamp(backgroundOpacity, 0, 70);
        if (TryReadOptionalInt(p, "subtitlePreviousScalePercent", out var previousScale)) _settings.SubtitlePreviousScalePercent = Math.Clamp(previousScale, 40, 100);
        if (TryReadOptionalInt(p, "subtitlePreviousOpacity", out var previousOpacity)) _settings.SubtitlePreviousOpacity = Math.Clamp(previousOpacity, 0, 100);
        if (TryReadOptionalInt(p, "subtitleShadowOpacity", out var shadowOpacity)) _settings.SubtitleShadowOpacity = Math.Clamp(shadowOpacity, 0, 100);

        if (TryReadOptionalDouble(p, "subtitleDisplaySeconds", out var seconds)) _settings.SubtitleDisplaySeconds = Math.Clamp(seconds, 1.0, 10.0);
        if (TryReadOptionalDouble(p, "subtitleOutlineWidth", out var outlineWidth)) _settings.SubtitleOutlineWidth = Math.Clamp(outlineWidth, 0.0, 4.0);

        if (TryReadOptionalString(p, "subtitleBackground", out var background))
            _settings.SubtitleBackground = background switch
            {
                "Light" => SubtitleBackgroundMode.Light,
                "Dark" => SubtitleBackgroundMode.Dark,
                "None" => SubtitleBackgroundMode.None,
                _ => throw new InvalidOperationException("不支持的字幕背景。")
            };

        if (TryReadOptionalString(p, "subtitleCurrentColor", out var currentColor)) _settings.SubtitleCurrentColor = currentColor;
        if (TryReadOptionalString(p, "subtitlePreviousColor", out var previousColor)) _settings.SubtitlePreviousColor = previousColor;
        if (TryReadOptionalString(p, "subtitleOutlineColor", out var outlineColor)) _settings.SubtitleOutlineColor = outlineColor;

        if (_smoke)
            return BuildSnapshot();

        _settings.Save();
        StartupRegistrationService.Apply(_settings);
        _live.RefreshConfiguration();
        _models.Refresh();
        await _live.ApplySettingsAsync(preview: false);

        if (!_settings.AutoStartLive)
        {
            _autoStartPending = false;
            _autoStartStatus = "";
            _autoStartTimer.Stop();
        }
        else if (wasAutoStartPending)
        {
            _autoStartPending = true;
            _autoStartStatus = _live.Snapshot.SourceId == "potplayer" && !IsPotPlayerDetected() ? "等待 PotPlayer" : "等待自动启动";
            _autoStartTimer.Start();
        }

        TrayStateChanged?.Invoke();
        return BuildSnapshot();
    }

    async Task<object> PreviewSubtitleAsync()
    {
        await _live.ApplySettingsAsync(preview: true);
        return BuildSnapshot();
    }

    async Task<object> StartLiveAsync(JsonElement? parameters)
    {
        if (!TryReadString(parameters, "source", out var source))
            throw new InvalidOperationException("请选择实时音源。");
        if (!TryReadString(parameters, "modelId", out var modelId))
            throw new InvalidOperationException("请选择实时识别模型。");

        _autoStartPending = false;
        _autoStartTimer.Stop();
        await _live.StartAsync(source, modelId);
        _coreState = _core.WorkerProcessId.HasValue ? "ready" : _coreState;
        _coreError = null;
        return BuildSnapshot();
    }

    async Task<object> StopLiveAsync()
    {
        _autoStartPending = false;
        _autoStartTimer.Stop();
        await _live.StopAsync();
        TrayStateChanged?.Invoke();
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

    async Task<object> DownloadModelAsync(JsonElement? parameters)
    {
        if (!TryReadString(parameters, "modelId", out var modelId))
            throw new InvalidOperationException("请选择要下载的模型。");

        await _models.DownloadAsync(modelId);
        _live.RefreshConfiguration();
        _coreState = _core.WorkerProcessId.HasValue ? "ready" : _coreState;
        _coreError = null;
        return BuildSnapshot();
    }

    async Task<object> RepairModelAsync(JsonElement? parameters)
    {
        if (!TryReadString(parameters, "modelId", out var modelId))
            throw new InvalidOperationException("请选择要修复的模型。");

        await _models.RepairAsync(modelId);
        _live.RefreshConfiguration();
        _coreState = _core.WorkerProcessId.HasValue ? "ready" : _coreState;
        _coreError = null;
        return BuildSnapshot();
    }

    object CancelModel()
    {
        _models.Cancel();
        return BuildSnapshot();
    }

    async Task<object> DeleteModelAsync(JsonElement? parameters)
    {
        if (!TryReadString(parameters, "modelId", out var modelId))
            throw new InvalidOperationException("请选择要删除的模型。");

        await _models.DeleteAsync(modelId);
        _live.RefreshConfiguration();
        _coreState = _core.WorkerProcessId.HasValue ? "ready" : _coreState;
        _coreError = null;
        return BuildSnapshot();
    }

    object PickBatchFiles()
    {
        if (_smoke) return BuildSnapshot();

        using var dialog = new OpenFileDialog
        {
            Multiselect = true,
            Filter = "媒体文件|*.mp4;*.mkv;*.mov;*.avi;*.m4v;*.webm;*.mp3;*.m4a;*.aac;*.flac;*.wav;*.wma;*.ts;*.m2ts|所有文件|*.*",
            Title = "选择要后台转写的媒体"
        };
        if (dialog.ShowDialog(this) == DialogResult.OK)
            _batch.AddFiles(dialog.FileNames);
        return BuildSnapshot();
    }

    async Task<object> AnalyzeBatchAsync(JsonElement? parameters)
    {
        if (_smoke) return BuildSnapshot();
        EnsureBatchCoreAvailable(requireModel: false);
        TryReadString(parameters, "id", out var id);
        await _batch.SelectAndAnalyzeAsync(id);
        _coreState = _core.WorkerProcessId.HasValue ? "ready" : _coreState;
        _coreError = null;
        return BuildSnapshot();
    }

    async Task<object> TranscribeBatchAsync(JsonElement? parameters)
    {
        if (_smoke) return BuildSnapshot();
        EnsureBatchCoreAvailable(requireModel: true);
        TryReadString(parameters, "id", out var id);
        var keywords = ReadStringArray(parameters, "keywords");
        PersistBatchKeywords(keywords);
        EnsureBatchOutputWritable();
        var models = _models.Snapshot;
        await _batch.TranscribeAsync(id, models.BatchModelId, keywords);
        _coreState = _core.WorkerProcessId.HasValue ? "ready" : _coreState;
        _coreError = null;
        return BuildSnapshot();
    }

    async Task<object> TranscribeAllBatchAsync(JsonElement? parameters)
    {
        if (_smoke) return BuildSnapshot();
        EnsureBatchCoreAvailable(requireModel: true);
        var keywords = ReadStringArray(parameters, "keywords");
        PersistBatchKeywords(keywords);
        EnsureBatchOutputWritable();
        var models = _models.Snapshot;
        await _batch.TranscribeAllAsync(models.BatchModelId, keywords);
        _coreState = _core.WorkerProcessId.HasValue ? "ready" : _coreState;
        _coreError = null;
        return BuildSnapshot();
    }

    async Task<object> RetryBatchAsync(JsonElement? parameters)
    {
        if (_smoke) return BuildSnapshot();
        EnsureBatchCoreAvailable(requireModel: true);
        TryReadString(parameters, "id", out var id);
        var keywords = ReadStringArray(parameters, "keywords");
        PersistBatchKeywords(keywords);
        EnsureBatchOutputWritable();
        var models = _models.Snapshot;
        await _batch.RetryAsync(id, models.BatchModelId, keywords);
        _coreState = _core.WorkerProcessId.HasValue ? "ready" : _coreState;
        _coreError = null;
        return BuildSnapshot();
    }

    object PickBatchOutputDirectory()
    {
        if (_smoke) return BuildSnapshot();
        using var dialog = new FolderBrowserDialog
        {
            Description = "选择后台转写结果默认输出目录",
            ShowNewFolderButton = true,
            UseDescriptionForTitle = true,
            InitialDirectory = AppSettings.Load().ResolvedBatchOutputDirectory
        };
        if (dialog.ShowDialog(this) != DialogResult.OK || string.IsNullOrWhiteSpace(dialog.SelectedPath))
            return BuildSnapshot();

        var latest = AppSettings.Load();
        latest.BatchOutputDirectory = Path.GetFullPath(dialog.SelectedPath);
        latest.Save();
        _settings.BatchOutputDirectory = latest.BatchOutputDirectory;
        EnsureBatchOutputWritable();
        return BuildSnapshot();
    }

    object ExportBatch(JsonElement? parameters)
    {
        if (_smoke) return BuildSnapshot();
        TryReadString(parameters, "id", out var id);
        TryReadString(parameters, "format", out var format);
        format = (format ?? "srt").Trim().ToLowerInvariant();
        if (format is not ("txt" or "srt" or "vtt"))
            throw new InvalidOperationException("不支持的导出格式。");

        var result = _batch.GetResult(id, out var suggestedFileName);
        var baseName = Path.GetFileNameWithoutExtension(suggestedFileName);
        var outputDir = AppSettings.Load().ResolvedBatchOutputDirectory;
        Directory.CreateDirectory(outputDir);
        using var dialog = new SaveFileDialog
        {
            InitialDirectory = outputDir,
            Filter = format switch
            {
                "srt" => "SRT 字幕|*.srt|所有文件|*.*",
                "vtt" => "WebVTT 字幕|*.vtt|所有文件|*.*",
                _ => "文本文件|*.txt|所有文件|*.*"
            },
            FileName = baseName + "." + format,
            DefaultExt = format,
            AddExtension = true,
            OverwritePrompt = true,
            Title = "导出转写结果"
        };
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            TranscriptPersistenceService.ExportByExtension(dialog.FileName, result.Items);
            _batch.MarkExported(Path.GetFileName(dialog.FileName));
        }
        return BuildSnapshot();
    }

    object ExportAllBatch()
    {
        if (_smoke) return BuildSnapshot();
        EnsureBatchOutputWritable();
        var outputDir = AppSettings.Load().ResolvedBatchOutputDirectory;
        _batch.ExportAllCompleted(outputDir);
        return BuildSnapshot();
    }

    object OpenBatchOutputDirectory()
    {
        if (_smoke) return BuildSnapshot();
        var outputDir = AppSettings.Load().ResolvedBatchOutputDirectory;
        Directory.CreateDirectory(outputDir);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{outputDir}\"") { UseShellExecute = true });
        return BuildSnapshot();
    }

    object RemoveBatch(JsonElement? parameters)
    {
        if (_smoke) return BuildSnapshot();
        TryReadString(parameters, "id", out var id);
        _batch.Remove(id);
        return BuildSnapshot();
    }

    object ClearBatch()
    {
        if (_smoke) return BuildSnapshot();
        _batch.Clear();
        return BuildSnapshot();
    }

    object ExportBatchTxt(JsonElement? parameters)
    {
        if (_smoke) return BuildSnapshot();
        TryReadString(parameters, "id", out var id);
        var result = _batch.GetResult(id, out var suggestedFileName);

        using var dialog = new SaveFileDialog
        {
            Filter = "文本文件|*.txt|所有文件|*.*",
            FileName = suggestedFileName,
            DefaultExt = "txt",
            AddExtension = true,
            OverwritePrompt = true,
            Title = "导出转写文本"
        };
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            TranscriptPersistenceService.ExportTxt(dialog.FileName, result.Items, includeTime: true);
            _batch.MarkExported(Path.GetFileName(dialog.FileName));
        }
        return BuildSnapshot();
    }

    void PersistBatchKeywords(IEnumerable<string> keywords)
    {
        var normalized = string.Join(", ", keywords.Take(32));
        if (string.Equals(_settings.Keywords, normalized, StringComparison.Ordinal)) return;

        var latest = AppSettings.Load();
        latest.Keywords = normalized;
        latest.Save();
        _settings.Keywords = normalized;
    }

    void EnsureBatchOutputWritable()
    {
        var outputDir = AppSettings.Load().ResolvedBatchOutputDirectory;
        Directory.CreateDirectory(outputDir);
        var probe = Path.Combine(outputDir, ".localsub-write-probe-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            File.WriteAllText(probe, "LocalSub");
            File.Delete(probe);
            var root = Path.GetPathRoot(Path.GetFullPath(outputDir));
            if (!string.IsNullOrWhiteSpace(root))
            {
                var drive = new DriveInfo(root);
                if (drive.IsReady && drive.AvailableFreeSpace < 64L * 1024 * 1024)
                    throw new IOException("输出磁盘剩余空间不足 64 MB，请更换输出目录。");
            }
        }
        catch
        {
            try { if (File.Exists(probe)) File.Delete(probe); } catch { }
            throw;
        }
    }

    object CancelBatch()
    {
        _batch.Cancel();
        return BuildSnapshot();
    }

    void EnsureBatchCoreAvailable(bool requireModel)
    {
        var live = _live.Snapshot;
        if (live.State is "starting" or "running" or "stopping")
            throw new InvalidOperationException("实时字幕运行时不能启动后台媒体任务，请先停止实时字幕。");
        if (_models.Snapshot.Operation.State == "running")
            throw new InvalidOperationException("模型任务正在运行，请等待完成后再开始后台转写。");
        if (!requireModel) return;

        var models = _models.Snapshot;
        var selected = models.Catalog.FirstOrDefault(x => string.Equals(x.Id, models.BatchModelId, StringComparison.OrdinalIgnoreCase));
        if (selected == null || !selected.Installed || !selected.BatchCapable)
            throw new InvalidOperationException("默认后台模型不可用，请先在模型页安装并选择后台模型。");
    }

    async Task<object> BuildSnapshotAsync(bool probeCore)
    {
        if (probeCore) await ProbeCoreAsync();
        return BuildSnapshot();
    }

    object BuildSnapshot()
    {
        var live = _live.Snapshot;
        var models = _models.Snapshot;
        var modelBusy = models.Operation.State == "running";
        var batchBusy = _batch.IsBusy;
        var busy = live.State is "starting" or "stopping" || modelBusy || batchBusy;
        var operation = live.State is "starting" or "running" or "stopping"
            ? "realtime"
            : batchBusy && !string.IsNullOrWhiteSpace(_batch.OperationKind)
                ? "batch." + _batch.OperationKind
                : modelBusy && !string.IsNullOrWhiteSpace(models.Operation.Kind)
                    ? "model." + models.Operation.Kind
                    : null;
        var coreState = (modelBusy || batchBusy) && _core.WorkerProcessId.HasValue ? "busy" : _coreState;

        return new
        {
            app = new
            {
                productVersion = typeof(WebShellForm).Assembly.GetName().Version?.ToString(3) ?? "0.1.1",
                activePage = _activePage,
                busy,
                lastError = live.LastError ?? models.Operation.LastError ?? _batch.LastError
            },
            core = new
            {
                state = coreState,
                pid = _core.WorkerProcessId,
                generation = _core.ConnectionGeneration,
                currentOperation = operation,
                lastError = _coreError
            },
            live,
            batch = _batch.BuildSnapshot(
                models.BatchModelId,
                models.BatchModelName,
                _settings.Keywords,
                BatchOutputDirectoryDisplayName(),
                !string.IsNullOrWhiteSpace(_settings.BatchOutputDirectory)),
            models,
            settings = new
            {
                audioSource = live.Source,
                audioSourceId = _settings.AudioSource == AudioSourceMode.PotPlayer ? "potplayer" : "allAudio",
                resourceProfile = _settings.ResourceProfile.ToString(),
                minimizeToTray = _settings.MinimizeToTray,
                startWithWindows = _settings.StartWithWindows,
                startupRegistered = StartupRegistrationService.IsRegistered(),
                silentStartup = _settings.SilentStartup,
                autoStartLive = _settings.AutoStartLive,
                showLiveLevelHistory = _settings.ShowLiveLevelHistory,
                subtitleAutoSize = _settings.SubtitleAutoSize,
                subtitleFontSize = _settings.SubtitleFontSize,
                subtitleAutoScalePercent = _settings.SubtitleAutoScalePercent,
                subtitleBottomOffset = _settings.SubtitleBottomOffset,
                subtitleMaxWidthPercent = _settings.SubtitleMaxWidthPercent,
                subtitleBackground = _settings.SubtitleBackground.ToString(),
                subtitleBackgroundOpacity = _settings.SubtitleBackgroundOpacity,
                subtitleDisplaySeconds = _settings.SubtitleDisplaySeconds,
                subtitleCurrentColor = _settings.SubtitleCurrentColor,
                subtitlePreviousColor = _settings.SubtitlePreviousColor,
                subtitlePreviousScalePercent = _settings.SubtitlePreviousScalePercent,
                subtitlePreviousOpacity = _settings.SubtitlePreviousOpacity,
                subtitleOutlineColor = _settings.SubtitleOutlineColor,
                subtitleOutlineWidth = _settings.SubtitleOutlineWidth,
                subtitleShadowOpacity = _settings.SubtitleShadowOpacity
            },
            system = new
            {
                potPlayerDetected = IsPotPlayerDetected(),
                autoStartPending = _autoStartPending,
                autoStartStatus = _autoStartStatus
            }
        };
    }

    string BatchOutputDirectoryDisplayName()
    {
        var current = AppSettings.Load();
        _settings.BatchOutputDirectory = current.BatchOutputDirectory;
        if (string.IsNullOrWhiteSpace(current.BatchOutputDirectory))
            return "LocalSub / Transcripts";
        var full = current.ResolvedBatchOutputDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var name = Path.GetFileName(full);
        return string.IsNullOrWhiteSpace(name) ? full : name;
    }

    async Task ProbeCoreAsync()
    {
        if (_models.Snapshot.Operation.State == "running" || _batch.IsBusy)
        {
            _coreState = _core.WorkerProcessId.HasValue ? "ready" : "starting";
            _coreError = null;
            return;
        }

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

        TrayStateChanged?.Invoke();
        ScheduleSnapshotPush();
    }

    void OnLiveLevelChanged(float value)
    {
        _latestLiveLevel = Math.Clamp(value, 0, 1);
        RecordWebMeterEvent(_latestLiveLevel);
        if (_disposed) return;
        if (Interlocked.Exchange(ref _levelPushPending, 1) != 0) return;

        try
        {
            BeginInvoke(new Action(() =>
            {
                Interlocked.Exchange(ref _levelPushPending, 0);
                if (_disposed || _web.CoreWebView2 == null) return;
                PostEvent("live.level", new { value = _latestLiveLevel });
            }));
        }
        catch
        {
            Interlocked.Exchange(ref _levelPushPending, 0);
        }
    }

    void RecordWebMeterEvent(float value)
    {
        var now = Environment.TickCount64;
        if (_meterWindowStarted == 0) _meterWindowStarted = now;
        _meterEventCount++;
        _meterMin = Math.Min(_meterMin, value);
        _meterMax = Math.Max(_meterMax, value);
        if (now - _meterWindowStarted < 1000) return;

        try
        {
            PortablePaths.EnsureBaseFolders();
            File.AppendAllText(
                Path.Combine(PortablePaths.LogsDir, "meter-web.log"),
                $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] events={_meterEventCount} min={_meterMin:0.0000} max={_meterMax:0.0000}{Environment.NewLine}");
        }
        catch { }

        _meterWindowStarted = now;
        _meterEventCount = 0;
        _meterMin = 1f;
        _meterMax = 0f;
    }

    void OnBatchChanged()
    {
        if (_batch.IsBusy && _core.WorkerProcessId.HasValue)
        {
            _coreState = "busy";
            _coreError = null;
        }
        ScheduleSnapshotPush();
    }

    void OnModelsChanged()
    {
        var models = _models.Snapshot;
        if (models.Operation.State == "running" && _core.WorkerProcessId.HasValue)
        {
            _coreState = "ready";
            _coreError = null;
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
        if (_disposed) return;
        if (Interlocked.Exchange(ref _snapshotPushPending, 1) != 0) return;

        try
        {
            BeginInvoke(new Action(() =>
            {
                Interlocked.Exchange(ref _snapshotPushPending, 0);
                if (_disposed || _web.CoreWebView2 == null) return;
                PostEvent("app.snapshot", BuildSnapshot());
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
            !_smokeMethods.Contains("settings.update") ||
            !_smokeMethods.Contains("live.stop") ||
            !_smokeMethods.Contains("live.start") ||
            !_smokeMethods.Contains("model.list") ||
            !_smokeMethods.Contains("model.select") ||
            !_smokeMethods.Contains("model.download") ||
            !_smokeMethods.Contains("model.cancel") ||
            !_smokeMethods.Contains("model.delete") ||
            !_smokeMethods.Contains("batch.pickFiles") ||
            !_smokeMethods.Contains("batch.analyze") ||
            !_smokeMethods.Contains("batch.transcribe") ||
            !_smokeMethods.Contains("batch.transcribeAll") ||
            !_smokeMethods.Contains("batch.remove") ||
            !_smokeMethods.Contains("batch.clear") ||
            !_smokeMethods.Contains("batch.exportTxt") ||
            !_smokeMethods.Contains("batch.cancel") ||
            !_smokeMethods.Contains("diagnostics.liveLevelAck")) return;

        Directory.CreateDirectory(PortablePaths.LogsDir);
        File.WriteAllText(
            Path.Combine(PortablePaths.LogsDir, "webui-smoke-ready.txt"),
            $"webview2=ready{Environment.NewLine}bridge=app.getSnapshot{Environment.NewLine}bridge=settings.update{Environment.NewLine}bridge=live.stop{Environment.NewLine}bridge=live.start{Environment.NewLine}bridge=model.list{Environment.NewLine}bridge=model.select{Environment.NewLine}bridge=model.download{Environment.NewLine}bridge=model.cancel{Environment.NewLine}bridge=model.delete{Environment.NewLine}bridge=batch.pickFiles{Environment.NewLine}bridge=batch.analyze{Environment.NewLine}bridge=batch.transcribe{Environment.NewLine}bridge=batch.transcribeAll{Environment.NewLine}bridge=batch.remove{Environment.NewLine}bridge=batch.clear{Environment.NewLine}bridge=batch.exportTxt{Environment.NewLine}bridge=batch.cancel{Environment.NewLine}bridge=diagnostics.liveLevelAck{Environment.NewLine}");
    }

    static bool IsPotPlayerDetected()
    {
        try
        {
            using var process = PotPlayerWatcher.FindRunning();
            return process != null;
        }
        catch
        {
            return false;
        }
    }

    static bool TryReadOptionalString(JsonElement parameters, string propertyName, out string value)
    {
        value = "";
        if (!parameters.TryGetProperty(propertyName, out var node)) return false;
        if (node.ValueKind != JsonValueKind.String)
            throw new InvalidOperationException($"设置 {propertyName} 必须是字符串。");
        value = node.GetString()?.Trim() ?? "";
        return true;
    }

    static bool TryReadOptionalBool(JsonElement parameters, string propertyName, out bool value)
    {
        value = false;
        if (!parameters.TryGetProperty(propertyName, out var node)) return false;
        if (node.ValueKind is not JsonValueKind.True and not JsonValueKind.False)
            throw new InvalidOperationException($"设置 {propertyName} 必须是布尔值。");
        value = node.GetBoolean();
        return true;
    }

    static bool TryReadOptionalInt(JsonElement parameters, string propertyName, out int value)
    {
        value = 0;
        if (!parameters.TryGetProperty(propertyName, out var node)) return false;
        if (node.ValueKind != JsonValueKind.Number || !node.TryGetInt32(out value))
            throw new InvalidOperationException($"设置 {propertyName} 必须是整数。");
        return true;
    }

    static bool TryReadOptionalDouble(JsonElement parameters, string propertyName, out double value)
    {
        value = 0;
        if (!parameters.TryGetProperty(propertyName, out var node)) return false;
        if (node.ValueKind != JsonValueKind.Number || !node.TryGetDouble(out value))
            throw new InvalidOperationException($"设置 {propertyName} 必须是数字。");
        return true;
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

    static string[] ReadStringArray(JsonElement? parameters, string propertyName)
    {
        if (!parameters.HasValue ||
            parameters.Value.ValueKind != JsonValueKind.Object ||
            !parameters.Value.TryGetProperty(propertyName, out var node) ||
            node.ValueKind != JsonValueKind.Array)
            return [];

        return node.EnumerateArray()
            .Where(x => x.ValueKind == JsonValueKind.String)
            .Select(x => x.GetString()?.Trim() ?? "")
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(32)
            .ToArray();
    }

    async Task DisposeOwnedResourcesAsync()
    {
        if (_disposed) return;
        _disposed = true;

        _live.Changed -= OnLiveChanged;
        _live.LevelChanged -= OnLiveLevelChanged;
        _models.Changed -= OnModelsChanged;
        _batch.Changed -= OnBatchChanged;
        _core.ConnectionBroken -= OnCoreConnectionBroken;
        _autoStartTimer.Stop();
        _autoStartTimer.Dispose();
        try { _models.Dispose(); } catch { }
        try { _batch.Dispose(); } catch { }
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
