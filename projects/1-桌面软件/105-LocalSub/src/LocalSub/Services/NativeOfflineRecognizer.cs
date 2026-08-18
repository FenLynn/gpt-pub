using System.Runtime.InteropServices;
using System.Text.Json;
using LocalSub.Models;

namespace LocalSub.Services;

/// <summary>
/// Thin UTF-8 wrapper over sherpa-onnx's offline C API.
/// We intentionally zero-initialize the native configuration and populate only
/// the selected model family, matching sherpa-onnx's C examples. This avoids
/// the managed OfflineRecognizer wrapper's null-handle/result behavior and its
/// ANSI LPStr model paths on Windows.
/// </summary>
internal sealed class NativeOfflineRecognizer : IDisposable
{
    const string DllName = "sherpa-onnx-c-api";
    IntPtr _recognizer;

    public NativeOfflineRecognizer(ModelDescriptor model, string modelFolder, int threads, string runtimeFolder)
    {
        SherpaInterop.ConfigureRuntime(runtimeFolder);
        var cfg = BuildConfig(model, modelFolder, threads);
        _recognizer = SherpaOnnxCreateOfflineRecognizer(ref cfg);
        if (_recognizer == IntPtr.Zero)
            throw new InvalidOperationException(BuildCreateError(model, modelFolder));
    }

    NativeOfflineRecognizer(NativeOfflineRecognizerConfig cfg, string diagnosticName)
    {
        _recognizer = SherpaOnnxCreateOfflineRecognizer(ref cfg);
        if (_recognizer == IntPtr.Zero)
            throw new InvalidOperationException($"sherpa-onnx 无法创建离线识别器：{diagnosticName}。请检查模型文件与 native runtime 版本。");
    }

    public string Decode(float[] samples, int sampleRate = 16000)
    {
        if (_recognizer == IntPtr.Zero) throw new ObjectDisposedException(nameof(NativeOfflineRecognizer));
        if (samples.Length == 0) return string.Empty;

        var stream = SherpaOnnxCreateOfflineStream(_recognizer);
        if (stream == IntPtr.Zero)
            throw new InvalidOperationException("sherpa-onnx 未能创建离线识别流；离线 recognizer 句柄不可用。");

        try
        {
            SherpaOnnxAcceptWaveformOffline(stream, sampleRate, samples, samples.Length);
            SherpaOnnxDecodeOfflineStream(_recognizer, stream);
            return ReadResultText(stream);
        }
        finally
        {
            SherpaOnnxDestroyOfflineStream(stream);
        }
    }

    internal static NativeOfflineRecognizer CreateTdnnSmoke(string modelPath, string tokensPath, string runtimeFolder)
    {
        SherpaInterop.ConfigureRuntime(runtimeFolder);
        var cfg = CreateBaseConfig(1, 8000, 23);
        cfg.ModelConfig.Tokens = tokensPath;
        cfg.ModelConfig.Tdnn.Model = modelPath;
        return new NativeOfflineRecognizer(cfg, "TDNN smoke model");
    }

