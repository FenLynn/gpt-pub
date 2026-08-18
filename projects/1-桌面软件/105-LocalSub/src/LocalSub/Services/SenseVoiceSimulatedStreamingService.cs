using System.Text.RegularExpressions;
using LocalSub.Models;
using SherpaOnnx;

namespace LocalSub.Services;

public sealed class SenseVoiceSimulatedStreamingService : IDisposable
{
    const int SampleRate = 16000;
    const int VadWindowSize = 512;
    const int IdleKeepWindows = 10;
    const int InterimIntervalMs = 650;
    const float EnergyStartRms = 0.008f;
    const float EnergyKeepRms = 0.0035f;
    const int EnergyStartWindows = 4;
    const int EnergySilenceMs = 550;
    const int MaxUtteranceMs = 6500;

    OfflineRecognizer? _recognizer;
    VoiceActivityDetector? _vad;
    readonly List<float> _buffer = [];
    int _vadOffset;
    bool _speechStarted;
    DateTime _speechStartedAt;
    DateTime _lastVoiceAt;
    DateTime _nextInterimAt;
    string _lastPartial = "";
    int _energyHotWindows;
    int _emptyDecodeCount;
    bool _startedByEnergyFallback;

    public event Action<string>? PartialResult;
    public event Action<string>? FinalResult;
    public event Action<string>? StatusChanged;

    public void Start(ModelDescriptor model, string modelFolder, string vadModelPath, string runtimeFolder)
    {
        Stop();
        if (!string.Equals(model.Id, "sensevoice-small-int8", StringComparison.OrdinalIgnoreCase))
            throw new NotSupportedException("该模拟流式识别器仅支持 SenseVoice Small INT8。");

        var modelPath = Path.Combine(modelFolder, "model.int8.onnx");
        var tokensPath = Path.Combine(modelFolder, "tokens.txt");
        if (!File.Exists(modelPath)) throw new FileNotFoundException("SenseVoice 模型文件缺失。", modelPath);
        if (!File.Exists(tokensPath)) throw new FileNotFoundException("SenseVoice tokens.txt 缺失。", tokensPath);
        if (!File.Exists(vadModelPath)) throw new FileNotFoundException("Silero VAD 模型缺失。", vadModelPath);

        SherpaInterop.ConfigureRuntime(runtimeFolder);

        var recognizerConfig = new OfflineRecognizerConfig();
        recognizerConfig.FeatConfig.SampleRate = SampleRate;
        recognizerConfig.FeatConfig.FeatureDim = 80;
        var modelConfig = new OfflineModelConfig
        {
            Tokens = tokensPath,
            NumThreads = Math.Clamp(Environment.ProcessorCount / 2, 1, 4),
            Provider = "cpu",
            Debug = 0
        };
        var senseVoice = modelConfig.SenseVoice;
        senseVoice.Model = modelPath;
        senseVoice.Language = "auto";
        senseVoice.UseInverseTextNormalization = 0;
        modelConfig.SenseVoice = senseVoice;
        recognizerConfig.ModelConfig = modelConfig;
        recognizerConfig.DecodingMethod = "greedy_search";
        _recognizer = new OfflineRecognizer(recognizerConfig);

        var vadConfig = new VadModelConfig
        {
            SampleRate = SampleRate,
            NumThreads = 1,
            Provider = "cpu",
            Debug = 0
        };
        var silero = vadConfig.SileroVad;
        silero.Model = vadModelPath;
        silero.Threshold = 0.5f;
        silero.MinSilenceDuration = 0.10f;
        silero.MinSpeechDuration = 0.25f;
        silero.WindowSize = VadWindowSize;
        silero.MaxSpeechDuration = 8.0f;
        vadConfig.SileroVad = silero;
        _vad = new VoiceActivityDetector(vadConfig, 20.0f);

        ResetStreamingState();
        StatusChanged?.Invoke("SenseVoice 已就绪，等待语音");
    }

    public void AcceptSamples(float[] samples)
    {
        var recognizer = _recognizer;
        var vad = _vad;
        if (recognizer == null || vad == null || samples.Length == 0) return;

        _buffer.AddRange(samples);

        while (_vadOffset + VadWindowSize <= _buffer.Count)
        {
            var window = _buffer.GetRange(_vadOffset, VadWindowSize).ToArray();
            vad.AcceptWaveform(window);
            _vadOffset += VadWindowSize;

            var now = DateTime.UtcNow;
            var vadDetected = vad.IsSpeechDetected();
            var rms = ComputeRms(window);

            if (!_speechStarted)
            {
                if (vadDetected)
                {
                    BeginSpeech(now, false);
                }
                else
                {
                    if (rms >= EnergyStartRms) _energyHotWindows++;
                    else _energyHotWindows = Math.Max(0, _energyHotWindows - 1);

                    if (_energyHotWindows >= EnergyStartWindows)
                        BeginSpeech(now, true);
                }
            }

            if (_speechStarted && (vadDetected || rms >= EnergyKeepRms))
                _lastVoiceAt = now;
        }

        if (!_speechStarted && _buffer.Count > IdleKeepWindows * VadWindowSize)
        {
            var trim = _buffer.Count - IdleKeepWindows * VadWindowSize;
            _buffer.RemoveRange(0, trim);
            _vadOffset = Math.Max(0, _vadOffset - trim);
        }

        DrainCompletedSegments();
        if (!_speechStarted) return;

        var utcNow = DateTime.UtcNow;
        if (utcNow >= _nextInterimAt && _buffer.Count >= 8000)
        {
            var text = Decode(_buffer.ToArray());
            PublishDecodeResult(text, false);
            _nextInterimAt = utcNow.AddMilliseconds(InterimIntervalMs);
        }

        var energyTimedOut = _lastVoiceAt != DateTime.MinValue &&
            (utcNow - _lastVoiceAt).TotalMilliseconds >= EnergySilenceMs;
        var reachedMaxDuration = _speechStartedAt != DateTime.MinValue &&
            (utcNow - _speechStartedAt).TotalMilliseconds >= MaxUtteranceMs;

        if (energyTimedOut || reachedMaxDuration)
            FinalizeFallbackUtterance(energyTimedOut ? "停顿" : "最长分段");
    }

