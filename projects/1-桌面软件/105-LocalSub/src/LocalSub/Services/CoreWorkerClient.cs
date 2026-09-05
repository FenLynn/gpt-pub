using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;
using LocalSub.Core;
using LocalSub.Models;

namespace LocalSub.Services;

/// <summary>
/// Thin shell-side client for LocalSub.Core.exe. Heavy batch/media work lives in
/// another process so a blocked decoder or recognizer cannot block the WinForms UI.
/// </summary>
public sealed class CoreWorkerClient : IAsyncDisposable
{
    readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    readonly SemaphoreSlim _writeGate = new(1, 1);
    readonly SemaphoreSlim _operationGate = new(1, 1);
    readonly ConcurrentDictionary<string, PendingRequest> _pending = new();
    Process? _process;
    NamedPipeClientStream? _pipe;
    StreamReader? _reader;
    StreamWriter? _writer;
    Task? _readerTask;
    int _connectionGeneration;
    int _brokenGeneration;
    bool _disposed;

    static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    internal int? WorkerProcessId
    {
        get
        {
            try { return _process is { HasExited: false } p ? p.Id : null; }
            catch { return null; }
        }
    }

    internal int PendingRequestCount => _pending.Count;

    public async Task PingAsync(CancellationToken ct = default)
        => _ = await SendOperationAsync("ping", new { }, null, ct);

    internal async Task PingWithDelayAsync(int delayMs, CancellationToken ct = default)
        => _ = await SendOperationAsync("ping", new { delayMs = Math.Clamp(delayMs, 0, 10_000) }, null, ct);

    public async Task<MediaAnalysisResult> AnalyzeAsync(
        string filePath,
        IProgress<MediaAnalysisProgress>? progress = null,
        CancellationToken ct = default)
    {
        var payload = await SendOperationAsync(
            "analyze",
            new { filePath },
            (eventName, value) =>
            {
                if (eventName != "analysis-progress" || progress == null) return;
                var p = value.Deserialize<MediaAnalysisProgress>(JsonOptions);
                if (p != null) progress.Report(p);
            },
            ct);

        var dto = payload.Deserialize<AnalysisDto>(JsonOptions)
            ?? throw new InvalidDataException("LocalSub.Core 返回了无效的媒体分析结果。");
        return new MediaAnalysisResult(
            dto.FilePath,
            TimeSpan.FromMilliseconds(dto.DurationMs),
            dto.SampleRate,
            dto.Channels,
            dto.Waveform ?? [],
            dto.SecondsPerPoint,
            dto.DecoderName ?? "LocalSub.Core");
    }

    public async Task<BatchTranscriptionResult> TranscribeAsync(
        string filePath,
        string modelId,
        IEnumerable<string> keywords,
        IProgress<BatchTranscriptionProgress>? batchProgress = null,
        IProgress<ModelOperationProgress>? modelProgress = null,
        CancellationToken ct = default)
    {
        var payload = await SendOperationAsync(
            "transcribe",
            new { filePath, modelId, keywords = keywords.ToArray() },
            (eventName, value) =>
            {
                if (eventName == "batch-progress" && batchProgress != null)
                {
                    var p = value.Deserialize<BatchTranscriptionProgress>(JsonOptions);
                    if (p != null) batchProgress.Report(p);
                }
                else if (eventName == "model-progress" && modelProgress != null)
                {
                    var p = value.Deserialize<ModelOperationProgress>(JsonOptions);
                    if (p != null) modelProgress.Report(p);
                }
            },
            ct);

        var dto = payload.Deserialize<TranscriptionDto>(JsonOptions)
            ?? throw new InvalidDataException("LocalSub.Core 返回了无效的转写结果。");
        var items = (dto.Items ?? []).Select(x => new TranscriptItem
        {
            Start = TimeSpan.FromMilliseconds(x.StartMs),
            End = TimeSpan.FromMilliseconds(x.EndMs),
            Text = x.Text ?? "",
            Keywords = (x.Keywords ?? []).ToList()
        }).ToArray();
        return new BatchTranscriptionResult(
            dto.FilePath,
            TimeSpan.FromMilliseconds(dto.DurationMs),
            items,
            TimeSpan.FromMilliseconds(dto.ProcessingMs),
            dto.DecoderName ?? "LocalSub.Core");
    }

