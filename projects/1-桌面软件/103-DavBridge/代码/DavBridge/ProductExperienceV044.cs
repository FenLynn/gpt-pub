using System.IO.Compression;
using System.Reflection;
using System.Text.Json;
using DavBridge.Core;
using Microsoft.Web.WebView2.Core;

namespace DavBridge;

internal sealed record ProductActivityV044(DateTimeOffset At, string Title, string Detail, string Tone);
internal sealed record InitializationStepV044(string Key, string Label, bool Done, string Hint);
internal sealed record StartupHealthItemV044(string Key, string Label, string Status, string Detail);

internal sealed record StartupHealthReportV044(DateTimeOffset? CheckedAt, IReadOnlyList<StartupHealthItemV044> Items)
{
    public string Status =>
        CheckedAt is null ? "not_checked" :
        Items.Any(item => item.Status == "error") ? "error" :
        Items.Any(item => item.Status == "warning") ? "warning" : "ok";

    public string Summary => Status switch
    {
        "not_checked" => "尚未执行运行环境自检",
        "error" => $"发现 {Items.Count(item => item.Status == "error")} 个阻塞项",
        "warning" => $"运行正常，但有 {Items.Count(item => item.Status == "warning")} 项需要注意",
        _ => "运行依赖、Data 目录与状态文件正常"
    };

    public static StartupHealthReportV044 NotChecked { get; } =
        new(null, Array.Empty<StartupHealthItemV044>());
}

internal static class BuildInfoV044
{
    private static readonly Assembly Assembly = typeof(BuildInfoV044).Assembly;
    private static readonly IReadOnlyDictionary<string, string> Metadata = Assembly
        .GetCustomAttributes<AssemblyMetadataAttribute>()
        .GroupBy(item => item.Key, StringComparer.OrdinalIgnoreCase)
        .ToDictionary(group => group.Key, group => group.Last().Value ?? string.Empty, StringComparer.OrdinalIgnoreCase);

    public static string Version => Assembly.GetName().Version?.ToString(3) ?? "0.4.4";
    public static string Commit => Metadata.TryGetValue("DavBridgeCommit", out var value) && !string.IsNullOrWhiteSpace(value) ? value : "local";
    public static string ShortCommit => Commit.Length >= 8 ? Commit[..8] : Commit;
    public static string BuildUtc => Metadata.TryGetValue("DavBridgeBuildUtc", out var value) ? value : string.Empty;
}

internal static class StartupHealthV044
{
    public static string? GetFatalPreflightIssue()
    {
        try
        {
            var version = CoreWebView2Environment.GetAvailableBrowserVersionString();
            return string.IsNullOrWhiteSpace(version)
                ? "Microsoft Edge WebView2 Runtime 未安装或不可用。\r\n\r\nDavBridge 的界面需要 WebView2。请安装或修复 Microsoft Edge WebView2 Runtime 后重新启动。"
                : null;
        }
        catch
        {
            return "Microsoft Edge WebView2 Runtime 未安装或损坏。\r\n\r\nDavBridge 的界面需要 WebView2。请安装或修复 Microsoft Edge WebView2 Runtime 后重新启动。";
        }
    }

    public static async Task<StartupHealthReportV044> CheckAsync(AppHost host, CancellationToken cancellationToken = default)
    {
        var items = new List<StartupHealthItemV044>
        {
            new("windows", "Windows", OperatingSystem.IsWindows() ? "ok" : "error", OperatingSystem.IsWindows() ? Environment.OSVersion.VersionString : "当前系统不是 Windows"),
            new("dotnet", ".NET", Environment.Version.Major >= 8 ? "ok" : "error", $".NET {Environment.Version}"),
            CheckWebView2(),
            ProbeDirectory(host.Paths.RoamingRoot, "Roaming Data"),
            ProbeDirectory(host.Paths.LocalRoot, "Local Data"),
            CheckJsonFile(host.Paths.ConfigPath, "config.json"),
            CheckJsonFile(host.Paths.StatePath, "state.json"),
            CheckJsonFile(Path.Combine(host.Paths.RoamingRoot, "reconcile.json"), "reconcile.json")
        };

        try
        {
            var credentials = await host.GetCredentialStatusAsync(cancellationToken).ConfigureAwait(false);
            var text = credentials.SourceSaved || credentials.TargetSaved ? "DPAPI 受保护凭据可读取" : "尚未保存 WebDAV 凭据";
            items.Add(new StartupHealthItemV044("dpapi", "受保护凭据", "ok", text));
        }
        catch
        {
            items.Add(new StartupHealthItemV044("dpapi", "受保护凭据", "error", "DPAPI 凭据读取失败"));
        }

        return new StartupHealthReportV044(DateTimeOffset.Now, items);
    }