    static NativeOfflineRecognizerConfig BuildConfig(ModelDescriptor model, string folder, int threads)
    {
        var cfg = CreateBaseConfig(threads, 16000, 80);

        if (string.Equals(model.Id, "sensevoice-small-int8", StringComparison.OrdinalIgnoreCase))
        {
            var modelPath = RequireFile(folder, "model.int8.onnx", model.Name);
            var tokens = RequireFile(folder, "tokens.txt", model.Name);
            cfg.ModelConfig.Tokens = tokens;
            cfg.ModelConfig.SenseVoice = new NativeSenseVoiceConfig
            {
                Model = modelPath,
                Language = "auto",
                UseItn = 1
            };
        }
        else if (string.Equals(model.Id, "offline-zipformer-ctc-zh-int8", StringComparison.OrdinalIgnoreCase))
        {
            cfg.ModelConfig.Tokens = RequireFile(folder, "tokens.txt", model.Name);
            cfg.ModelConfig.ZipformerCtc.Model = RequireFile(folder, "model.int8.onnx", model.Name);
        }
        else if (string.Equals(model.Id, "firered-asr2-ctc-zh-en-int8", StringComparison.OrdinalIgnoreCase))
        {
            cfg.ModelConfig.Tokens = RequireFile(folder, "tokens.txt", model.Name);
            cfg.ModelConfig.FireRedAsrCtc.Model = RequireFile(folder, "model.int8.onnx", model.Name);
        }
        else if (string.Equals(model.Id, "funasr-nano-int8", StringComparison.OrdinalIgnoreCase))
        {
            cfg.ModelConfig.FunAsrNano = new NativeFunAsrNanoConfig
            {
                EncoderAdaptor = RequireFile(folder, "encoder_adaptor.int8.onnx", model.Name),
                Llm = RequireFile(folder, "llm.int8.onnx", model.Name),
                Embedding = RequireFile(folder, "embedding.int8.onnx", model.Name),
                Tokenizer = RequireDirectory(folder, "Qwen3-0.6B", model.Name)
            };
        }
        else
        {
            throw new NotSupportedException($"当前 native 离线识别器尚未配置模型“{model.Name}”。");
        }

        return cfg;
    }

    static NativeOfflineRecognizerConfig CreateBaseConfig(int threads, int sampleRate, int featureDim)
    {
        // Keep all unused pointers null, matching memset(&config, 0, sizeof(config))
        // in sherpa-onnx's C examples.
        return new NativeOfflineRecognizerConfig
        {
            FeatConfig = new NativeFeatureConfig { SampleRate = sampleRate, FeatureDim = featureDim },
            ModelConfig = new NativeOfflineModelConfig
            {
                NumThreads = Math.Clamp(threads, 1, 12),
                Provider = "cpu"
            },
            DecodingMethod = "greedy_search",
            MaxActivePaths = 4
        };
    }

    static string RequireFile(string folder, string relative, string modelName)
    {
        var path = Path.GetFullPath(Path.Combine(folder, relative));
        if (!File.Exists(path)) throw new FileNotFoundException($"{modelName} 缺少 {relative}。", path);
        var length = new FileInfo(path).Length;
        if (length <= 0) throw new InvalidDataException($"{modelName} 的 {relative} 是空文件。");
        return path;
    }

    static string RequireDirectory(string folder, string relative, string modelName)
    {
        var path = Path.GetFullPath(Path.Combine(folder, relative));
        if (!Directory.Exists(path)) throw new DirectoryNotFoundException($"{modelName} 缺少 {relative} 目录：{path}");
        return path;
    }

    static string BuildCreateError(ModelDescriptor model, string folder)
    {
        var details = new List<string>();
        foreach (var required in model.RequiredFiles)
        {
            var p = Path.Combine(folder, required.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(p)) details.Add($"{required}={new FileInfo(p).Length / 1024d / 1024d:0.0}MB");
            else if (Directory.Exists(p)) details.Add($"{required}=目录存在");
            else details.Add($"{required}=缺失");
        }
        return $"sherpa-onnx 无法加载离线模型“{model.Name}”。{string.Join("，", details)}。如果文件体积异常，请在模型页删除后重新下载/修复。";
    }

    static string ReadResultText(IntPtr stream)
    {
        var jsonPtr = SherpaOnnxGetOfflineStreamResultAsJson(stream);
        if (jsonPtr == IntPtr.Zero) return string.Empty;
        try
        {
            var json = Marshal.PtrToStringUTF8(jsonPtr);
            if (string.IsNullOrWhiteSpace(json)) return string.Empty;
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String
                ? text.GetString()?.Trim() ?? string.Empty
                : string.Empty;
        }
        finally
        {
            SherpaOnnxDestroyOfflineStreamResultJson(jsonPtr);
        }
    }

    public void Dispose()
    {
        if (_recognizer != IntPtr.Zero) SherpaOnnxDestroyOfflineRecognizer(_recognizer);
        _recognizer = IntPtr.Zero;
        GC.SuppressFinalize(this);
    }