    async Task<JsonElement> SendOperationAsync(
        string method,
        object payload,
        Action<string, JsonElement>? onEvent,
        CancellationToken ct)
    {
        ThrowIfDisposed();
        await _operationGate.WaitAsync(ct);
        try
        {
            var generation = await EnsureConnectedAsync(ct);
            var id = Guid.NewGuid().ToString("N");
            var pending = new PendingRequest(generation, onEvent);
            if (!_pending.TryAdd(id, pending)) throw new InvalidOperationException("无法登记 Core 请求。");
            try
            {
                await WriteMessageAsync(new { kind = "request", id, method, payload }, CancellationToken.None, generation);
                if (!ct.CanBeCanceled) return await pending.Completion.Task;

                try
                {
                    return await pending.Completion.Task.WaitAsync(ct);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    await HandleCallerCancellationAsync(id, generation, pending);
                    throw;
                }
            }
            finally
            {
                _pending.TryRemove(id, out _);
            }
        }
        finally
        {
            _operationGate.Release();
        }
    }

    async Task HandleCallerCancellationAsync(string requestId, int generation, PendingRequest pending)
    {
        try { await SendCancelAsync(requestId, generation); } catch { }

        var completed = await Task.WhenAny(pending.Completion.Task, Task.Delay(TimeSpan.FromMilliseconds(1500)));
        if (completed == pending.Completion.Task) return;

        LogClient($"CANCEL_TIMEOUT generation={generation} request={requestId}; terminating worker for clean recovery");
        TerminateCurrentWorker(generation, "cancel-timeout");
    }

    async Task SendCancelAsync(string requestId, int generation)
    {
        await WriteMessageAsync(new
        {
            kind = "request",
            id = "cancel-" + Guid.NewGuid().ToString("N"),
            method = "cancel",
            payload = new { requestId }
        }, CancellationToken.None, generation);
    }

