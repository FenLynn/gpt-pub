using System.Text.RegularExpressions;
using LocalSub.Models;
using SherpaOnnx;

namespace LocalSub.Services;

public sealed class SenseVoiceSimulatedStreamingService : IDisposable
{
    const int SampleRate = 16000;
    const int VadWindowSize = 512;
    const int IdleKeepWindows = 10;
    const int InterimIntervalMs = 450;

    OfflineRecognizer? _recognizer;
    VoiceActivityDetector? _vad;
    readonly List<float> _buffer = [];
    int _vadOffset;
    bool _speechStarted;
    DateTime _nextInterimAt;
    string _lastPartial = "";

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
        // Match sherpa-onnx's current simulated-streaming SenseVoice example.
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

        // sherpa-onnx's simulated-streaming example feeds Silero VAD in fixed 512-sample windows.
        while (_vadOffset + VadWindowSize <= _buffer.Count)
        {
            var window = _buffer.GetRange(_vadOffset, VadWindowSize).ToArray();
            vad.AcceptWaveform(window);
            _vadOffset += VadWindowSize;

            if (!_speechStarted && vad.IsSpeechDetected())
            {
                _speechStarted = true;
                _nextInterimAt = DateTime.UtcNow.AddMilliseconds(InterimIntervalMs);
                StatusChanged?.Invoke("SenseVoice 检测到语音，正在识别");
            }
        }

        // Keep only a short pre-roll while waiting for speech, like the official example.
        if (!_speechStarted && _buffer.Count > IdleKeepWindows * VadWindowSize)
        {
            var trim = _buffer.Count - IdleKeepWindows * VadWindowSize;
            _buffer.RemoveRange(0, trim);
            _vadOffset = Math.Max(0, _vadOffset - trim);
        }

        // Provide visible simulated-streaming feedback while the utterance is still in progress.
        if (_speechStarted && DateTime.UtcNow >= _nextInterimAt && _buffer.Count >= 3200)
        {
            var text = Decode(_buffer.ToArray());
            if (!string.IsNullOrWhiteSpace(text) && !string.Equals(text, _lastPartial, StringComparison.Ordinal))
            {
                _lastPartial = text;
                PartialResult?.Invoke(text);
            }
            _nextInterimAt = DateTime.UtcNow.AddMilliseconds(InterimIntervalMs);
        }

        DrainCompletedSegments();
    }

    void DrainCompletedSegments()
    {
        var vad = _vad;
        if (_recognizer == null || vad == null) return;

        while (!vad.IsEmpty())
        {
            var segment = vad.Front();
            vad.Pop();

            if (segment.Samples.Length >= 1600)
            {
                var text = Decode(segment.Samples);
                if (!string.IsNullOrWhiteSpace(text)) FinalResult?.Invoke(text);
            }

            ResetStreamingState();
            StatusChanged?.Invoke("SenseVoice 已完成一句，等待语音");
        }
    }

    string Decode(float[] samples)
    {
        var recognizer = _recognizer;
        if (recognizer == null || samples.Length == 0) return string.Empty;

        using var stream = recognizer.CreateStream();
        stream.AcceptWaveform(SampleRate, samples);
        recognizer.Decode(stream);
        return CleanupSenseVoiceText(stream.Result.Text);
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
        _lastPartial = "";
        _nextInterimAt = DateTime.MinValue;
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
