using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PersonalWorkbench;

public enum WorkbenchTaskType { FileHash, DirectoryStatistics }
public enum WorkbenchTaskState { Queued, Running, Completed, Failed, Cancelled }

public sealed class DirectoryStatisticsResult
{
    public long FileCount { get; init; }
    public long DirectoryCount { get; init; }
    public long TotalBytes { get; init; }
    public long SkippedEntries { get; init; }

    public string Summary => string.Join(Environment.NewLine, new[]
    {
        $"文件：{FileCount:N0}",
        $"目录：{DirectoryCount:N0}",
        $"总大小：{FormatBytes(TotalBytes)}",
        $"跳过：{SkippedEntries:N0}"
    });

    public static string FormatBytes(long bytes)
    {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024L * 1024) return (bytes / 1024d).ToString("0.##") + " KB";
        if (bytes < 1024L * 1024 * 1024) return (bytes / 1024d / 1024d).ToString("0.##") + " MB";
        return (bytes / 1024d / 1024d / 1024d).ToString("0.###") + " GB";
    }
}

public static class WorkbenchTaskOperations
{
    private static readonly HashSet<string> IgnoredDirectories = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git", ".idea", ".vs", "node_modules", "bin", "obj", "dist", "build",
        "__pycache__", ".venv", "venv", "env", "target", ".pytest_cache", ".mypy_cache"
    };

    public static async Task<string> ComputeSha256Async(
        string path,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        if (!File.Exists(path)) throw new FileNotFoundException("待校验文件不存在。", path);
        const int bufferSize = 1024 * 1024;
        var buffer = new byte[bufferSize];
        var info = new FileInfo(path);
        var total = info.Length;
        long processed = 0;
        var lastReported = -1;
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        await using var stream = new FileStream(
            path, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var count = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken).ConfigureAwait(false);
            if (count <= 0) break;
            hash.AppendData(buffer, 0, count);
            processed += count;
            var percent = total <= 0 ? 100 : (int)Math.Clamp(processed * 100d / total, 0, 100);
            if (percent != lastReported)
            {
                lastReported = percent;
                progress?.Report(percent);
            }
        }
        progress?.Report(100);
        return Convert.ToHexString(hash.GetHashAndReset());
    }

    public static Task<DirectoryStatisticsResult> ScanDirectoryAsync(
        string root,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
        => Task.Run(() => ScanDirectory(root, progress, cancellationToken), cancellationToken);

    public static DirectoryStatisticsResult ScanDirectory(
        string root,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(root)) throw new DirectoryNotFoundException("待统计目录不存在：" + root);
        root = Path.GetFullPath(root);
        long files = 0, directories = 0, bytes = 0, skipped = 0, processed = 0;
        var queue = new Queue<string>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        queue.Enqueue(root);
        progress?.Report(-1);

        while (queue.Count > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var directory = queue.Dequeue();
            string normalized;
            try { normalized = Path.GetFullPath(directory); }
            catch { skipped++; continue; }
            if (!visited.Add(normalized)) { skipped++; continue; }

            IEnumerable<string> entries;
            try { entries = Directory.EnumerateFileSystemEntries(normalized); }
            catch { skipped++; continue; }

            try
            {
                foreach (var entry in entries)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    processed++;
                    if (processed % 250 == 0) progress?.Report(-1);
                    try
                    {
                        var attributes = File.GetAttributes(entry);
                        if ((attributes & FileAttributes.ReparsePoint) != 0) { skipped++; continue; }
                        if ((attributes & FileAttributes.Directory) != 0)
                        {
                            var name = Path.GetFileName(entry);
                            if (IgnoredDirectories.Contains(name) || name.StartsWith(".", StringComparison.Ordinal)) { skipped++; continue; }
                            directories++;
                            queue.Enqueue(entry);
                        }
                        else
                        {
                            files++;
                            try { bytes = checked(bytes + new FileInfo(entry).Length); }
                            catch { skipped++; }
                        }
                    }
                    catch { skipped++; }
                }
            }
            catch (OperationCanceledException) { throw; }
            catch { skipped++; }
        }

        progress?.Report(100);
        return new DirectoryStatisticsResult
        {
            FileCount = files,
            DirectoryCount = directories,
            TotalBytes = bytes,
            SkippedEntries = skipped
        };
    }
}

public sealed class WorkbenchTaskRecord : INotifyPropertyChanged
{
    private WorkbenchTaskState _state;
    private double _progress;
    private string _result = string.Empty;
    private string _error = string.Empty;
    private DateTimeOffset? _startedAt;
    private DateTimeOffset? _completedAt;

