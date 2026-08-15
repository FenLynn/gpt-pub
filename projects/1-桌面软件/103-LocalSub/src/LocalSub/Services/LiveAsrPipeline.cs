using System.Threading.Channels;
using LocalSub.Models;

namespace LocalSub.Services;

public sealed class LiveAsrPipeline : IAsyncDisposable
{
    readonly AllAudioCaptureService _allAudio = new();
    readonly ProcessLoopbackCaptureService _processAudio = new();
    readonly StreamingParaformerService _recognizer = new();
    Channel<float[]>? _queue;
    CancellationTokenSource? _cts;
    Task? _worker;
    bool _running;

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
        _recognizer.PartialResult += text => PartialResult?.Invoke(text);
        _recognizer.FinalResult += text => FinalResult?.Invoke(text);
    }

    public Task StartAllAudioAsync(AppSettings settings, ModelDescriptor model, ModelManager models, IProgress<ModelOperationProgress>? runtimeProgress = null, CancellationToken ct = default)
        => StartAsync(settings, model, models, null, runtimeProgress, ct);

    public Task StartPotPlayerAsync(AppSettings settings, ModelDescriptor model, ModelManager models, uint processId, IProgress<ModelOperationProgress>? runtimeProgress = null, CancellationToken ct = default)
        => StartAsync(settings, model, models, processId, runtimeProgress, ct);

    async Task StartAsync(AppSettings settings, ModelDescriptor model, ModelManager models, uint? processId, IProgress<ModelOperationProgress>? runtimeProgress, CancellationToken ct)
    {
        await StopAsync();

        // Do this before downloading/loading sherpa so an unsupported Windows build fails immediately
        // with a useful message instead of a COM E_NOINTERFACE error.
        if (processId.HasValue) ProcessLoopbackCaptureService.EnsureSupported();

        if (!models.IsInstalled(model))
            throw new InvalidOperationException($"实时模型“{model.Name}”尚未安装，请先在“模型”页面下载。 ");
        if (!model.Id.StartsWith("streaming-paraformer-", StringComparison.OrdinalIgnoreCase))
            throw new NotSupportedException("实时字幕当前请使用 Streaming Paraformer。SenseVoice 保留用于后台与后续模拟流式。 ");

        StatusChanged?.Invoke("检查 ASR 运行库");
        var runtime = new AsrRuntimeManager(settings);
        await runtime.EnsureAsync(runtimeProgress, ct);

        StatusChanged?.Invoke("加载实时模型");
        _recognizer.Start(model, models.GetModelFolder(model), runtime.RuntimeRoot);

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
            StatusChanged?.Invoke("实时识别中");
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
                    _recognizer.AcceptSamples(samples);
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
        _recognizer.Stop();
        LevelChanged?.Invoke(0);
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _allAudio.Dispose();
        _processAudio.Dispose();
        _recognizer.Dispose();
    }
}
