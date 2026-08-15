using System.Threading.Channels;
using LocalSub.Models;

namespace LocalSub.Services;

public sealed class LiveAsrPipeline : IAsyncDisposable
{
    readonly AllAudioCaptureService _allAudio = new();
    readonly ProcessLoopbackCaptureService _processAudio = new();
    readonly StreamingParaformerService _streaming = new();
    readonly SenseVoiceSimulatedStreamingService _senseVoice = new();
    Channel<float[]>? _queue;
    CancellationTokenSource? _cts;
    Task? _worker;
    bool _running;
    bool _useSenseVoice;

    public event Action<float>? LevelChanged;
    public event Action<string>? PartialResult;
    public event Action<string>? FinalResult;
    public event Action<string>? StatusChanged;

    public LiveAsrPipeline()
    {
        _allAudio.LevelChanged += v => LevelChanged?.Invoke(v);
        _allAudio.SamplesAvailable += OnSamples;
        _processAudio.LevelChanged += v => LevelChanged?.Invoke(v);
        _processAudio.SamplesAvailable += OnSamples;
        _streaming.PartialResult += text => PartialResult?.Invoke(text);
        _streaming.FinalResult += text => FinalResult?.Invoke(text);
        _senseVoice.FinalResult += text => FinalResult?.Invoke(text);
    }

    public Task StartAllAudioAsync(AppSettings settings, ModelDescriptor model, ModelManager models, IProgress<ModelOperationProgress>? runtimeProgress = null, CancellationToken ct = default)
        => StartAsync(settings, model, models, null, runtimeProgress, ct);

    public Task StartPotPlayerAsync(AppSettings settings, ModelDescriptor model, ModelManager models, uint processId, IProgress<ModelOperationProgress>? runtimeProgress = null, CancellationToken ct = default)
        => StartAsync(settings, model, models, processId, runtimeProgress, ct);

    async Task StartAsync(AppSettings settings, ModelDescriptor model, ModelManager models, uint? processId, IProgress<ModelOperationProgress>? runtimeProgress, CancellationToken ct)
    {
        await StopAsync();

        if (processId.HasValue) ProcessLoopbackCaptureService.EnsureSupported();

        if (!models.IsInstalled(model))
            throw new InvalidOperationException($"实时模型“{model.Name}”尚未安装，请先在“模型”页面下载。");

        var isStreaming = model.Id.StartsWith("streaming-paraformer-", StringComparison.OrdinalIgnoreCase);
        var isSenseVoice = string.Equals(model.Id, "sensevoice-small-int8", StringComparison.OrdinalIgnoreCase);
        if (!isStreaming && !isSenseVoice)
            throw new NotSupportedException("当前实时字幕支持 Streaming Paraformer 与 SenseVoice Small INT8（模拟流式）。");

        StatusChanged?.Invoke("检查 ASR 运行库");
        var runtime = new AsrRuntimeManager(settings);
        await runtime.EnsureAsync(runtimeProgress, ct);

        if (isSenseVoice)
        {
            var vadDescriptor = new ModelCatalogService().Load()
                .FirstOrDefault(x => string.Equals(x.Id, "silero-vad", StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("模型 catalog 中缺少 Silero VAD。");

            if (!models.IsInstalled(vadDescriptor))
            {
                StatusChanged?.Invoke("SenseVoice 需要 Silero VAD，正在自动下载约 2 MB 组件");
                await models.DownloadAsync(vadDescriptor, runtimeProgress, ct);
            }

            var vadPath = Path.Combine(models.GetModelFolder(vadDescriptor), "silero_vad.onnx");
            StatusChanged?.Invoke("加载 SenseVoice 与 Silero VAD");
            _senseVoice.Start(model, models.GetModelFolder(model), vadPath, runtime.RuntimeRoot);
            _useSenseVoice = true;
        }
        else
        {
            StatusChanged?.Invoke("加载 Streaming Paraformer");
            _streaming.Start(model, models.GetModelFolder(model), runtime.RuntimeRoot);
            _useSenseVoice = false;
        }

        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _queue = Channel.CreateBounded<float[]>(new BoundedChannelOptions(64)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.DropOldest
        });
        _worker = Task.Run(() => DecodeLoopAsync(_cts.Token), _cts.Token);

        try
        {
            if (processId.HasValue)
            {
                StatusChanged?.Invoke($"启动 PotPlayer 专用音频捕获，PID {processId.Value}");
                await _processAudio.StartAsync(processId.Value, _cts.Token);
            }
            else
            {
                StatusChanged?.Invoke("启动所有 Windows 输出音频捕获");
                _allAudio.Start();
            }

            _running = true;
            StatusChanged?.Invoke(_useSenseVoice
                ? "SenseVoice 模拟流式识别中，检测到停顿后出句"
                : "Streaming Paraformer 实时识别中");
        }
        catch
        {
            await StopAsync();
            throw;
        }
    }

    void OnSamples(float[] samples)
    {
        if (!_running || samples.Length == 0) return;
        _queue?.Writer.TryWrite(samples);
    }

    async Task DecodeLoopAsync(CancellationToken ct)
    {
        var reader = _queue!.Reader;
        try
        {
            while (await reader.WaitToReadAsync(ct))
            {
                while (reader.TryRead(out var samples))
                {
                    ct.ThrowIfCancellationRequested();
                    if (_useSenseVoice) _senseVoice.AcceptSamples(samples);
                    else _streaming.AcceptSamples(samples);
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception ex)
        {
            StatusChanged?.Invoke("识别失败：" + ex.Message);
        }
    }

    public async Task StopAsync()
    {
        _running = false;
        _allAudio.Stop();
        await _processAudio.StopAsync();
        if (_queue != null) _queue.Writer.TryComplete();
        if (_cts != null)
        {
            try { _cts.Cancel(); } catch { }
        }
        if (_worker != null)
        {
            try { await _worker; } catch (OperationCanceledException) { }
        }
        _worker = null;
        _queue = null;
        _cts?.Dispose();
        _cts = null;
        _streaming.Stop();
        _senseVoice.Stop();
        _useSenseVoice = false;
        LevelChanged?.Invoke(0);
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _allAudio.Dispose();
        _processAudio.Dispose();
        _streaming.Dispose();
        _senseVoice.Dispose();
    }
}