    ~NativeOfflineRecognizer() => Dispose();

    [StructLayout(LayoutKind.Sequential)]
    struct NativeFeatureConfig { public int SampleRate; public int FeatureDim; }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeTransducerConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Encoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Decoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Joiner;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeSingleModelConfig { [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Model; }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeWhisperConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Encoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Decoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Language;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Task;
        public int TailPaddings;
        public int EnableTokenTimestamps;
        public int EnableSegmentTimestamps;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeCanaryConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Encoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Decoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? SrcLang;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? TgtLang;
        public int UsePnc;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeCohereConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Encoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Decoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Language;
        public int UsePunct;
        public int UseItn;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeTwoModelConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? First;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Second;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeMoonshineConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Preprocessor;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Encoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? UncachedDecoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? CachedDecoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? MergedDecoder;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeSenseVoiceConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Model;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Language;
        public int UseItn;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeFunAsrNanoConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? EncoderAdaptor;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Llm;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Embedding;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Tokenizer;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? SystemPrompt;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? UserPrompt;
        public int MaxNewTokens;
        public float Temperature;
        public float TopP;
        public int Seed;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Language;
        public int Itn;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Hotwords;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeQwen3Config
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? ConvFrontend;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Encoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Decoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Tokenizer;
        public int MaxTotalLen;
        public int MaxNewTokens;
        public float Temperature;
        public float TopP;
        public int Seed;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Hotwords;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeOfflineModelConfig
    {
        public NativeTransducerConfig Transducer;
        public NativeSingleModelConfig Paraformer;
        public NativeSingleModelConfig NemoCtc;
        public NativeWhisperConfig Whisper;
        public NativeSingleModelConfig Tdnn;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Tokens;
        public int NumThreads;
        public int Debug;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Provider;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? ModelType;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? ModelingUnit;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? BpeVocab;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? TeleSpeechCtc;
        public NativeSenseVoiceConfig SenseVoice;
        public NativeMoonshineConfig Moonshine;
        public NativeTwoModelConfig FireRedAsr;
        public NativeSingleModelConfig Dolphin;
        public NativeSingleModelConfig ZipformerCtc;
        public NativeCanaryConfig Canary;
        public NativeSingleModelConfig WenetCtc;
        public NativeSingleModelConfig Omnilingual;
        public NativeSingleModelConfig MedAsr;
        public NativeFunAsrNanoConfig FunAsrNano;
        public NativeSingleModelConfig FireRedAsrCtc;
        public NativeQwen3Config Qwen3Asr;
        public NativeCohereConfig CohereTranscribe;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeLmConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Model;
        public float Scale;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeHomophoneConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? DictDir;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? Lexicon;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? RuleFsts;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct NativeOfflineRecognizerConfig
    {
        public NativeFeatureConfig FeatConfig;
        public NativeOfflineModelConfig ModelConfig;
        public NativeLmConfig LmConfig;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? DecodingMethod;
        public int MaxActivePaths;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? HotwordsFile;
        public float HotwordsScore;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? RuleFsts;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string? RuleFars;
        public float BlankPenalty;
        public NativeHomophoneConfig Hr;
    }

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr SherpaOnnxCreateOfflineRecognizer(ref NativeOfflineRecognizerConfig config);
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    static extern void SherpaOnnxDestroyOfflineRecognizer(IntPtr recognizer);
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr SherpaOnnxCreateOfflineStream(IntPtr recognizer);
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    static extern void SherpaOnnxDestroyOfflineStream(IntPtr stream);
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    static extern void SherpaOnnxAcceptWaveformOffline(IntPtr stream, int sampleRate, float[] samples, int n);
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    static extern void SherpaOnnxDecodeOfflineStream(IntPtr recognizer, IntPtr stream);
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr SherpaOnnxGetOfflineStreamResultAsJson(IntPtr stream);
    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    static extern void SherpaOnnxDestroyOfflineStreamResultJson(IntPtr json);
}
