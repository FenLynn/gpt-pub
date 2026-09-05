using System.Reflection;
using System.Text.Json;
using DavBridge.Core;

namespace DavBridge;

/// <summary>
/// v0.2.3 observational UI layer. It never changes migration state, quota accounting,
/// WebDAV requests, SHA-256 decisions, or persisted transfer records. Its only job is
/// to keep the dashboard visibly alive and to retry advisory source-manifest totals.
/// </summary>
internal sealed class UiLiveProgress : IDisposable
{
    private readonly MainForm _form;
    private readonly AppHost _host;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 320 };
    private readonly CancellationTokenSource _cts = new();

    private readonly Label? _overallPercent;
    private readonly MeterBar? _overallBar;
    private readonly Label? _overallGroups;
    private readonly Label? _overallFiles;
    private readonly MeterBar? _currentBar;
    private readonly Label? _currentPhase;

    private EngineProgress? _progress;
    private WebDavIoProgress? _io;
    private DateTimeOffset _progressAt = DateTimeOffset.MinValue;
    private DateTimeOffset _ioAt = DateTimeOffset.MinValue;
    private DateTimeOffset _lastVerifiedAt = DateTimeOffset.MinValue;
    private int _lastVerifiedGroups;
    private int _totalGroups;
    private int _totalFiles;
    private bool _manifestRefreshing;
    private DateTimeOffset _nextManifestAttempt = DateTimeOffset.MinValue;
    private bool _disposed;

    private UiLiveProgress(MainForm form, AppHost host, UiPolish polish)
    {
        _form = form;
        _host = host;

        _overallPercent = GetField<Label>(polish, "_overallPercent");
        _overallBar = GetField<MeterBar>(polish, "_overallBar");
        _overallGroups = GetField<Label>(polish, "_overallGroups");
        _overallFiles = GetField<Label>(polish, "_overallFiles");
        _currentBar = GetField<MeterBar>(polish, "_currentBar");
        _currentPhase = GetField<Label>(polish, "_currentPhase");

        LoadManifestCache();
        _lastVerifiedGroups = CountVerifiedGroups(_host.State);

        _host.ProgressChanged += OnProgressChanged;
        _host.StateChanged += OnStateChanged;
        WebDavReadClient.GlobalIoProgress += OnIoProgress;
        _timer.Tick += (_, _) => Tick();
    }

    public static UiLiveProgress Attach(MainForm form, AppHost host, UiPolish polish)
    {
        var live = new UiLiveProgress(form, host, polish);
        live._timer.Start();
        live.Tick();
        return live;
    }

    private void OnProgressChanged(object? sender, EngineProgress progress)
    {
        var stageChanged = !string.Equals(_progress?.RelativePath, progress.RelativePath, StringComparison.OrdinalIgnoreCase) ||
                           !string.Equals(_progress?.Message, progress.Message, StringComparison.Ordinal);
        if (stageChanged)
            _io = null;

        _progress = progress;
        _progressAt = DateTimeOffset.Now;
    }

    private void OnStateChanged(object? sender, EventArgs e)
    {
        // The WinForms timer owns all control updates. Nothing persisted here.
    }

    private void OnIoProgress(object? sender, WebDavIoProgress progress)
    {
        if (!MatchesConfiguredEndpoint(progress.BaseAddress))
            return;
        _io = progress;
        _ioAt = DateTimeOffset.Now;
    }

    private void Tick()
    {
        if (_disposed || _form.IsDisposed)
            return;

        EnsureManifestTotals();
        UpdateOverall();
        UpdateCurrentActivity();
    }

    private void EnsureManifestTotals()
    {
        if (_totalGroups > 0 || !_host.IsConfigured || _manifestRefreshing)
            return;
        if (DateTimeOffset.Now < _nextManifestAttempt)
            return;

        _manifestRefreshing = true;
        _nextManifestAttempt = DateTimeOffset.Now.AddSeconds(30);
        _ = RefreshManifestTotalsAsync();
    }

    private async Task RefreshManifestTotalsAsync()
    {
        try
        {
            var report = await _host.ScanReadinessAsync(_cts.Token).ConfigureAwait(false);
            _totalFiles = report.ObjectCount;
            _totalGroups = report.GroupCount;
            SaveManifestCache(report);
            SafeUi(() =>
            {
                UpdateOverall();
                UpdateCurrentActivity();
            });
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
            // Advisory UI metadata only. A failed read retries later and never affects migration.
            _nextManifestAttempt = DateTimeOffset.Now.AddSeconds(30);
        }
        finally
        {
            _manifestRefreshing = false;
        }
    }

    private void UpdateOverall()
    {
        if (_overallBar is null || _overallPercent is null || _overallGroups is null || _overallFiles is null)
            return;

        var verifiedFiles = _host.State.Files.Values.Count(x => x.Status == TransferStatus.StrongVerified);
        var verifiedGroups = CountVerifiedGroups(_host.State);
        if (verifiedGroups > _lastVerifiedGroups)
        {
            _lastVerifiedGroups = verifiedGroups;
            _lastVerifiedAt = DateTimeOffset.Now;
        }

        if (_totalGroups <= 0)
        {
            _overallBar.Fraction = 0;
            _overallBar.BarText = string.Empty;
            _overallBar.Pulse = _host.Config.MigrationEnabled;
            _overallPercent.Text = _manifestRefreshing ? "正在更新源清单" : "等待源清单";
            _overallGroups.Text = $"{verifiedGroups:N0} 组已强校验";
            _overallFiles.Text = $"{verifiedFiles:N0} 文件已强校验";
            return;
        }

        var fraction = Math.Clamp((double)verifiedGroups / _totalGroups, 0, 1);
        _overallBar.Pulse = false;
        _overallBar.Fraction = fraction;
        _overallBar.BarText = $"{fraction:P1}";
        _overallPercent.Text = $"{verifiedGroups:N0} / {_totalGroups:N0} 组";
        _overallGroups.Text = $"已核验 {verifiedGroups:N0} 组，共 {_totalGroups:N0} 组";

        var fileText = _totalFiles > 0
            ? $"{verifiedFiles:N0} / {_totalFiles:N0} 文件已强校验"
            : $"{verifiedFiles:N0} 文件已强校验";
        if (_lastVerifiedAt != DateTimeOffset.MinValue)
            fileText += $"    最近完成 {FormatAge(DateTimeOffset.Now - _lastVerifiedAt)}";
        _overallFiles.Text = fileText;
    }

    private void UpdateCurrentActivity()
    {
        if (_currentBar is null || _currentPhase is null)
            return;

        var maintenance = _host.State.EngineState == EngineState.WaitQuota
            ? WaitQuotaMaintenanceActivity.Current
            : null;
        var maintenanceVisible = maintenance is not null &&
                                 (maintenance.IsActive || DateTimeOffset.Now - maintenance.UpdatedAt < TimeSpan.FromHours(5));
        if (!_host.Config.MigrationEnabled ||
            (_host.State.EngineState != EngineState.Running && !maintenanceVisible))
            return;

        var progress = maintenanceVisible ? maintenance!.Progress : _progress;
        var relative = progress?.RelativePath;
        var message = progress?.Message ?? string.Empty;

        if (string.IsNullOrWhiteSpace(relative))
        {
            if (maintenanceVisible)
            {
                _currentBar.Fraction = 0;
                _currentBar.Pulse = maintenance!.IsActive;
                _currentBar.BarText = maintenance.IsActive ? "后台只读维护" : "本轮维护完成";
                _currentPhase.Text = HumanizeStage(message, null);
            }
            return;
        }

        var fileName = Path.GetFileName(relative);
        var io = _io;
        var ioMatches = io is not null && RelativeFileMatches(io.RelativePath, relative);
        var hasTotal = ioMatches && io!.TotalBytes.HasValue && io.TotalBytes.Value > 0;
        var fraction = hasTotal ? Math.Clamp((double)io!.BytesProcessed / io.TotalBytes!.Value, 0, 1) : 0;

        // A 100% source GET is not a 100% file lifecycle. Once the byte stream is done and
        // no further bytes arrive for a short interval, show the metadata/remote handoff.
        if (IsSourceReadStage(message) && hasTotal && fraction >= 0.999 && DateTimeOffset.Now - _ioAt > TimeSpan.FromMilliseconds(650))
        {
            _currentBar.Fraction = 0;
            _currentBar.Pulse = true;
            _currentBar.BarText = fileName;
            _currentPhase.Text = "源文件读取完成，正在检查坚果云目标状态";
            return;
        }

        // If an HTTP operation is taking noticeably longer after the last visible update,
        // keep the bar alive and say what is happening instead of appearing frozen.
        var progressAt = maintenanceVisible ? maintenance!.UpdatedAt : _progressAt;
        if (DateTimeOffset.Now - progressAt > TimeSpan.FromSeconds(8) &&
            (!ioMatches || DateTimeOffset.Now - _ioAt > TimeSpan.FromSeconds(8)))
        {
            _currentBar.Pulse = true;
            _currentBar.BarText = fileName;
            _currentPhase.Text = "等待服务器响应，任务仍在后台运行";
            return;
        }

        if (hasTotal)
        {
            _currentBar.Pulse = false;
            _currentBar.Fraction = fraction;
            _currentBar.BarText = $"{fileName}    {fraction:P0}";
            _currentPhase.Text = HumanizeStage(message, io!.Operation);
        }
        else
        {
            _currentBar.Fraction = 0;
            _currentBar.Pulse = true;
            _currentBar.BarText = fileName;
            _currentPhase.Text = HumanizeStage(message, null);
        }
    }

    private static bool IsSourceReadStage(string message) =>
        message.Contains("Downloading source", StringComparison.OrdinalIgnoreCase) ||
        message.Contains("读取 InfiniCLOUD", StringComparison.OrdinalIgnoreCase);

    private static string HumanizeStage(string message, WebDavIoOperation? operation)
    {
        if (message.Contains("正在按目标路径探测", StringComparison.Ordinal))
            return StripMaintenancePrefix(message);
        if (message.Contains("读取 InfiniCLOUD", StringComparison.OrdinalIgnoreCase))
            return "正在读取 InfiniCLOUD 源文件并计算 SHA-256";
        if (message.Contains("读取坚果云已有副本", StringComparison.Ordinal))
            return "正在读取坚果云已有副本并做 SHA-256 强校验";
        if (message.Contains("SHA-256 完全一致", StringComparison.OrdinalIgnoreCase))
            return "源端与坚果云完全一致，已安全接管，上传 0 B";
        if (message.StartsWith("[维护]", StringComparison.Ordinal))
            return StripMaintenancePrefix(message);
        if (message.Contains("Downloading source", StringComparison.OrdinalIgnoreCase))
            return "正在读取源文件并计算 SHA-256";
        if (message.Contains("Target already exists", StringComparison.OrdinalIgnoreCase))
            return "正在读取坚果云已有副本并做强校验";
        if (message.Contains("Uploading target", StringComparison.OrdinalIgnoreCase))
            return "正在上传到坚果云";
        if (message.Contains("Re-downloading target", StringComparison.OrdinalIgnoreCase))
            return "正在重新读取坚果云文件并做强校验";
        if (message.Contains("Strong verification complete", StringComparison.OrdinalIgnoreCase))
            return "目标文件已通过强校验，准备下一个文件";
        return operation switch
        {
            WebDavIoOperation.Upload => "正在上传到坚果云",
            WebDavIoOperation.Download => "正在读取并校验文件",
            _ => "正在处理当前文件"
        };
    }

    private static string StripMaintenancePrefix(string message) =>
        message.StartsWith("[维护] ", StringComparison.Ordinal) ? message[5..] : message;

    private void LoadManifestCache()
    {
        try
        {
            var path = Path.Combine(_host.Paths.RoamingRoot, "ui-cache.json");
            if (!File.Exists(path))
                return;
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            if (doc.RootElement.TryGetProperty("TotalGroups", out var groups))
                _totalGroups = groups.GetInt32();
            if (doc.RootElement.TryGetProperty("TotalFiles", out var files))
                _totalFiles = files.GetInt32();
        }
        catch
        {
            _totalGroups = 0;
            _totalFiles = 0;
        }
    }

    private void SaveManifestCache(ReadinessReport report)
    {
        try
        {
            var path = Path.Combine(_host.Paths.RoamingRoot, "ui-cache.json");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temp = path + ".tmp";
            var json = JsonSerializer.Serialize(new
            {
                TotalFiles = report.ObjectCount,
                TotalGroups = report.GroupCount,
                TotalBytes = report.TotalBytes,
                RefreshedAt = DateTimeOffset.Now
            }, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(temp, json);
            File.Move(temp, path, true);
        }
        catch
        {
        }
    }

    private bool MatchesConfiguredEndpoint(string baseAddress) =>
        SameEndpoint(baseAddress, _host.Config.SourceBaseUrl) ||
        SameEndpoint(baseAddress, _host.Config.TargetBaseUrl);

    private static bool SameEndpoint(string left, string right)
    {
        if (!Uri.TryCreate(left, UriKind.Absolute, out var a) || !Uri.TryCreate(right, UriKind.Absolute, out var b))
            return false;
        return string.Equals(a.Scheme, b.Scheme, StringComparison.OrdinalIgnoreCase) &&
               string.Equals(a.Host, b.Host, StringComparison.OrdinalIgnoreCase) &&
               a.Port == b.Port &&
               a.AbsolutePath.Trim('/').Equals(b.AbsolutePath.Trim('/'), StringComparison.OrdinalIgnoreCase);
    }

    private static bool RelativeFileMatches(string ioPath, string progressPath)
    {
        var a = ioPath.Replace('\\', '/').Trim('/');
        var b = progressPath.Replace('\\', '/').Trim('/');
        return a.EndsWith("/" + b, StringComparison.OrdinalIgnoreCase) ||
               string.Equals(a, b, StringComparison.OrdinalIgnoreCase) ||
               string.Equals(Path.GetFileName(a), Path.GetFileName(b), StringComparison.OrdinalIgnoreCase);
    }

    private static int CountVerifiedGroups(MigrationState state)
    {
        var count = 0;
        foreach (var group in state.Files.Values.GroupBy(x => x.GroupKey, StringComparer.OrdinalIgnoreCase))
        {
            var records = group.ToArray();
            var zip = records.FirstOrDefault(x => Path.GetExtension(x.RelativePath).Equals(".zip", StringComparison.OrdinalIgnoreCase));
            var prop = records.FirstOrDefault(x => Path.GetExtension(x.RelativePath).Equals(".prop", StringComparison.OrdinalIgnoreCase));
            if (zip is not null || prop is not null)
            {
                if (zip?.Status == TransferStatus.StrongVerified && prop?.Status == TransferStatus.StrongVerified)
                    count++;
            }
            else if (records.Length > 0 && records.All(x => x.Status == TransferStatus.StrongVerified))
            {
                count++;
            }
        }
        return count;
    }

    private static string FormatAge(TimeSpan age)
    {
        if (age < TimeSpan.FromSeconds(2)) return "刚刚";
        if (age < TimeSpan.FromMinutes(1)) return $"{Math.Max(2, (int)age.TotalSeconds)} 秒前";
        if (age < TimeSpan.FromHours(1)) return $"{Math.Max(1, (int)age.TotalMinutes)} 分钟前";
        return $"{Math.Max(1, (int)age.TotalHours)} 小时前";
    }

    private static T? GetField<T>(UiPolish polish, string name) where T : class
    {
        try
        {
            return typeof(UiPolish).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(polish) as T;
        }
        catch
        {
            return null;
        }
    }

    private void SafeUi(Action action)
    {
        if (_disposed || _form.IsDisposed)
            return;
        if (_form.InvokeRequired)
            _form.BeginInvoke(action);
        else
            action();
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _timer.Stop();
        _timer.Dispose();
        _cts.Cancel();
        _cts.Dispose();
        _host.ProgressChanged -= OnProgressChanged;
        _host.StateChanged -= OnStateChanged;
        WebDavReadClient.GlobalIoProgress -= OnIoProgress;
    }
}
