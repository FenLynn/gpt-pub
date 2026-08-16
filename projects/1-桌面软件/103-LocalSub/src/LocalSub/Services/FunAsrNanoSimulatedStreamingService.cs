using LocalSub.Models;
using SherpaOnnx;

namespace LocalSub.Services;

/// <summary>
/// Simulated streaming for Fun-ASR-Nano. Audio is segmented by Silero VAD and
/// each completed utterance is decoded by the offline LLM-backed recognizer.
/// It intentionally publishes final sentences only because repeated interim LLM
/// decoding is expensive and can easily fall behind real-time audio.
/// </summary>
public sealed class FunAsrNanoSimulatedStreamingService : IDisposable
{
    const int SampleRate = 16000;
    const int VadWindowSize = 512;

    OfflineRecognizer? _recognizer;
    VoiceActivityDetector? _vad;
    readonly List<float> _pending = [];
    bool _speechDetected;

    public event Action<string>? FinalResult;
    public event Action<string>? StatusChanged;

    public void Start(ModelDescriptor model, string modelFolder, string vadModelPath, string runtimeFolder)
    {
        Stop();
        if (!string.Equals(model.Id, "funasr-nano-int8", StringComparison.OrdinalIgnoreCase))
            throw new NotSupportedException("该模拟流式识别器仅支持 Fun-ASR-Nano INT8。");

        var encoderAdaptor = Path.Combine(modelFolder, "encoder_adaptor.int8.onnx");
        var llm = Path.Combine(modelFolder, "llm.int8.onnx");
        var embedding = Path.Combine(modelFolder, "embedding.int8.onnx");
        var tokenizer = Path.Combine(modelFolder, "Qwen3-0.6B");

        if (!File.Exists(encoderAdaptor)) throw new FileNotFoundException("Fun-ASR-Nano encoder adaptor 缺失。", encoderAdaptor);
        if (!File.Exists(llm)) throw new FileNotFoundException("Fun-ASR-Nano LLM 模型缺失。", llm);
        if (!File.Exists(embedding)) throw new FileNotFoundException("Fun-ASR-Nano embedding 模型缺失。", embedding);
        if (!Directory.Exists(tokenizer)) throw new DirectoryNotFoundException("Fun-ASR-Nano Qwen3-0.6B tokenizer 目录缺失：" + tokenizer);
        if (!File.Exists(vadModelPath)) throw new FileNotFoundException("Silero VAD 模型缺失。", vadModelPath);

        SherpaInterop.ConfigureRuntime(runtimeFolder);

        var config = new OfflineRecognizerConfig();
        config.FeatConfig.SampleRate = SampleRate;
        config.FeatConfig.FeatureDim = 80;
        config.ModelConfig.FunAsrNano.EncoderAdaptor = encoderAdaptor;
        config.ModelConfig.FunAsrNano.LLM = llm;
        config.ModelConfig.FunAsrNano.Embedding = embedding;
        config.ModelConfig.FunAsrNano.Tokenizer = tokenizer;
        config.ModelConfig.Tokens = "";
        config.ModelConfig.NumThreads = Math.Clamp(Environment.ProcessorCount / 4, 1, 3);
        config.ModelConfig.Provider = "cpu";
        config.ModelConfig.Debug = 0;
        config.DecodingMethod = "greedy_search";
        _recognizer = new OfflineRecognizer(config);

        var vadConfig = new VadModelConfig
        {
            SampleRate = SampleRate,
            NumThreads = 1,
            Provider = "cpu",
            Debug = 0
        };
        vadConfig.SileroVad.Model = vadModelPath;
        vadConfig.SileroVad.Threshold = 0.35f;
        vadConfig.SileroVad.MinSilenceDuration = 0.45f;
        vadConfig.SileroVad.MinSpeechDuration = 0.25f;
        vadConfig.SileroVad.MaxSpeechDuration = 5.5f;
        vadConfig.SileroVad.WindowSize = VadWindowSize;
        _vad = new VoiceActivityDetector(vadConfig, 30.0f);

        _pending.Clear();
        _speechDetected = false;
        StatusChanged?.Invoke("Fun-ASR-Nano 已就绪，等待语音；停顿后输出整句");
    }

    public void AcceptSamples(float[] samples)
    {
        var vad = _vad;
        if (_recognizer == null || vad == null || samples.Length == 0) return;

        _pending.AddRange(samples);
        while (_pending.Count >= VadWindowSize)
        {
            var window = _pending.GetRange(0, VadWindowSize).ToArray();
            _pending.RemoveRange(0, VadWindowSize);
            vad.AcceptWaveform(window);

            if (vad.IsSpeechDetected() && !_speechDetected)
            {
                _speechDetected = true;
                StatusChanged?.Invoke("Fun-ASR-Nano 检测到语音，等待句尾后高质量解码");
            }

            DrainCompletedSegments();
        }
    }

    void DrainCompletedSegments()
    {
        var recognizer = _recognizer;
        var vad = _vad;
        if (recognizer == null || vad == null) return;

        while (!vad.IsEmpty())
        {
            var segment = vad.Front();
            vad.Pop();
            _speechDetected = false;

            if (segment.Samples.Length < 1600) continue;

            StatusChanged?.Invoke($"Fun-ASR-Nano 正在解码 {segment.Samples.Length / (float)SampleRate:0.0} 秒语音…");
            var text = Decode(segment.Samples);
            if (!string.IsNullOrWhiteSpace(text))
                FinalResult?.Invoke(text);
            else
                StatusChanged?.Invoke("Fun-ASR-Nano 本段解码返回空文本，继续监听");

            if (!string.IsNullOrWhiteSpace(text))
                StatusChanged?.Invoke("Fun-ASR-Nano 已完成一句，等待下一段语音");
        }
    }

    string Decode(float[] samples)
    {
        var recognizer = _recognizer;
        if (recognizer == null || samples.Length == 0) return string.Empty;

        using var stream = recognizer.CreateStream();
        if (stream.Handle == IntPtr.Zero)
        {
            StatusChanged?.Invoke("Fun-ASR-Nano 未能创建离线识别流，继续监听");
            return string.Empty;
        }
        stream.AcceptWaveform(SampleRate, samples);
        recognizer.Decode(stream);
        return SherpaOfflineResultReader.GetText(stream);
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
        _pending.Clear();
        _speechDetected = false;
    }

    public void Dispose() => Stop();
}
