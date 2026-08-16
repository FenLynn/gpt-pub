using System.Threading.Channels;
using LocalSub.Models;

namespace LocalSub.Services;

public sealed class LiveAsrPipeline : IAsyncDisposable
{
    readonly AllAudioCaptureService _allAudio = new();
    readonly ResilientPotPlayerCaptureService _processAudio = new();
    readonly StreamingParaformerService _streaming = new();
    readonly SenseVoiceSimulatedStreamingService _senseVoice = new();
    readonly FunAsrNanoSimulatedStreamingService _funAsrNano = new();
    Channel<float[]>? _queue;
    CancellationTokenSource? _cts;
    Task? _worker;
    bool _running;
    bool _useSenseVoice;
    bool _useFunAsrNano;
    string _streamingLabel = "Streaming ASR";

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
        _processAudio.StatusChanged += text => StatusChanged?.Invoke(text);
        _streaming.PartialResult += text => PartialResult?.Invoke(text);
        _streaming.FinalResult += text => FinalResult?.Invoke(text);
        _senseVoice.PartialResult += text => PartialResult?.Invoke(text);
        _senseVoice.FinalResult += text => FinalResult?.Invoke(text);
        _senseVoice.StatusChanged += text => StatusChanged?.Invoke(text);
        _funAsrNano.FinalResult += text => FinalResult?.Invoke(text);
        _funAsrNano.StatusChanged += text => StatusChanged?.Invoke(text);
    }

    public Task StartAllAudioAsync(AppSettings settings, ModelDescriptor model, ModelManager models, IProgress<ModelOperationProgress>? runtimeProgress = null, CancellationToken ct = default)
        => StartAsync(settings, model, models, null, runtimeProgress, ct);

    public Task StartPotPlayerAsync(AppSettings settings, ModelDescriptor model, ModelManager models, uint processId, IProgress<ModelOperationProgress>? runtimeProgress = null, CancellationToken ct = default)
        => StartAsync(settings, model, models, processId, runtimeProgress, ct);

    async Task StartAsync(AppSettings settings, ModelDescriptor model, ModelManager models, uint? processId, IProgress<ModelOperationProgress>? runtimeProgress, CancellationToken ct)
    {
        await StopAsync();
        if (processId.HasValue) ResilientPotPlayerCaptureService.EnsureSupported();
        if (!models.IsInstalled(model)) throw new InvalidOperationException($"实时模型“{model.Name}”尚未安装，请先在“模型”页面下载。");

        var isParaformer = model.Id.StartsWith("streaming-paraformer-", StringComparison.OrdinalIgnoreCase);
        var isZipformer = model.Id.StartsWith("streaming-zipformer-", StringComparison.OrdinalIgnoreCase);
        var isStreaming = isParaformer || isZipformer;
        var isSenseVoice = string.Equals(model.Id, "sensevoice-small-int8", StringComparison.OrdinalIgnoreCase);
        var isFunAsrNano = string.Equals(model.Id, "funasr-nano-int8", StringComparison.OrdinalIgnoreCase);
        if (!isStreaming && !isSenseVoice && !isFunAsrNano)
            throw new NotSupportedException("当前实时字幕支持 Streaming Paraformer、Streaming Zipformer、SenseVoice Small INT8 与 Fun-ASR-Nano INT8。后两者为 VAD 分段模拟流式。");

        StatusChanged?.Invoke("检查 ASR 运行库");
        var runtime = new AsrRuntimeManager(settings);
        await runtime.EnsureAsync(runtimeProgress, ct);

        var needsVad = isSenseVoice || isFunAsrNano;
        string? vadPath = null;
        if (needsVad)
        {
            var vadDescriptor = new ModelCatalogService().Load().FirstOrDefault(x => string.Equals(x.Id, "silero-vad", StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("模型 catalog 中缺少 Silero VAD。");
            if (!models.IsInstalled(vadDescriptor))
            {
                StatusChanged?.Invoke($"{model.Name} 需要 Silero VAD，正在自动下载约 2 MB 组件");
                await models.DownloadAsync(vadDescriptor, runtimeProgress, ct);
            }
            vadPath = Path.Combine(models.GetModelFolder(vadDescriptor), "silero_vad.onnx");
        }

        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _queue = Channel.CreateBounded<float[]>(new BoundedChannelOptions(64)
        {
            SingleReader = true,
            SingleWriter = false,
            FullMode = BoundedChannelFullMode.DropOldest
        });
        _useSenseVoice = isSenseVoice;
        _useFunAsrNano = isFunAsrNano;
        _streamingLabel = isSenseVoice ? "SenseVoice" : isFunAsrNano ? "Fun-ASR-Nano" : model.Name.Replace(" INT8", "");
        _running = true;

        try
        {
            Task modelLoadTask;
            if (isSenseVoice)
            {
                StatusChanged?.Invoke("后台加载 SenseVoice 与 Silero VAD");
                var localVadPath = vadPath!;
                modelLoadTask = Task.Run(() => _senseVoice.Start(model, models.GetModelFolder(model), localVadPath, runtime.RuntimeRoot), _cts.Token);
            }
            else if (isFunAsrNano)
            {
                StatusChanged?.Invoke("后台加载 Fun-ASR-Nano 与 Silero VAD；该模型较大，首次加载会更慢");
                var localVadPath = vadPath!;
                modelLoadTask = Task.Run(() => _funAsrNano.Start(model, models.GetModelFolder(model), localVadPath, runtime.RuntimeRoot), _cts.Token);
            }
            else
            {
                var threads = PerformancePolicy.RealtimeThreads(settings.ResourceProfile);
                StatusChanged?.Invoke($"后台加载 {_streamingLabel}，{ProfileName(settings.ResourceProfile)} {threads} 线程");
                modelLoadTask = Task.Run(() => _streaming.Start(model, models.GetModelFolder(model), runtime.RuntimeRoot, threads), _cts.Token);
            }

            Task captureStartTask;
            if (processId.HasValue)
            {
                StatusChanged?.Invoke($"并行连接 PotPlayer 音频，PID {processId.Value}");
                captureStartTask = _processAudio.StartAsync(processId.Value, _cts.Token);
            }
            else
            {
                StatusChanged?.Invoke("启动所有 Windows 输出音频捕获");
                _allAudio.Start();
                captureStartTask = Task.CompletedTask;
            }

            await Task.WhenAll(modelLoadTask, captureStartTask);
            _worker = Task.Run(() => DecodeLoopAsync(_cts.Token), _cts.Token);
            StatusChanged?.Invoke(_useSenseVoice
                ? "SenseVoice 模拟流式识别中，VAD 与音量 fallback 会共同检测语音"
                : _useFunAsrNano
                    ? "Fun-ASR-Nano 模拟流式识别中，停顿后输出整句；准确率优先但延迟较高"
                    : processId.HasValue
                        ? $"{_streamingLabel} 实时识别中，PotPlayer 换片会自动续接音频"
                        : $"{_streamingLabel} 实时识别中");
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
                    else if (_useFunAsrNano) _funAsrNano.AcceptSamples(samples);
                    else _streaming.AcceptSamples(samples);
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (Exception ex) { StatusChanged?.Invoke("识别失败：" + ex.Message); }
    }

    public async Task StopAsync()
    {
        _running = false;
        _allAudio.Stop();
        await _processAudio.StopAsync();
        if (_queue != null) _queue.Writer.TryComplete();
        if (_cts != null) { try { _cts.Cancel(); } catch { } }
        if (_worker != null) { try { await _worker; } catch (OperationCanceledException) { } }
        _worker = null;
        _queue = null;
        _cts?.Dispose();
        _cts = null;
        _streaming.Stop();
        _senseVoice.Stop();
        _funAsrNano.Stop();
        _useSenseVoice = false;
        _useFunAsrNano = false;
        _streamingLabel = "Streaming ASR";
        LevelChanged?.Invoke(0);
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _allAudio.Dispose();
        _processAudio.Dispose();
        _streaming.Dispose();
        _senseVoice.Dispose();
        _funAsrNano.Dispose();
    }

    static string ProfileName(ResourceProfile profile) => profile switch
    {
        ResourceProfile.Eco => "节能",
        ResourceProfile.MaxPerformance => "最大性能",
        _ => "自动"
    };
}