    public Guid Id { get; set; } = Guid.NewGuid();
    public WorkbenchTaskType Type { get; set; }
    public string Title { get; set; } = string.Empty;
    public string TargetPath { get; set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.Now;

    public WorkbenchTaskState State { get => _state; set { if (Set(ref _state, value)) NotifyComputed(); } }
    public double Progress { get => _progress; set { if (Set(ref _progress, value)) OnPropertyChanged(nameof(ProgressLabel)); } }
    public string Result { get => _result; set => Set(ref _result, value); }
    public string Error { get => _error; set => Set(ref _error, value); }
    public DateTimeOffset? StartedAt { get => _startedAt; set { if (Set(ref _startedAt, value)) OnPropertyChanged(nameof(DurationLabel)); } }
    public DateTimeOffset? CompletedAt { get => _completedAt; set { if (Set(ref _completedAt, value)) OnPropertyChanged(nameof(DurationLabel)); } }

    [JsonIgnore] public string TypeLabel => Type == WorkbenchTaskType.FileHash ? "SHA-256" : "目录统计";
    [JsonIgnore] public string StateLabel => State switch
    {
        WorkbenchTaskState.Queued => "等待中", WorkbenchTaskState.Running => "运行中",
        WorkbenchTaskState.Completed => "已完成", WorkbenchTaskState.Failed => "失败", _ => "已取消"
    };
    [JsonIgnore] public string ProgressLabel => State == WorkbenchTaskState.Queued ? "排队" : Progress < 0 ? "处理中" : Math.Clamp(Progress, 0, 100).ToString("0") + "%";
    [JsonIgnore] public bool CanCancel => State is WorkbenchTaskState.Queued or WorkbenchTaskState.Running;
    [JsonIgnore] public string CreatedLabel => CreatedAt.ToString("MM-dd HH:mm:ss");
    [JsonIgnore] public string DurationLabel
    {
        get
        {
            if (StartedAt is null) return string.Empty;
            var end = CompletedAt ?? DateTimeOffset.Now;
            var duration = end - StartedAt.Value;
            return duration.TotalMinutes >= 1 ? duration.ToString(@"m\:ss") : duration.ToString(@"s\.f") + " s";
        }
    }
    [JsonIgnore] public string StatusBackground => State switch
    {
        WorkbenchTaskState.Completed => "#E7F7F0", WorkbenchTaskState.Failed => "#FDEAEA",
        WorkbenchTaskState.Cancelled => "#EEF2F7", WorkbenchTaskState.Running => "#EAF2FF", _ => "#FFF4DF"
    };
    [JsonIgnore] public string StatusForeground => State switch
    {
        WorkbenchTaskState.Completed => "#187A58", WorkbenchTaskState.Failed => "#B13D48",
        WorkbenchTaskState.Cancelled => "#64748B", WorkbenchTaskState.Running => "#326FD6", _ => "#A86812"
    };

    public event PropertyChangedEventHandler? PropertyChanged;

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        OnPropertyChanged(name);
        return true;
    }

    private void NotifyComputed()
    {
        OnPropertyChanged(nameof(StateLabel));
        OnPropertyChanged(nameof(ProgressLabel));
        OnPropertyChanged(nameof(CanCancel));
        OnPropertyChanged(nameof(StatusBackground));
        OnPropertyChanged(nameof(StatusForeground));
    }

    private void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

public static class WorkbenchTaskStore
{
    private static JsonSerializerOptions JsonOptions() => new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() }
    };

    public static string Serialize(IEnumerable<WorkbenchTaskRecord> tasks)
        => JsonSerializer.Serialize(tasks, JsonOptions());

    public static IReadOnlyList<WorkbenchTaskRecord> Deserialize(string json)
    {
        try
        {
            var tasks = JsonSerializer.Deserialize<List<WorkbenchTaskRecord>>(json, JsonOptions()) ?? new();
            foreach (var task in tasks.Where(item => item.State is WorkbenchTaskState.Queued or WorkbenchTaskState.Running))
            {
                task.State = WorkbenchTaskState.Failed;
                task.Error = "上次运行在任务完成前中断。";
                task.CompletedAt = DateTimeOffset.Now;
                task.Progress = 0;
            }
            return tasks.OrderByDescending(item => item.CreatedAt).Take(100).ToArray();
        }
        catch { return Array.Empty<WorkbenchTaskRecord>(); }
    }

    public static IReadOnlyList<WorkbenchTaskRecord> Load(string path)
    {
        try { return File.Exists(path) ? Deserialize(File.ReadAllText(path)) : Array.Empty<WorkbenchTaskRecord>(); }
        catch (Exception ex) { App.Log("Task history load failed: " + ex.Message); return Array.Empty<WorkbenchTaskRecord>(); }
    }

    public static void Save(string path, IEnumerable<WorkbenchTaskRecord> tasks)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? App.AppDataDirectory);
            var temp = path + ".tmp";
            File.WriteAllText(temp, Serialize(tasks.Take(100)), new UTF8Encoding(false));
            File.Move(temp, path, true);
        }
        catch (Exception ex) { App.Log("Task history save failed: " + ex.Message); }
    }
}

public sealed class WorkbenchTaskService : IDisposable
{
    public const int DefaultMaxConcurrency = 2;

    private readonly SemaphoreSlim _executionSlots;
    private readonly Dictionary<Guid, CancellationTokenSource> _cancellations = new();
    private bool _disposed;

