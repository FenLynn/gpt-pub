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

        var isParaformer = model.Id.StartsWith("streaming-paraformer-", StringComparison.OrdinalIgnoreCase);
        var isZipformer = string.Equals(model.Id, "streaming-zipformer-zh-large-int8", StringComparison.OrdinalIgnoreCase);
        if (!isParaformer && !isZipformer)
            throw new NotSupportedException("当前真流式识别器支持 Streaming Paraformer 与 Streaming Zipformer Large INT8。");

        SherpaInterop.ConfigureRuntime(runtimeFolder);
        var config = SherpaInterop.OnlineRecognizerConfig.Default;
        var modelConfig = SherpaInterop.OnlineModelConfig.Empty;
        modelConfig.NumThreads = Math.Clamp(Environment.ProcessorCount / 2, 1, 4);
        modelConfig.Provider = "cpu";

        if (isParaformer)
        {
            var encoder = Path.Combine(modelFolder, "encoder.int8.onnx");
            var decoder = Path.Combine(modelFolder, "decoder.int8.onnx");
            var tokens = Path.Combine(modelFolder, "tokens.txt");
            foreach (var file in new[] { encoder, decoder, tokens })
                if (!File.Exists(file)) throw new FileNotFoundException("实时 Paraformer 模型文件缺失。", file);

            modelConfig.Paraformer = new SherpaInterop.OnlineParaformerModelConfig
            {
                Encoder = encoder,
                Decoder = decoder
            };
            modelConfig.Tokens = tokens;
        }
        else
        {
            var encoder = Path.Combine(modelFolder, "encoder.int8.onnx");
            var decoder = Path.Combine(modelFolder, "decoder.onnx");
            var joiner = Path.Combine(modelFolder, "joiner.int8.onnx");
            var tokens = Path.Combine(modelFolder, "tokens.txt");
            foreach (var file in new[] { encoder, decoder, joiner, tokens })
                if (!File.Exists(file)) throw new FileNotFoundException("实时 Zipformer 模型文件缺失。", file);

            modelConfig.Transducer = new SherpaInterop.OnlineTransducerModelConfig
            {
                Encoder = encoder,
                Decoder = decoder,
                Joiner = joiner
            };
            modelConfig.Tokens = tokens;
            // The 2025 multi-zh model carries enough metadata for sherpa-onnx auto detection.
            modelConfig.ModelType = "";
        }

        config.ModelConfig = modelConfig;
        config.EnableEndpoint = 1;
        config.Rule1MinTrailingSilence = 2.0f;
        config.Rule2MinTrailingSilence = isZipformer ? 0.7f : 0.8f;
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
