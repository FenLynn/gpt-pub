using LocalSub.Models;

namespace LocalSub.Services;

public sealed class StreamingParaformerService : IDisposable
{
    SherpaInterop.OnlineRecognizerHandle? _recognizer;
    string _lastPartial = "";

    public event Action<string>? PartialResult;
    public event Action<string>? FinalResult;

    public void Start(ModelDescriptor model, string modelFolder, string runtimeFolder)
    {
        Stop();
        if (!model.Id.StartsWith("streaming-paraformer-", StringComparison.OrdinalIgnoreCase))
            throw new NotSupportedException("当前实时闭环仅支持 Streaming Paraformer。SenseVoice 将作为下一阶段模拟流式模型接入。 ");

        var encoder = Path.Combine(modelFolder, "encoder.int8.onnx");
        var decoder = Path.Combine(modelFolder, "decoder.int8.onnx");
        var tokens = Path.Combine(modelFolder, "tokens.txt");
        foreach (var file in new[] { encoder, decoder, tokens })
            if (!File.Exists(file)) throw new FileNotFoundException("实时模型文件缺失。", file);

        SherpaInterop.ConfigureRuntime(runtimeFolder);
        var config = SherpaInterop.OnlineRecognizerConfig.Default;
        var modelConfig = SherpaInterop.OnlineModelConfig.Empty;
        modelConfig.Paraformer = new SherpaInterop.OnlineParaformerModelConfig { Encoder = encoder, Decoder = decoder };
        modelConfig.Tokens = tokens;
        modelConfig.NumThreads = Math.Clamp(Environment.ProcessorCount / 2, 1, 4);
        modelConfig.Provider = "cpu";
        config.ModelConfig = modelConfig;
        config.EnableEndpoint = 1;
        config.Rule1MinTrailingSilence = 2.0f;
        config.Rule2MinTrailingSilence = 0.8f;
        config.Rule3MinUtteranceLength = 20.0f;
        _recognizer = new SherpaInterop.OnlineRecognizerHandle(config);
        _lastPartial = "";
    }

    public void AcceptSamples(float[] samples)
    {
        var recognizer = _recognizer;
        if (recognizer == null || samples.Length == 0) return;

        recognizer.AcceptWaveform(samples);
        var text = recognizer.GetText().Trim();
        if (!string.IsNullOrWhiteSpace(text) && !string.Equals(text, _lastPartial, StringComparison.Ordinal))
        {
            _lastPartial = text;
            PartialResult?.Invoke(text);
        }

        if (recognizer.IsEndpoint)
        {
            if (!string.IsNullOrWhiteSpace(text)) FinalResult?.Invoke(text);
            recognizer.Reset();
            _lastPartial = "";
        }
    }

    public void Stop()
    {
        _recognizer?.Dispose();
        _recognizer = null;
        _lastPartial = "";
    }

    public void Dispose() => Stop();
}