    public WorkbenchTaskService(int maxConcurrency = DefaultMaxConcurrency)
    {
        MaxConcurrency = Math.Clamp(maxConcurrency, 1, 8);
        _executionSlots = new SemaphoreSlim(MaxConcurrency, MaxConcurrency);
        Tasks = new ObservableCollection<WorkbenchTaskRecord>(WorkbenchTaskStore.Load(HistoryPath));
    }

    public static string HistoryPath => Path.Combine(App.AppDataDirectory, "task-history.json");
    public int MaxConcurrency { get; }
    public ObservableCollection<WorkbenchTaskRecord> Tasks { get; }

    public WorkbenchTaskRecord StartFileHash(string path)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var record = AddRecord(WorkbenchTaskType.FileHash, "计算 " + Path.GetFileName(path) + " 的 SHA-256", path);
        _ = RunFileHashAsync(record);
        return record;
    }

    public WorkbenchTaskRecord StartDirectoryStatistics(string root)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var name = Path.GetFileName(root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        var record = AddRecord(WorkbenchTaskType.DirectoryStatistics, "统计 " + (string.IsNullOrWhiteSpace(name) ? root : name), root);
        _ = RunDirectoryStatisticsAsync(record);
        return record;
    }

    public void Cancel(Guid id)
    {
        if (_cancellations.TryGetValue(id, out var cancellation)) cancellation.Cancel();
    }

    public void ClearFinished()
    {
        foreach (var item in Tasks.Where(task => !task.CanCancel).ToArray()) Tasks.Remove(item);
        Persist();
    }

    private WorkbenchTaskRecord AddRecord(WorkbenchTaskType type, string title, string target)
    {
        var record = new WorkbenchTaskRecord
        {
            Type = type, Title = title, TargetPath = target,
            State = WorkbenchTaskState.Queued, Progress = 0, CreatedAt = DateTimeOffset.Now
        };
        Tasks.Insert(0, record);
        Persist();
        return record;
    }

    private async Task RunFileHashAsync(WorkbenchTaskRecord record)
    {
        using var cancellation = Register(record);
        var entered = false;
        try
        {
            await _executionSlots.WaitAsync(cancellation.Token);
            entered = true;
            Begin(record);
            Persist();
            var progress = new Progress<double>(value => record.Progress = value);
            var hash = await WorkbenchTaskOperations.ComputeSha256Async(record.TargetPath, progress, cancellation.Token);
            Complete(record, "SHA-256" + Environment.NewLine + hash);
        }
        catch (OperationCanceledException) { Cancelled(record); }
        catch (Exception ex) { Fail(record, ex); }
        finally
        {
            if (entered) _executionSlots.Release();
            _cancellations.Remove(record.Id);
            Persist();
        }
    }

    private async Task RunDirectoryStatisticsAsync(WorkbenchTaskRecord record)
    {
        using var cancellation = Register(record);
        var entered = false;
        try
        {
            await _executionSlots.WaitAsync(cancellation.Token);
            entered = true;
            Begin(record);
            Persist();
            var progress = new Progress<double>(value => record.Progress = value);
            var result = await WorkbenchTaskOperations.ScanDirectoryAsync(record.TargetPath, progress, cancellation.Token);
            Complete(record, result.Summary);
        }
        catch (OperationCanceledException) { Cancelled(record); }
        catch (Exception ex) { Fail(record, ex); }
        finally
        {
            if (entered) _executionSlots.Release();
            _cancellations.Remove(record.Id);
            Persist();
        }
    }

    private CancellationTokenSource Register(WorkbenchTaskRecord record)
    {
        var cancellation = new CancellationTokenSource();
        _cancellations[record.Id] = cancellation;
        return cancellation;
    }

    private static void Begin(WorkbenchTaskRecord record)
    {
        record.State = WorkbenchTaskState.Running;
        record.Progress = 0;
        record.StartedAt = DateTimeOffset.Now;
    }

    private static void Complete(WorkbenchTaskRecord record, string result)
    {
        record.Result = result;
        record.Progress = 100;
        record.State = WorkbenchTaskState.Completed;
        record.CompletedAt = DateTimeOffset.Now;
    }

    private static void Cancelled(WorkbenchTaskRecord record)
    {
        record.Error = "任务已由用户取消。";
        record.State = WorkbenchTaskState.Cancelled;
        record.CompletedAt = DateTimeOffset.Now;
    }

    private static void Fail(WorkbenchTaskRecord record, Exception ex)
    {
        record.Error = ex.Message;
        record.State = WorkbenchTaskState.Failed;
        record.CompletedAt = DateTimeOffset.Now;
        App.Log("Workbench task failed: " + ex);
    }

    private void Persist()
    {
        if (_disposed && Tasks.Count == 0) return;
        WorkbenchTaskStore.Save(HistoryPath, Tasks.ToArray());
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var cancellation in _cancellations.Values) cancellation.Cancel();
        _cancellations.Clear();
        Persist();
    }
}
