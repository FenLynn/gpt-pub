using System.Text.RegularExpressions;
using LocalSub.Models;
using SherpaOnnx;

namespace LocalSub.Services;

public sealed class SenseVoiceSimulatedStreamingService : IDisposable
{
    OfflineRecognizer? _recognizer;
    VoiceActivityDetector? _vad;

    public event Action<string>? FinalResult;

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

        // The official managed wrapper still calls sherpa-onnx-c-api via DllImport.
        // Point Windows DLL search at our portable ASR\_runtime folder first.
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
        senseVoice.UseInverseTextNormalization = 1;
        modelConfig.SenseVoice = senseVoice;
        recognizerConfig.ModelConfig = modelConfig;
        recognizerConfig.DecodingMethod = "greedy_search";
        _recognizer = new OfflineRecognizer(recognizerConfig);

        var vadConfig = new VadModelConfig
        {
            SampleRate = 16000,
            NumThreads = 1,
            Provider = "cpu",
            Debug = 0
        };
        var silero = vadConfig.SileroVad;
        silero.Model = vadModelPath;
        silero.Threshold = 0.5f;
        silero.MinSilenceDuration = 0.25f;
        silero.MinSpeechDuration = 0.18f;
        silero.WindowSize = 512;
        silero.MaxSpeechDuration = 8.0f;
        vadConfig.SileroVad = silero;
        _vad = new VoiceActivityDetector(vadConfig, 20.0f);
    }

    public void AcceptSamples(float[] samples)
    {
        if (_recognizer == null || _vad == null || samples.Length == 0) return;
        _vad.AcceptWaveform(samples);
        DrainSegments();
    }

    void DrainSegments()
    {
        var recognizer = _recognizer;
        var vad = _vad;
        if (recognizer == null || vad == null) return;

        while (!vad.IsEmpty())
        {
            var segment = vad.Front();
            vad.Pop();
            if (segment.Samples.Length < 1600) continue;

            using var stream = recognizer.CreateStream();
            stream.AcceptWaveform(16000, segment.Samples);
            recognizer.Decode(stream);
            var text = CleanupSenseVoiceText(stream.Result.Text);
            if (!string.IsNullOrWhiteSpace(text)) FinalResult?.Invoke(text);
        }
    }

    static string CleanupSenseVoiceText(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        text = Regex.Replace(text, @"<\|[^|]+\|>", string.Empty);
        return text.Trim();
    }

    public void Stop()
    {
        if (_vad != null)
        {
            try
            {
                _vad.Flush();
                DrainSegments();
            }
            catch { }
        }
        _vad?.Dispose();
        _vad = null;
        _recognizer?.Dispose();
        _recognizer = null;
    }

    public void Dispose() => Stop();
}
