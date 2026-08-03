global using FileIntegrityEntry = PersonalWorkbench.IntegrityManifestEntry;

namespace PersonalWorkbench;

public sealed class WorkbenchTaskHandle
{
    public required WorkbenchTaskRecord Record { get; init; }
    public required Task<WorkbenchTaskRecord> Completion { get; init; }
}

public static class WorkbenchTaskHub
{
    private static readonly object Gate = new();
    private static WorkbenchTaskService? _service;

    public static WorkbenchTaskService Service
    {
        get
        {
            lock (Gate)
                return _service ??= new WorkbenchTaskService();
        }
    }

    public static WorkbenchTaskService? Current
    {
        get
        {
            lock (Gate)
                return _service;
        }
    }

    public static void Shutdown()
    {
        lock (Gate)
        {
            FileIntegrityTaskBridge.CancelAll();
            _service?.Dispose();
            _service = null;
        }
    }
}

public static class FileIntegrityTaskBridge
{
    private static readonly SemaphoreSlim ExecutionSlots = new(2, 2);
    private static readonly Dictionary<Guid, CancellationTokenSource> Cancellations = new();
    private static readonly object Gate = new();

    public static WorkbenchTaskHandle Start(
        string title,
        string targetPath,
        Func<IProgress<double>, CancellationToken, Task<string>> operation)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(title);
        ArgumentNullException.ThrowIfNull(operation);

        var service = WorkbenchTaskHub.Service;
        var record = new WorkbenchTaskRecord
        {
            Type = WorkbenchTaskType.FileHash,
            Title = title,
            TargetPath = targetPath ?? string.Empty,
            State = WorkbenchTaskState.Queued,
            Progress = 0,
            CreatedAt = DateTimeOffset.Now
        };
        var cancellation = new CancellationTokenSource();
        lock (Gate) Cancellations[record.Id] = cancellation;
        service.Tasks.Insert(0, record);
        Persist(service);
        return new WorkbenchTaskHandle
        {
            Record = record,
            Completion = ExecuteAsync(service, record, cancellation, operation)
        };
    }

    private static async Task<WorkbenchTaskRecord> ExecuteAsync(
        WorkbenchTaskService service,
        WorkbenchTaskRecord record,
        CancellationTokenSource cancellation,
        Func<IProgress<double>, CancellationToken, Task<string>> operation)
    {
        var entered = false;
        try
        {
            await ExecutionSlots.WaitAsync(cancellation.Token);
            entered = true;
            record.State = WorkbenchTaskState.Running;
            record.StartedAt = DateTimeOffset.Now;
            Persist(service);

            var progress = new Progress<double>(value => record.Progress = value);
            record.Result = await operation(progress, cancellation.Token);
            record.Progress = 100;
            record.State = WorkbenchTaskState.Completed;
            record.CompletedAt = DateTimeOffset.Now;
        }
        catch (OperationCanceledException)
        {
            record.Error = "任务已由用户取消。";
            record.State = WorkbenchTaskState.Cancelled;
            record.CompletedAt = DateTimeOffset.Now;
        }
        catch (Exception ex)
        {
            record.Error = ex.Message;
            record.State = WorkbenchTaskState.Failed;
            record.CompletedAt = DateTimeOffset.Now;
            App.Log("File integrity task failed: " + ex);
        }
        finally
        {
            if (entered) ExecutionSlots.Release();
            lock (Gate)
            {
                Cancellations.Remove(record.Id, out var registered);
                registered?.Dispose();
            }
            Persist(service);
        }
        return record;
    }

    public static bool Cancel(Guid id)
    {
        lock (Gate)
        {
            if (!Cancellations.TryGetValue(id, out var cancellation))
                return false;
            cancellation.Cancel();
            return true;
        }
    }

    public static bool IsActive(Guid id)
    {
        lock (Gate) return Cancellations.ContainsKey(id);
    }

    public static void CancelAll()
    {
        lock (Gate)
        {
            foreach (var cancellation in Cancellations.Values)
                cancellation.Cancel();
        }
    }

    private static void Persist(WorkbenchTaskService service)
        => WorkbenchTaskStore.Save(WorkbenchTaskService.HistoryPath, service.Tasks.Take(100).ToArray());
}