    private static StartupHealthItemV044 CheckWebView2()
    {
        try
        {
            var version = CoreWebView2Environment.GetAvailableBrowserVersionString();
            return string.IsNullOrWhiteSpace(version)
                ? new("webview2", "WebView2", "error", "运行时不可用")
                : new("webview2", "WebView2", "ok", version);
        }
        catch
        {
            return new("webview2", "WebView2", "error", "运行时不可用");
        }
    }

    private static StartupHealthItemV044 ProbeDirectory(string path, string label)
    {
        try
        {
            Directory.CreateDirectory(path);
            var probe = Path.Combine(path, ".davbridge-health-" + Guid.NewGuid().ToString("N") + ".tmp");
            using (var stream = new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                stream.WriteByte(1);
                stream.Flush(true);
            }
            File.Delete(probe);
            return new(label.ToLowerInvariant().Replace(" ", "-"), label, "ok", "目录可读写");
        }
        catch
        {
            return new(label.ToLowerInvariant().Replace(" ", "-"), label, "error", "目录不可写");
        }
    }

    private static StartupHealthItemV044 CheckJsonFile(string path, string label)
    {
        if (!File.Exists(path))
            return new("json-" + label, label, "ok", "尚未创建");

        if (IsValidJson(path))
            return new("json-" + label, label, "ok", "主文件可读取");

        var backup = path + ".bak";
        if (File.Exists(backup) && IsValidJson(backup))
            return new("json-" + label, label, "warning", "主文件异常，但 .bak 可恢复");

        return new("json-" + label, label, "error", "主文件不可解析且没有可用 .bak");
    }

    private static bool IsValidJson(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            using var _ = JsonDocument.Parse(stream);
            return true;
        }
        catch { return false; }
    }
}

internal static class ProductExperienceV044
{
    private sealed class ProductState
    {
        public int SchemaVersion { get; set; } = 1;
        public DateTimeOffset? ConnectionDiagnosticPassedAt { get; set; }
        public DateTimeOffset? ReadinessScanPassedAt { get; set; }
        public string? LastObservedCycleId { get; set; }
        public string? LastEngineState { get; set; }
        public List<ProductActivityV044> Activities { get; set; } = new();
    }

