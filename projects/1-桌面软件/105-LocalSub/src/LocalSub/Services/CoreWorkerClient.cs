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
    bool _disposed;

    static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public async Task PingAsync(CancellationToken ct = default)
        => _ = await SendOperationAsync("ping", new { }, null, ct);

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
            await EnsureConnectedAsync(ct);
            var id = Guid.NewGuid().ToString("N");
            var pending = new PendingRequest(onEvent);
            if (!_pending.TryAdd(id, pending)) throw new InvalidOperationException("无法登记 Core 请求。");
            using var registration = ct.Register(() => _ = SendCancelAsync(id));
            try
            {
                await WriteMessageAsync(new { kind = "request", id, method, payload }, CancellationToken.None);
                return await pending.Completion.Task;
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

    async Task SendCancelAsync(string requestId)
    {
        try
        {
            if (_writer == null) return;
            await WriteMessageAsync(new
            {
                kind = "request",
                id = "cancel-" + Guid.NewGuid().ToString("N"),
                method = "cancel",
                payload = new { requestId }
            }, CancellationToken.None);
        }
        catch { }
    }

    async Task EnsureConnectedAsync(CancellationToken ct)
    {
        if (_pipe?.IsConnected == true && _process is { HasExited: false }) return;
        await _lifecycleGate.WaitAsync(ct);
        try
        {
            if (_pipe?.IsConnected == true && _process is { HasExited: false }) return;
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
            _process = Process.Start(start) ?? throw new InvalidOperationException("无法启动 LocalSub.Core.exe。");

            _pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            using var connectCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            connectCts.CancelAfter(TimeSpan.FromSeconds(8));
            try
            {
                await _pipe.ConnectAsync(connectCts.Token);
            }
            catch
            {
                try { if (!_process.HasExited) _process.Kill(true); } catch { }
                CleanupConnection();
                throw new TimeoutException("LocalSub.Core 启动后 8 秒内没有建立 IPC 连接。");
            }

            _reader = new StreamReader(_pipe);
            _writer = new StreamWriter(_pipe) { AutoFlush = true };
            _readerTask = Task.Run(ReadLoopAsync);
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    async Task ReadLoopAsync()
    {
        Exception? failure = null;
        try
        {
            while (_pipe?.IsConnected == true && !_disposed)
            {
                var line = await _reader!.ReadLineAsync();
                if (line == null) break;
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                var kind = root.TryGetProperty("kind", out var kindNode) ? kindNode.GetString() : null;
                var id = root.TryGetProperty("id", out var idNode) ? idNode.GetString() : null;
                if (string.IsNullOrWhiteSpace(id)) continue;

                if (kind == "event" && _pending.TryGetValue(id, out var eventPending))
                {
                    var eventName = root.TryGetProperty("event", out var eventNode) ? eventNode.GetString() ?? "" : "";
                    var payload = root.TryGetProperty("payload", out var payloadNode) ? payloadNode.Clone() : default;
                    try { eventPending.OnEvent?.Invoke(eventName, payload); } catch { }
                    continue;
                }

                if (kind == "response" && _pending.TryGetValue(id, out var pending))
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
                FailPending(failure ?? new IOException("LocalSub.Core IPC 已断开。下次任务会自动重启 Core。"));
        }
    }

    async Task WriteMessageAsync(object message, CancellationToken ct)
    {
        var writer = _writer ?? throw new IOException("LocalSub.Core IPC 尚未连接。");
        var json = JsonSerializer.Serialize(message, JsonOptions);
        await _writeGate.WaitAsync(ct);
        try { await writer.WriteLineAsync(json); }
        finally { _writeGate.Release(); }
    }

    void FailPending(Exception ex)
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

    void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(CoreWorkerClient));
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        try
        {
            if (_writer != null)
                await WriteMessageAsync(new { kind = "request", id = "shutdown", method = "shutdown", payload = new { } }, CancellationToken.None);
        }
        catch { }

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
        FailPending(new ObjectDisposedException(nameof(CoreWorkerClient)));
        CleanupConnection();
        _lifecycleGate.Dispose();
        _writeGate.Dispose();
        _operationGate.Dispose();
    }

    sealed class PendingRequest
    {
        public TaskCompletionSource<JsonElement> Completion { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Action<string, JsonElement>? OnEvent { get; }
        public PendingRequest(Action<string, JsonElement>? onEvent) => OnEvent = onEvent;
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
