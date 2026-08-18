using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;
using LocalSub.Core;
using LocalSub.Models;
using LocalSub.Services;

namespace LocalSub.CoreWorker;

internal static class Program
{
    static async Task<int> Main(string[] args)
    {
        try
        {
            PortablePaths.EnsureBaseFolders();
            var pipeName = ReadArg(args, "--pipe");
            if (string.IsNullOrWhiteSpace(pipeName))
                throw new ArgumentException("LocalSub.Core requires --pipe <name>.");

            var parentText = ReadArg(args, "--parent");
            _ = int.TryParse(parentText, out var parentPid);
            await using var host = new CoreWorkerHost(pipeName, parentPid);
            await host.RunAsync();
            return 0;
        }
        catch (Exception ex)
        {
            CoreWorkerHost.Log("FATAL " + ex);
            return 1;
        }
    }

    static string? ReadArg(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
            if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
        return null;
    }
}

internal sealed class CoreWorkerHost : IAsyncDisposable
{
    readonly string _pipeName;
    readonly int _parentPid;
    readonly CancellationTokenSource _shutdown = new();
    readonly SemaphoreSlim _writeGate = new(1, 1);
    readonly object _operationGate = new();
    NamedPipeServerStream? _pipe;
    StreamReader? _reader;
    StreamWriter? _writer;
    CancellationTokenSource? _activeOperation;
    string? _activeRequestId;

    static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public CoreWorkerHost(string pipeName, int parentPid)
    {
        _pipeName = pipeName;
        _parentPid = parentPid;
    }

    public async Task RunAsync()
    {
        _pipe = new NamedPipeServerStream(
            _pipeName,
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous);
        Log($"START pid={Environment.ProcessId} parent={_parentPid} pipe={_pipeName}");

        var parentWatch = _parentPid > 0 ? WatchParentAsync(_shutdown.Token) : Task.CompletedTask;
        await _pipe.WaitForConnectionAsync(_shutdown.Token);
        _reader = new StreamReader(_pipe);
        _writer = new StreamWriter(_pipe) { AutoFlush = true };
        Log("CONNECTED");

        try
        {
            while (!_shutdown.IsCancellationRequested && _pipe.IsConnected)
            {
                var line = await _reader.ReadLineAsync(_shutdown.Token);
                if (line == null) break;
                WorkerRequest? request;
                try
                {
                    request = JsonSerializer.Deserialize<WorkerRequest>(line, JsonOptions);
                }
                catch (Exception ex)
                {
                    Log("BAD_REQUEST " + ex.Message);
                    continue;
                }
                if (request == null || string.IsNullOrWhiteSpace(request.Id) || string.IsNullOrWhiteSpace(request.Method)) continue;
                await DispatchAsync(request);
            }
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested) { }
        finally
        {
            _shutdown.Cancel();
            CancelActive(null);
            try { await parentWatch; } catch { }
            Log("DISCONNECTED");
        }
    }

    async Task DispatchAsync(WorkerRequest request)
    {
        switch (request.Method.ToLowerInvariant())
        {
            case "ping":
                await SendResponseAsync(request.Id, true, new { pid = Environment.ProcessId, version = "0.1.0", architecture = "core-worker-v1" }, null);
                break;
            case "cancel":
                var target = GetString(request.Payload, "requestId");
                var cancelled = CancelActive(target);
                await SendResponseAsync(request.Id, true, new { cancelled, requestId = target }, null);
                break;
            case "shutdown":
                CancelActive(null);
                await SendResponseAsync(request.Id, true, new { shuttingDown = true }, null);
                _shutdown.Cancel();
                break;
            case "analyze":
                StartOperation(request, AnalyzeAsync);
                break;
            case "transcribe":
                StartOperation(request, TranscribeAsync);
                break;
            default:
                await SendResponseAsync(request.Id, false, null, "Unknown core method: " + request.Method);
                break;
        }
    }

    void StartOperation(WorkerRequest request, Func<WorkerRequest, CancellationToken, Task<object>> body)
    {
        CancellationTokenSource cts;
        lock (_operationGate)
        {
            if (_activeOperation != null)
            {
                _ = SendResponseAsync(request.Id, false, null, $"LocalSub.Core 正在处理 {_activeRequestId}，请稍候或先取消当前任务。");
                return;
            }
            cts = CancellationTokenSource.CreateLinkedTokenSource(_shutdown.Token);
            _activeOperation = cts;
            _activeRequestId = request.Id;
        }

        _ = Task.Run(async () =>
        {
            try
            {
                Log($"OP_START id={request.Id} method={request.Method}");
                var payload = await body(request, cts.Token);
                await SendResponseAsync(request.Id, true, payload, null);
                Log($"OP_DONE id={request.Id} method={request.Method}");
            }
            catch (OperationCanceledException) when (cts.IsCancellationRequested)
            {
                await SendResponseAsync(request.Id, false, null, "任务已取消", cancelled: true);
                Log($"OP_CANCEL id={request.Id} method={request.Method}");
            }
            catch (Exception ex)
            {
                Log($"OP_FAIL id={request.Id} method={request.Method} {ex}");
                await SendResponseAsync(request.Id, false, null, ex.Message);
            }
            finally
            {
                lock (_operationGate)
                {
                    if (ReferenceEquals(_activeOperation, cts))
                    {
                        _activeOperation = null;
                        _activeRequestId = null;
                    }
                }
                cts.Dispose();
            }
        });
    }

