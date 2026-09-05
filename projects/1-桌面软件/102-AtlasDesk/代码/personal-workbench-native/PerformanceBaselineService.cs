using System.Diagnostics;
using System.Text.Json;

namespace PersonalWorkbench;

public sealed record StartupPerformanceSample(
    string Version,
    DateTimeOffset RecordedUtc,
    bool SafeMode,
    long MainWindowLoadedMs,
    long PipelineAttachedMs,
    long WorkingSetBytes);

public sealed record StartupPerformanceSummary(
    int SampleCount,
    StartupPerformanceSample? Latest,
    long MedianPipelineAttachedMs,
    long MedianWorkingSetBytes);

public static class PerformanceBaselineService
{
    public const int MaxHistory = 20;
    private static readonly object Sync = new();
    private static long _startTimestamp;
    private static long? _mainWindowLoadedMs;
    private static string _version = string.Empty;
    private static bool _safeMode;
    private static bool _started;
    private static bool _recorded;

    public static string HistoryPath => Path.Combine(App.StateDirectory, "startup-performance.json");

    public static void Begin(string version, bool safeMode)
    {
        lock (Sync)
        {
            _version = version;
            _safeMode = safeMode;
            _startTimestamp = Stopwatch.GetTimestamp();
            _mainWindowLoadedMs = null;
            _recorded = false;
            _started = true;
        }
    }

    public static void MarkMainWindowLoaded()
    {
        lock (Sync)
        {
            if (!_started || _mainWindowLoadedMs.HasValue) return;
            _mainWindowLoadedMs = ElapsedMilliseconds();
        }
    }

    public static StartupPerformanceSample? MarkPipelineAttached()
    {
        StartupPerformanceSample? sample;
        lock (Sync)
        {
            if (!_started || _recorded) return null;
            _recorded = true;
            var pipelineMs = ElapsedMilliseconds();
            var loadedMs = Math.Min(_mainWindowLoadedMs ?? pipelineMs, pipelineMs);
            long workingSet;
            try
            {
                using var process = Process.GetCurrentProcess();
                process.Refresh();
                workingSet = Math.Max(0, process.WorkingSet64);
            }
            catch { workingSet = 0; }

            sample = new StartupPerformanceSample(
                _version,
                DateTimeOffset.UtcNow,
                _safeMode,
                loadedMs,
                pipelineMs,
                workingSet);
        }

        try { AppendBoundedHistory(HistoryPath, sample, MaxHistory); }
        catch (Exception ex) { App.Log("Performance baseline write failed: " + ex.Message); }
        return sample;
    }

    public static IReadOnlyList<StartupPerformanceSample> ReadHistory(string? path = null)
    {
        path ??= HistoryPath;
        try
        {
            if (!File.Exists(path)) return Array.Empty<StartupPerformanceSample>();
            return JsonSerializer.Deserialize<List<StartupPerformanceSample>>(
                       File.ReadAllText(path), JsonOptions())
                   ?.Where(IsValid)
                   .OrderBy(sample => sample.RecordedUtc)
                   .TakeLast(MaxHistory)
                   .ToArray()
                   ?? Array.Empty<StartupPerformanceSample>();
        }
        catch { return Array.Empty<StartupPerformanceSample>(); }
    }

    public static StartupPerformanceSummary GetSummary(string? path = null)
    {
        var history = ReadHistory(path);
        if (history.Count == 0) return new StartupPerformanceSummary(0, null, 0, 0);
        return new StartupPerformanceSummary(
            history.Count,
            history[^1],
            Median(history.Select(sample => sample.PipelineAttachedMs)),
            Median(history.Select(sample => sample.WorkingSetBytes)));
    }

    public static void AppendBoundedHistory(
        string path,
        StartupPerformanceSample sample,
        int limit = MaxHistory)
    {
        if (!IsValid(sample)) throw new ArgumentException("Invalid startup performance sample.", nameof(sample));
        limit = Math.Clamp(limit, 1, 100);
        var history = new List<StartupPerformanceSample>();
        try
        {
            if (File.Exists(path))
                history = JsonSerializer.Deserialize<List<StartupPerformanceSample>>(
                              File.ReadAllText(path), JsonOptions())
                          ?.Where(IsValid)
                          .ToList()
                          ?? new List<StartupPerformanceSample>();
        }
        catch
        {
            AtomicFileStore.Quarantine(path, "corrupt-performance");
        }

        history.Add(sample);
        var bounded = history
            .OrderBy(item => item.RecordedUtc)
            .TakeLast(limit)
            .ToArray();
        AtomicFileStore.WriteAllText(
            path,
            JsonSerializer.Serialize(bounded, JsonOptions()),
            path + ".bak");
    }

    private static bool IsValid(StartupPerformanceSample sample)
        => !string.IsNullOrWhiteSpace(sample.Version)
           && sample.MainWindowLoadedMs >= 0
           && sample.PipelineAttachedMs >= sample.MainWindowLoadedMs
           && sample.PipelineAttachedMs <= TimeSpan.FromMinutes(10).TotalMilliseconds
           && sample.WorkingSetBytes >= 0;

    private static long ElapsedMilliseconds()
        => Math.Max(0, (long)((Stopwatch.GetTimestamp() - _startTimestamp) * 1000d / Stopwatch.Frequency));

    private static long Median(IEnumerable<long> values)
    {
        var ordered = values.OrderBy(value => value).ToArray();
        if (ordered.Length == 0) return 0;
        var middle = ordered.Length / 2;
        return ordered.Length % 2 == 1
            ? ordered[middle]
            : (ordered[middle - 1] + ordered[middle]) / 2;
    }

    private static JsonSerializerOptions JsonOptions() => new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };
}