    async Task<int> EnsureConnectedAsync(CancellationToken ct)
    {
        if (IsCurrentConnectionHealthy()) return Volatile.Read(ref _connectionGeneration);
        await _lifecycleGate.WaitAsync(ct);
        try
        {
            if (IsCurrentConnectionHealthy()) return Volatile.Read(ref _connectionGeneration);
            CleanupConnection();

            var exe = Path.Combine(PortablePaths.BaseDir, "LocalSub.Core.exe");
            if (!File.Exists(exe))
                throw new FileNotFoundException("LocalSub.Core.exe 不存在，请使用包含 Core 的新版增量包。", exe);

            var pipeName = $"LocalSub.Core.{Environment.ProcessId}.{Guid.NewGuid():N}";
            var start = new ProcessStartInfo
            {
                FileName = exe,
                WorkingDirectory = PortablePaths.BaseDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            start.ArgumentList.Add("--pipe");
            start.ArgumentList.Add(pipeName);
            start.ArgumentList.Add("--parent");
            start.ArgumentList.Add(Environment.ProcessId.ToString());

            var process = Process.Start(start) ?? throw new InvalidOperationException("无法启动 LocalSub.Core.exe。");
            var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            using var connectCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            connectCts.CancelAfter(TimeSpan.FromSeconds(8));
            try
            {
                await pipe.ConnectAsync(connectCts.Token);
            }
            catch (Exception ex)
            {
                try { if (!process.HasExited) process.Kill(true); } catch { }
                try { pipe.Dispose(); } catch { }
                try { process.Dispose(); } catch { }
                LogClient($"CONNECT_FAIL pid={SafePid(process)} {ex.GetType().Name}: {ex.Message}");
                if (ct.IsCancellationRequested) throw;
                throw new TimeoutException("LocalSub.Core 启动后 8 秒内没有建立 IPC 连接。", ex);
            }

            var reader = new StreamReader(pipe);
            var writer = new StreamWriter(pipe) { AutoFlush = true };
            var generation = Interlocked.Increment(ref _connectionGeneration);
            Volatile.Write(ref _brokenGeneration, 0);

            _process = process;
            _pipe = pipe;
            _reader = reader;
            _writer = writer;

            process.EnableRaisingEvents = true;
            process.Exited += (_, _) =>
            {
                var exitCode = SafeExitCode(process);
                MarkConnectionBroken(generation, new IOException($"LocalSub.Core 意外退出，ExitCode={exitCode}。下次任务会自动重启 Core。"));
            };

            _readerTask = Task.Run(() => ReadLoopAsync(pipe, reader, generation));
            LogClient($"CONNECTED generation={generation} pid={process.Id}");
            return generation;
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    bool IsCurrentConnectionHealthy()
    {
        var generation = Volatile.Read(ref _connectionGeneration);
        if (generation <= 0 || Volatile.Read(ref _brokenGeneration) == generation) return false;
        try { return _pipe?.IsConnected == true && _process is { HasExited: false }; }
        catch { return false; }
    }

    async Task ReadLoopAsync(NamedPipeClientStream pipe, StreamReader reader, int generation)
    {
        Exception? failure = null;
        try
        {
            while (pipe.IsConnected && !_disposed)
            {
                var line = await reader.ReadLineAsync();
                if (line == null) break;
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                var kind = root.TryGetProperty("kind", out var kindNode) ? kindNode.GetString() : null;
                var id = root.TryGetProperty("id", out var idNode) ? idNode.GetString() : null;
                if (string.IsNullOrWhiteSpace(id)) continue;

                if (kind == "event" && _pending.TryGetValue(id, out var eventPending) && eventPending.Generation == generation)
                {
                    var eventName = root.TryGetProperty("event", out var eventNode) ? eventNode.GetString() ?? "" : "";
                    var payload = root.TryGetProperty("payload", out var payloadNode) ? payloadNode.Clone() : default;
                    try { eventPending.OnEvent?.Invoke(eventName, payload); } catch { }
                    continue;
                }

                if (kind == "response" && _pending.TryGetValue(id, out var pending) && pending.Generation == generation)
                {
                    var ok = root.TryGetProperty("ok", out var okNode) && okNode.GetBoolean();
                    var cancelled = root.TryGetProperty("cancelled", out var cancelNode) && cancelNode.GetBoolean();
                    if (cancelled)
                    {
                        pending.Completion.TrySetException(new OperationCanceledException("LocalSub.Core 任务已取消。"));
                    }
                    else if (!ok)
                    {
                        var error = root.TryGetProperty("error", out var errorNode) ? errorNode.GetString() : null;
                        pending.Completion.TrySetException(new InvalidOperationException(error ?? "LocalSub.Core 操作失败。"));
                    }
                    else
                    {
                        var payload = root.TryGetProperty("payload", out var payloadNode) ? payloadNode.Clone() : JsonDocument.Parse("{}").RootElement.Clone();
                        pending.Completion.TrySetResult(payload);
                    }
                }
            }
        }
        catch (Exception ex) when (!_disposed)
        {
            failure = ex;
        }
        finally
        {
            if (!_disposed)
            {
                var reason = failure ?? new IOException("LocalSub.Core IPC 已断开。下次任务会自动重启 Core。");
                MarkConnectionBroken(generation, reason);
            }
        }
    }

    async Task WriteMessageAsync(object message, CancellationToken ct, int expectedGeneration)
    {
        if (expectedGeneration != Volatile.Read(ref _connectionGeneration) || Volatile.Read(ref _brokenGeneration) == expectedGeneration)
            throw new IOException("LocalSub.Core IPC 已失效。下次任务会自动重启 Core。");

        var writer = _writer ?? throw new IOException("LocalSub.Core IPC 尚未连接。");
        var json = JsonSerializer.Serialize(message, JsonOptions);
        await _writeGate.WaitAsync(ct);
        try
        {
            if (expectedGeneration != Volatile.Read(ref _connectionGeneration) || Volatile.Read(ref _brokenGeneration) == expectedGeneration)
                throw new IOException("LocalSub.Core IPC 已在写入前失效。");
            await writer.WriteLineAsync(json);
        }
        catch (Exception ex)
        {
            MarkConnectionBroken(expectedGeneration, ex);
            throw new IOException("写入 LocalSub.Core IPC 失败。下次任务会自动重启 Core。", ex);
        }
        finally { _writeGate.Release(); }
    }

    void MarkConnectionBroken(int generation, Exception ex)
    {
        if (_disposed || generation != Volatile.Read(ref _connectionGeneration)) return;
        if (Volatile.Read(ref _brokenGeneration) == generation) return;
        Volatile.Write(ref _brokenGeneration, generation);
        LogClient($"DISCONNECTED generation={generation} pid={WorkerProcessId?.ToString() ?? "n/a"} {ex.GetType().Name}: {ex.Message}");
        FailPendingForGeneration(generation, ex is IOException ? ex : new IOException("LocalSub.Core 连接异常。下次任务会自动重启 Core。", ex));
    }

    void TerminateCurrentWorker(int generation, string reason)
    {
        if (generation != Volatile.Read(ref _connectionGeneration)) return;
        var process = _process;
        MarkConnectionBroken(generation, new IOException($"LocalSub.Core 因 {reason} 被回收，下一次任务会自动重启。"));
        try { if (process is { HasExited: false }) process.Kill(true); } catch { }
    }

    void FailPendingForGeneration(int generation, Exception ex)
    {
        foreach (var pair in _pending)
            if (pair.Value.Generation == generation) pair.Value.Completion.TrySetException(ex);
    }

    void FailAllPending(Exception ex)
    {
        foreach (var pair in _pending) pair.Value.Completion.TrySetException(ex);
    }

    void CleanupConnection()
    {
        try { _reader?.Dispose(); } catch { }
        try { _writer?.Dispose(); } catch { }
        try { _pipe?.Dispose(); } catch { }
        try { _process?.Dispose(); } catch { }
        _reader = null;
        _writer = null;
        _pipe = null;
        _process = null;
        _readerTask = null;
    }

    static int SafePid(Process process)
    {
        try { return process.Id; } catch { return -1; }
    }

    static int SafeExitCode(Process process)
    {
        try { return process.HasExited ? process.ExitCode : -1; } catch { return -1; }
    }

    static void LogClient(string text)
    {
        try
        {
            PortablePaths.EnsureBaseFolders();
            File.AppendAllText(
                Path.Combine(PortablePaths.LogsDir, "core-client.log"),
                $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {text}{Environment.NewLine}");
        }
        catch { }
    }

    void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(CoreWorkerClient));
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        var generation = Volatile.Read(ref _connectionGeneration);
        try
        {
            if (_writer != null && generation > 0 && Volatile.Read(ref _brokenGeneration) != generation)
                await WriteMessageAsync(new { kind = "request", id = "shutdown", method = "shutdown", payload = new { } }, CancellationToken.None, generation);
        }
        catch { }

        _disposed = true;
        var process = _process;
        if (process is { HasExited: false })
        {
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1));
                await process.WaitForExitAsync(timeout.Token);
            }
            catch
            {
                try { if (!process.HasExited) process.Kill(true); } catch { }
            }
        }
        FailAllPending(new ObjectDisposedException(nameof(CoreWorkerClient)));
        CleanupConnection();
        _lifecycleGate.Dispose();
        _writeGate.Dispose();
        _operationGate.Dispose();
    }

    sealed class PendingRequest
    {
        public int Generation { get; }
        public TaskCompletionSource<JsonElement> Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Action<string, JsonElement>? OnEvent { get; }
        public PendingRequest(int generation, Action<string, JsonElement>? onEvent)
        {
            Generation = generation;
            OnEvent = onEvent;
        }
    }

    sealed class AnalysisDto
    {
        public string FilePath { get; set; } = "";
        public long DurationMs { get; set; }
        public int SampleRate { get; set; }
        public int Channels { get; set; }
        public float[]? Waveform { get; set; }
        public double SecondsPerPoint { get; set; }
        public string? DecoderName { get; set; }
    }

    sealed class TranscriptionDto
    {
        public string FilePath { get; set; } = "";
        public long DurationMs { get; set; }
        public long ProcessingMs { get; set; }
        public string? DecoderName { get; set; }
        public TranscriptDto[]? Items { get; set; }
    }

    sealed class TranscriptDto
    {
        public long StartMs { get; set; }
        public long EndMs { get; set; }
        public string? Text { get; set; }
        public string[]? Keywords { get; set; }
    }
}