    private static readonly object Gate = new();
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true, PropertyNameCaseInsensitive = true };
    private static string? _path;
    private static ProductState _state = new();

    public static StartupHealthReportV044 Health { get; private set; } = StartupHealthReportV044.NotChecked;
    public static bool ConnectionDiagnosticPassed { get { lock (Gate) return _state.ConnectionDiagnosticPassedAt.HasValue; } }
    public static bool ReadinessScanPassed { get { lock (Gate) return _state.ReadinessScanPassedAt.HasValue; } }

    public static void Initialize(string localRoot)
    {
        lock (Gate)
        {
            var nextPath = Path.Combine(localRoot, "product-experience.json");
            if (string.Equals(_path, nextPath, StringComparison.OrdinalIgnoreCase)) return;
            _path = nextPath;
            Directory.CreateDirectory(localRoot);
            _state = Load(nextPath);
        }
    }

    public static void SetHealth(StartupHealthReportV044 report) => Health = report;

    public static IReadOnlyList<ProductActivityV044> RecentActivities(int max = 30)
    {
        lock (Gate)
            return _state.Activities.OrderByDescending(item => item.At).Take(Math.Max(1, max)).ToArray();
    }

    public static void Record(string title, string detail, string tone = "info")
    {
        lock (Gate)
        {
            var safeTone = tone is "success" or "warning" ? tone : "info";
            _state.Activities.Add(new ProductActivityV044(DateTimeOffset.Now, Clip(title, 64), Clip(detail.Replace('\r', ' ').Replace('\n', ' '), 220), safeTone));
            TrimActivities();
            SaveLocked();
        }
    }

    public static void RecordEngineState(EngineState state)
    {
        lock (Gate)
        {
            var value = state.ToString();
            if (string.Equals(_state.LastEngineState, value, StringComparison.Ordinal)) return;
            _state.LastEngineState = value;
            var (title, detail, tone) = state switch
            {
                EngineState.Running => ("迁移运行中", "DavBridge 正在执行安全调度队列。", "info"),
                EngineState.Paused => ("迁移已暂停", "进度和本周期账本保持不变。", "info"),
                EngineState.WaitNetwork => ("等待网络", "网络恢复后可继续当前任务。", "warning"),
                EngineState.WaitQuota => ("等待额度", "当前安全额度不足，等待下一次允许的周期动作。", "info"),
                EngineState.WaitRetry => ("等待重试", "任务已安全停止，需要重试或进一步检查。", "warning"),
                EngineState.WaitUser => ("等待人工审查", "回收站存在需要明确决定的附件组。", "warning"),
                EngineState.Complete => ("当前清单完成", "当前源清单已经完成安全处理。", "success"),
                _ => ("状态更新", "DavBridge 运行状态已更新。", "info")
            };
            _state.Activities.Add(new ProductActivityV044(DateTimeOffset.Now, title, detail, tone));
            TrimActivities();
            SaveLocked();
        }
    }

    public static void ObserveCycle(string? cycleId)
    {
        if (string.IsNullOrWhiteSpace(cycleId)) return;
        lock (Gate)
        {
            if (string.Equals(_state.LastObservedCycleId, cycleId, StringComparison.OrdinalIgnoreCase)) return;
            var hadPrevious = !string.IsNullOrWhiteSpace(_state.LastObservedCycleId);
            _state.LastObservedCycleId = cycleId;
            if (hadPrevious)
                _state.Activities.Add(new ProductActivityV044(DateTimeOffset.Now, "进入新周期", $"Cycle {cycleId} 已确认。", "success"));
            TrimActivities();
            SaveLocked();
        }
    }

    public static void MarkConnectionDiagnostic(bool passed)
    {
        lock (Gate)
        {
            _state.ConnectionDiagnosticPassedAt = passed ? DateTimeOffset.Now : null;
            SaveLocked();
        }
    }

    public static void MarkReadinessScan(bool passed)
    {
        lock (Gate)
        {
            _state.ReadinessScanPassedAt = passed ? DateTimeOffset.Now : null;
            SaveLocked();
        }
    }

    public static void ResetInitializationChecks()
    {
        lock (Gate)
        {
            _state.ConnectionDiagnosticPassedAt = null;
            _state.ReadinessScanPassedAt = null;
            SaveLocked();
        }
    }

    public static IReadOnlyList<InitializationStepV044> BuildInitializationSteps(AppHost? host)
    {
        if (host is null)
            return DefaultInitializationSteps();

        var first = FirstGroupValidationRunner.HasCompletedZoteroValidation(host.State);
        var existing = host.State.ExistingReplicaValidationPassed;
        var legacyComplete = first && existing;
        return new[]
        {
            new InitializationStepV044("connection","连接",host.IsConfigured && (ConnectionDiagnosticPassed || legacyComplete),"源端与目标端配置完整，并通过连接诊断"),
            new InitializationStepV044("scan","扫描",ReadinessScanPassed || legacyComplete,"确认文件上限、Zotero 配对和迁移条件"),
            new InitializationStepV044("quota","流量",host.Config.NextResetAt != default,"校准当前周期上传、下载已用量与下一重置日期"),
            new InitializationStepV044("first","首组",first,"完成一个真实 Zotero 逻辑组的目标回读与 SHA-256 强校验"),
            new InitializationStepV044("existing","既有副本",existing,"确认既有副本可在 0 B 上传条件下安全接管")
        };
    }

    public static async Task<string?> ExportDiagnosticsAsync(Form owner, AppHost host, CancellationToken cancellationToken = default)
    {
        var health = await StartupHealthV044.CheckAsync(host, cancellationToken).ConfigureAwait(true);
        SetHealth(health);
        using var dialog = new SaveFileDialog
        {
            Title = "导出 DavBridge 脱敏诊断",
            Filter = "ZIP 压缩包 (*.zip)|*.zip",
            FileName = $"DavBridge-diagnostics-{DateTime.Now:yyyyMMdd-HHmm}.zip",
            AddExtension = true,
            DefaultExt = "zip",
            OverwritePrompt = true
        };
        if (dialog.ShowDialog(owner) != DialogResult.OK) return null;

        var quota = QuotaPolicy.GetSnapshot(host.Config, host.State, DateTimeOffset.Now);
        var reconcile = LoadReconciliation(host.Paths.RoamingRoot);
        var report = new
        {
            product = "DavBridge",
            version = BuildInfoV044.Version,
            buildCommit = BuildInfoV044.ShortCommit,
            buildUtc = BuildInfoV044.BuildUtc,
            generatedAt = DateTimeOffset.Now,
            runtime = new
            {
                windows = Environment.OSVersion.VersionString,
                dotnet = Environment.Version.ToString(),
                process64Bit = Environment.Is64BitProcess,
                webView2 = health.Items.FirstOrDefault(item => item.Key == "webview2")?.Detail ?? "unknown"
            },
            state = new
            {
                configured = host.IsConfigured,
                engineState = host.State.EngineState.ToString(),
                migrationEnabled = host.Config.MigrationEnabled,
                autoResume = host.Config.AutoResume,
                autoStart = host.Config.AutoStartWithWindows,
                startMinimized = host.Config.StartMinimized,
                cycleId = reconcile?.CurrentCycleId ?? ReconciliationPolicy.DeriveCurrentCycleId(host.Config.NextResetAt),
                nextResetDate = host.Config.NextResetAt == default ? null : host.Config.NextResetAt.ToString("yyyy-MM-dd"),
                uploadUsedBytes = quota.EstimatedUploadUsedBytes,
                uploadQuotaBytes = host.Config.UploadQuotaBytes,
                downloadUsedBytes = quota.EstimatedDownloadUsedBytes,
                downloadQuotaBytes = host.Config.DownloadQuotaBytes
            },
            recovery = new
            {
                configPrimary = File.Exists(host.Paths.ConfigPath),
                configBackup = File.Exists(host.Paths.ConfigPath + ".bak"),
                statePrimary = File.Exists(host.Paths.StatePath),
                stateBackup = File.Exists(host.Paths.StatePath + ".bak"),
                reconcilePrimary = File.Exists(Path.Combine(host.Paths.RoamingRoot, "reconcile.json")),
                reconcileBackup = File.Exists(Path.Combine(host.Paths.RoamingRoot, "reconcile.json.bak"))
            },
            health = new { status = health.Status, summary = health.Summary, items = health.Items },
            initialization = BuildInitializationSteps(host)
        };

        if (File.Exists(dialog.FileName)) File.Delete(dialog.FileName);
        using (var archive = ZipFile.Open(dialog.FileName, ZipArchiveMode.Create))
        {
            WriteJsonEntry(archive, "diagnostics.json", report);
            WriteJsonEntry(archive, "activity.json", RecentActivities());
            var readme = archive.CreateEntry("README.txt", CompressionLevel.Fastest);
            using var writer = new StreamWriter(readme.Open());
            writer.WriteLine("DavBridge 脱敏诊断包");
            writer.WriteLine("不包含密码、WebDAV 凭据、真实 Zotero 文件名、远端目录或本机私人路径。");
        }
        return dialog.FileName;
    }

    private static IReadOnlyList<InitializationStepV044> DefaultInitializationSteps() => new[]
    {
        new InitializationStepV044("connection","连接",false,"完成 WebDAV 配置并通过连接诊断"),
        new InitializationStepV044("scan","扫描",false,"执行迁移就绪扫描"),
        new InitializationStepV044("quota","流量",false,"校准当前坚果云流量周期"),
        new InitializationStepV044("first","首组",false,"完成一个真实 Zotero 逻辑组的双端强校验"),
        new InitializationStepV044("existing","既有副本",false,"验证既有目标副本可 NO-WRITE 接管")
    };

    private static ReconciliationState? LoadReconciliation(string roamingRoot)
    {
        foreach (var path in new[] { Path.Combine(roamingRoot, "reconcile.json"), Path.Combine(roamingRoot, "reconcile.json.bak") })
        {
            try
            {
                if (!File.Exists(path)) continue;
                var state = JsonSerializer.Deserialize<ReconciliationState>(File.ReadAllText(path), JsonOptions);
                if (state is not null) return state;
            }
            catch { }
        }
        return null;
    }

    private static void WriteJsonEntry(ZipArchive archive, string name, object value)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.Fastest);
        using var writer = new StreamWriter(entry.Open());
        writer.Write(JsonSerializer.Serialize(value, JsonOptions));
    }

    private static ProductState Load(string path)
    {
        try
        {
            if (!File.Exists(path)) return new ProductState();
            return JsonSerializer.Deserialize<ProductState>(File.ReadAllText(path), JsonOptions) ?? new ProductState();
        }
        catch { return new ProductState(); }
    }

    private static void TrimActivities()
    {
        _state.Activities = _state.Activities.OrderByDescending(item => item.At).Take(40).OrderBy(item => item.At).ToList();
    }

    private static void SaveLocked()
    {
        if (string.IsNullOrWhiteSpace(_path)) return;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            var temp = _path + ".tmp";
            var backup = _path + ".bak";
            File.WriteAllText(temp, JsonSerializer.Serialize(_state, JsonOptions));
            using (var stream = new FileStream(temp, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                stream.Flush(true);
            if (File.Exists(_path)) File.Copy(_path, backup, true);
            File.Move(temp, _path, true);
        }
        catch { }
    }

    private static string Clip(string value, int max) => value.Length <= max ? value : value[..max];
}