    void BeginSpeech(DateTime now, bool byEnergyFallback)
    {
        _speechStarted = true;
        _speechStartedAt = now;
        _lastVoiceAt = now;
        _nextInterimAt = now.AddMilliseconds(InterimIntervalMs);
        _startedByEnergyFallback = byEnergyFallback;
        _emptyDecodeCount = 0;
        StatusChanged?.Invoke(byEnergyFallback
            ? "SenseVoice 音量检测到语音，正在识别（VAD fallback）"
            : "SenseVoice VAD 检测到语音，正在识别");
    }

    void DrainCompletedSegments()
    {
        var vad = _vad;
        if (_recognizer == null || vad == null) return;

        while (!vad.IsEmpty())
        {
            var segment = vad.Front();
            vad.Pop();

            string text = string.Empty;
            if (segment.Samples.Length >= 1600)
                text = Decode(segment.Samples);

            if (string.IsNullOrWhiteSpace(text) && _buffer.Count >= 3200)
                text = Decode(_buffer.ToArray());

            PublishDecodeResult(text, true);
            ResetStreamingState();
            StatusChanged?.Invoke("SenseVoice 已完成一句，等待语音");
        }
    }

    void FinalizeFallbackUtterance(string reason)
    {
        if (!_speechStarted) return;
        var text = _buffer.Count >= 3200 ? Decode(_buffer.ToArray()) : string.Empty;
        PublishDecodeResult(text, true);
        var wasFallback = _startedByEnergyFallback;
        ResetStreamingState();
        StatusChanged?.Invoke(wasFallback
            ? $"SenseVoice fallback 已按{reason}分段，等待下一句"
            : $"SenseVoice 已按{reason}分段，等待下一句");
    }

    void PublishDecodeResult(string text, bool final)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            _emptyDecodeCount++;
            if (_emptyDecodeCount == 1 || _emptyDecodeCount % 3 == 0)
                StatusChanged?.Invoke($"SenseVoice 已执行解码但返回空文本（第 {_emptyDecodeCount} 次），继续监听");
            return;
        }

        _emptyDecodeCount = 0;
        if (final)
        {
            FinalResult?.Invoke(text);
            _lastPartial = "";
        }
        else if (!string.Equals(text, _lastPartial, StringComparison.Ordinal))
        {
            _lastPartial = text;
            PartialResult?.Invoke(text);
        }
    }

    string Decode(float[] samples)
    {
        var recognizer = _recognizer;
        if (recognizer == null || samples.Length == 0) return string.Empty;

        using var stream = recognizer.CreateStream();
        if (stream.Handle == IntPtr.Zero)
        {
            StatusChanged?.Invoke("SenseVoice 未能创建离线识别流，继续监听");
            return string.Empty;
        }
        stream.AcceptWaveform(SampleRate, samples);
        recognizer.Decode(stream);
        return CleanupSenseVoiceText(SherpaOfflineResultReader.GetText(stream));
    }

    static float ComputeRms(float[] samples)
    {
        if (samples.Length == 0) return 0;
        double sum = 0;
        foreach (var x in samples) sum += x * x;
        return (float)Math.Sqrt(sum / samples.Length);
    }

    static string CleanupSenseVoiceText(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        text = Regex.Replace(text, @"<\|[^|]+\|>", string.Empty);
        return text.Trim();
    }

    void ResetStreamingState()
    {
        _buffer.Clear();
        _vadOffset = 0;
        _speechStarted = false;
        _speechStartedAt = DateTime.MinValue;
        _lastVoiceAt = DateTime.MinValue;
        _lastPartial = "";
        _nextInterimAt = DateTime.MinValue;
        _energyHotWindows = 0;
        _emptyDecodeCount = 0;
        _startedByEnergyFallback = false;
    }

    public void Stop()
    {
        if (_vad != null)
        {
            try
            {
                _vad.Flush();
                DrainCompletedSegments();
            }
            catch { }
        }

        _vad?.Dispose();
        _vad = null;
        _recognizer?.Dispose();
        _recognizer = null;
        ResetStreamingState();
    }

    public void Dispose() => Stop();
}
