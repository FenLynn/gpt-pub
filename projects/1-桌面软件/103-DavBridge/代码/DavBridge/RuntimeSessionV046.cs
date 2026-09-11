using System.Text.Json;
using DavBridge.Core;

namespace DavBridge;

internal sealed record RuntimeSessionSnapshotV046(
    bool IsActive,
    DateTimeOffset? StartedAt,
    long UptimeSeconds,
    string UptimeText,
    bool PreviousExitUnclean,
    string PreviousExitText,
    int UncleanExitCount,
    DateTimeOffset? LastHeartbeatAt,
    int CleanedTempFiles,
    long CleanedTempBytes,
    string CleanupText);

internal sealed class RuntimeSessionV046 : IDisposable
{
    private sealed class SessionMarker
    {
        public string SessionId { get; set; } = string.Empty;
        public DateTimeOffset StartedAt { get; set; }
        public DateTimeOffset LastHeartbeatAt { get; set; }
        public DateTimeOffset? CleanExitAt { get; set; }
        public string Version { get; set; } = string.Empty;
        public string BuildCommit { get; set; } = string.Empty;
        public string EngineState { get; set; } = string.Empty;
    }

    private sealed record CleanupResult(int Files, long Bytes);

    private static readonly object CurrentGate = new();
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true, PropertyNameCaseInsensitive = true };
    private static RuntimeSessionV046? _current;

    private readonly AppHost _host;
    private readonly object _markerGate = new();
    private readonly string _markerPath;
    private readonly string _sessionId = Guid.NewGuid().ToString("N");
    private readonly DateTimeOffset _startedAt = DateTimeOffset.Now;
    private readonly System.Threading.Timer _heartbeat;
    private readonly bool _previousExitUnclean;
    private readonly string _previousExitText;
    private readonly DateTimeOffset? _previousHeartbeatAt;
    private readonly CleanupResult _cleanup;
    private bool _disposed;

    private RuntimeSessionV046(AppHost host)
    {
        _host = host;
        Directory.CreateDirectory(host.Paths.LocalRoot);
        _markerPath = Path.Combine(host.Paths.LocalRoot, "runtime-session.json");

        var hadMarker = File.Exists(_markerPath);
        var previous = TryReadMarker(_markerPath);
        _previousExitUnclean = hadMarker && previous?.CleanExitAt is null;
        _previousHeartbeatAt = previous?.LastHeartbeatAt;

        _previousExitText = _previousExitUnclean
            ? "上次异常中断"
            : previous?.CleanExitAt is not null || ProductExperienceV044.LastCleanExitAt.HasValue
                ? "上次正常退出"
                : "首次运行或无历史";

        _cleanup = CleanupTempArtifacts(host.Paths.TempRoot);

        ProductExperienceV044.BeginRuntimeSession(
            _startedAt,
            _previousExitUnclean,
            previous?.StartedAt,
            previous?.LastHeartbeatAt,
            previous?.EngineState,
            _cleanup.Files,
            _cleanup.Bytes);

        WriteMarker(cleanExitAt: null);
        _host.StateChanged += OnHostStateChanged;
        _heartbeat = new System.Threading.Timer(_ => Heartbeat(), null, TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));

        lock (CurrentGate)
            _current = this;
    }

    public static RuntimeSessionV046 Attach(AppHost host) => new(host);

    public static RuntimeSessionSnapshotV046 GetSnapshot()
    {
        lock (CurrentGate)
        {
            if (_current is null)
            {
                return new RuntimeSessionSnapshotV046(
                    false, null, 0, "尚未启动",
                    false,
                    ProductExperienceV044.LastCleanExitAt.HasValue ? "上次正常退出" : "首次运行或无历史",
                    ProductExperienceV044.UncleanExitCount,
                    null,
                    ProductExperienceV044.LastTempCleanupFiles,
                    ProductExperienceV044.LastTempCleanupBytes,
                    FormatCleanup(ProductExperienceV044.LastTempCleanupFiles, ProductExperienceV044.LastTempCleanupBytes));
            }

            return _current.CreateSnapshot();
        }
    }

    private RuntimeSessionSnapshotV046 CreateSnapshot()
    {
        var now = DateTimeOffset.Now;
        var uptime = Math.Max(0, (long)(now - _startedAt).TotalSeconds);
        return new RuntimeSessionSnapshotV046(
            true,
            _startedAt,
            uptime,
            FormatUptime(uptime),
            _previousExitUnclean,
            _previousExitText,
            ProductExperienceV044.UncleanExitCount,
            _previousHeartbeatAt,
            _cleanup.Files,
            _cleanup.Bytes,
            FormatCleanup(_cleanup.Files, _cleanup.Bytes));
    }

    private void OnHostStateChanged(object? sender, EventArgs e) => Heartbeat();

    private void Heartbeat()
    {
        lock (_markerGate)
        {
            if (_disposed) return;
            try { WriteMarkerCore(cleanExitAt: null); } catch { }
        }
    }

    private void WriteMarker(DateTimeOffset? cleanExitAt)
    {
        lock (_markerGate)
        {
            if (_disposed && cleanExitAt is null) return;
            WriteMarkerCore(cleanExitAt);
        }
    }

    private void WriteMarkerCore(DateTimeOffset? cleanExitAt)
    {
        var marker = new SessionMarker
        {
            SessionId = _sessionId,
            StartedAt = _startedAt,
            LastHeartbeatAt = DateTimeOffset.Now,
            CleanExitAt = cleanExitAt,
            Version = BuildInfoV044.Version,
            BuildCommit = BuildInfoV044.ShortCommit,
            EngineState = _host.State.EngineState.ToString()
        };

        var temp = _markerPath + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(marker, JsonOptions));
        using (var stream = new FileStream(temp, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            stream.Flush(true);
        File.Move(temp, _markerPath, true);
    }

    private static SessionMarker? TryReadMarker(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            return JsonSerializer.Deserialize<SessionMarker>(File.ReadAllText(path), JsonOptions);
        }
        catch { return null; }
    }

    private static CleanupResult CleanupTempArtifacts(string tempRoot)
    {
        if (!Directory.Exists(tempRoot)) return new CleanupResult(0, 0);

        var files = new List<string>();
        try { files.AddRange(Directory.EnumerateFiles(tempRoot, "*.part", SearchOption.TopDirectoryOnly)); } catch { }

        var resetProbe = Path.Combine(tempRoot, "reset-probe-state.json");
        if (File.Exists(resetProbe)) files.Add(resetProbe);

        var count = 0;
        long bytes = 0;
        foreach (var path in files.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                var info = new FileInfo(path);
                var length = info.Exists ? Math.Max(0, info.Length) : 0;
                File.Delete(path);
                count++;
                bytes += length;
            }
            catch { }
        }

        return new CleanupResult(count, bytes);
    }

    internal static bool ValidateForSelfTest(string localRoot, string tempRoot)
    {
        var root = Path.Combine(localRoot, "RuntimeSessionSelfTest");
        var temp = Path.Combine(tempRoot, "RuntimeSessionSelfTest");
        Directory.CreateDirectory(root);
        Directory.CreateDirectory(temp);
        try
        {
            var markerPath = Path.Combine(root, "runtime-session.json");
            var marker = new SessionMarker
            {
                SessionId = "selftest",
                StartedAt = DateTimeOffset.UtcNow.AddMinutes(-10),
                LastHeartbeatAt = DateTimeOffset.UtcNow.AddMinutes(-1),
                Version = "selftest",
                BuildCommit = "selftest",
                EngineState = EngineState.WaitNetwork.ToString()
            };
            File.WriteAllText(markerPath, JsonSerializer.Serialize(marker, JsonOptions));
            var loaded = TryReadMarker(markerPath);
            if (loaded is null || loaded.CleanExitAt is not null || loaded.EngineState != EngineState.WaitNetwork.ToString())
                return false;

            var part = Path.Combine(temp, "orphan.part");
            var probe = Path.Combine(temp, "reset-probe-state.json");
            File.WriteAllBytes(part, new byte[37]);
            File.WriteAllBytes(probe, new byte[19]);
            var cleanup = CleanupTempArtifacts(temp);
            return cleanup.Files == 2 && cleanup.Bytes == 56 && !File.Exists(part) && !File.Exists(probe);
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { }
            try { Directory.Delete(temp, true); } catch { }
        }
    }

    private static string FormatUptime(long seconds)
    {
        var span = TimeSpan.FromSeconds(Math.Max(0, seconds));
        if (span.TotalDays >= 1) return $"已运行 {(int)span.TotalDays} 天 {span.Hours} 小时";
        if (span.TotalHours >= 1) return $"已运行 {(int)span.TotalHours} 小时 {span.Minutes} 分";
        if (span.TotalMinutes >= 1) return $"已运行 {(int)span.TotalMinutes} 分";
        return "刚刚启动";
    }

    private static string FormatCleanup(int files, long bytes)
    {
        if (files <= 0) return "无中断残留";
        var size = bytes >= 1_000_000
            ? $"{bytes / 1_000_000d:0.0} MB"
            : bytes >= 1_000
                ? $"{bytes / 1_000d:0.0} KB"
                : $"{bytes} B";
        return $"已清理 {files} 个残留，共 {size}";
    }

    public void Dispose()
    {
        _host.StateChanged -= OnHostStateChanged;
        try { _heartbeat.Change(Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan); } catch { }

        var endedAt = DateTimeOffset.Now;
        lock (_markerGate)
        {
            if (_disposed) return;
            _disposed = true;
            try { WriteMarkerCore(endedAt); } catch { }
            try { File.Delete(_markerPath); } catch { }
        }

        _heartbeat.Dispose();
        ProductExperienceV044.EndRuntimeSession(_startedAt, endedAt);

        lock (CurrentGate)
        {
            if (ReferenceEquals(_current, this))
                _current = null;
        }
    }
}