    async Task<object> AnalyzeAsync(WorkerRequest request, CancellationToken ct)
    {
        var filePath = RequireString(request.Payload, "filePath");
        var settings = AppSettings.Load();
        var progress = new Progress<MediaAnalysisProgress>(p =>
            _ = SendEventAsync(request.Id, "analysis-progress", p));
        var result = await new MediaAnalysisService().AnalyzeAsync(filePath, settings, progress, ct);
        return new
        {
            filePath = result.FilePath,
            durationMs = (long)Math.Round(result.Duration.TotalMilliseconds),
            result.SampleRate,
            result.Channels,
            waveform = result.Waveform,
            result.SecondsPerPoint,
            result.DecoderName
        };
    }

    async Task<object> TranscribeAsync(WorkerRequest request, CancellationToken ct)
    {
        var filePath = RequireString(request.Payload, "filePath");
        var modelId = RequireString(request.Payload, "modelId");
        var keywords = GetStringArray(request.Payload, "keywords");
        var settings = AppSettings.Load();
        var catalog = new ModelCatalogService().Load();
        var model = catalog.FirstOrDefault(x => string.Equals(x.Id, modelId, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException($"模型 catalog 中找不到 {modelId}。");
        var models = new ModelManager(settings);
        var batchProgress = new Progress<BatchTranscriptionProgress>(p =>
            _ = SendEventAsync(request.Id, "batch-progress", p));
        var modelProgress = new Progress<ModelOperationProgress>(p =>
            _ = SendEventAsync(request.Id, "model-progress", p));

        var result = await new BatchTranscriptionService().TranscribeAsync(
            filePath,
            settings,
            model,
            models,
            keywords,
            batchProgress,
            modelProgress,
            ct);

        return new
        {
            filePath = result.FilePath,
            durationMs = (long)Math.Round(result.Duration.TotalMilliseconds),
            processingMs = (long)Math.Round(result.ProcessingTime.TotalMilliseconds),
            result.DecoderName,
            items = result.Items.Select(x => new
            {
                startMs = (long)Math.Round(x.Start.TotalMilliseconds),
                endMs = (long)Math.Round(x.End.TotalMilliseconds),
                x.Text,
                keywords = x.Keywords.ToArray()
            }).ToArray()
        };
    }

    bool CancelActive(string? requestId)
    {
        lock (_operationGate)
        {
            if (_activeOperation == null) return false;
            if (!string.IsNullOrWhiteSpace(requestId) && !string.Equals(requestId, _activeRequestId, StringComparison.Ordinal)) return false;
            try { _activeOperation.Cancel(); } catch { }
            return true;
        }
    }

    async Task SendEventAsync(string id, string eventName, object payload)
        => await SendMessageAsync(new { kind = "event", id, @event = eventName, payload });

    async Task SendResponseAsync(string id, bool ok, object? payload, string? error, bool cancelled = false)
        => await SendMessageAsync(new { kind = "response", id, ok, cancelled, payload, error });

    async Task SendMessageAsync(object message)
    {
        var writer = _writer;
        if (writer == null || _shutdown.IsCancellationRequested) return;
        var json = JsonSerializer.Serialize(message, JsonOptions);
        await _writeGate.WaitAsync();
        try
        {
            if (_writer != null && _pipe?.IsConnected == true) await _writer.WriteLineAsync(json);
        }
        catch { }
        finally { _writeGate.Release(); }
    }

    async Task WatchParentAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(1000, ct);
            try
            {
                using var parent = Process.GetProcessById(_parentPid);
                if (!parent.HasExited) continue;
            }
            catch { }
            Log("PARENT_EXIT");
            _shutdown.Cancel();
            CancelActive(null);
            break;
        }
    }

    static string RequireString(JsonElement payload, string name)
        => GetString(payload, name) is { Length: > 0 } value ? value : throw new ArgumentException($"Missing payload.{name}");

    static string? GetString(JsonElement payload, string name)
        => payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    static string[] GetStringArray(JsonElement payload, string name)
    {
        if (payload.ValueKind != JsonValueKind.Object || !payload.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array) return [];
        return value.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x!).ToArray();
    }

    public static void Log(string text)
    {
        try
        {
            PortablePaths.EnsureBaseFolders();
            File.AppendAllText(Path.Combine(PortablePaths.LogsDir, "core.log"), $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {text}{Environment.NewLine}");
        }
        catch { }
    }

    public async ValueTask DisposeAsync()
    {
        _shutdown.Cancel();
        CancelActive(null);
        _reader?.Dispose();
        if (_writer != null) await _writer.DisposeAsync();
        _pipe?.Dispose();
        _writeGate.Dispose();
        _shutdown.Dispose();
    }
}

internal sealed record WorkerRequest(string Kind, string Id, string Method, JsonElement Payload);
