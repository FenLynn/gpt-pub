using System.Reflection;
using System.Runtime.InteropServices;

namespace LocalSub.Services;

internal static class SherpaInterop
{
    const string DllName = "sherpa-onnx-c-api";
    static string? _runtimeDir;
    static bool _resolverInstalled;
    static readonly object Sync = new();

    internal static void ConfigureRuntime(string runtimeDir)
    {
        runtimeDir = Path.GetFullPath(runtimeDir);
        if (!File.Exists(Path.Combine(runtimeDir, "sherpa-onnx-c-api.dll")))
            throw new FileNotFoundException("ASR 运行库不完整，缺少 sherpa-onnx-c-api.dll。", Path.Combine(runtimeDir, "sherpa-onnx-c-api.dll"));

        lock (Sync)
        {
            _runtimeDir = runtimeDir;
            SetDllDirectory(runtimeDir);
            if (!_resolverInstalled)
            {
                NativeLibrary.SetDllImportResolver(typeof(SherpaInterop).Assembly, ResolveDll);
                _resolverInstalled = true;
            }
        }
    }

    static IntPtr ResolveDll(string libraryName, Assembly assembly, DllImportSearchPath? searchPath)
    {
        if (!string.Equals(libraryName, DllName, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(libraryName, DllName + ".dll", StringComparison.OrdinalIgnoreCase))
            return IntPtr.Zero;

        var dir = _runtimeDir ?? throw new DllNotFoundException("ASR 运行库目录尚未配置。");
        return NativeLibrary.Load(Path.Combine(dir, "sherpa-onnx-c-api.dll"));
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetDllDirectory(string lpPathName);

    [StructLayout(LayoutKind.Sequential)]
    internal struct FeatureConfig
    {
        public int SampleRate;
        public int FeatureDim;
        public static FeatureConfig Default => new() { SampleRate = 16000, FeatureDim = 80 };
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct OnlineTransducerModelConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string Encoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string Decoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string Joiner;
        public static OnlineTransducerModelConfig Empty => new() { Encoder = "", Decoder = "", Joiner = "" };
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct OnlineParaformerModelConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string Encoder;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string Decoder;
        public static OnlineParaformerModelConfig Empty => new() { Encoder = "", Decoder = "" };
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct OnlineZipformer2CtcModelConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string Model;
        public static OnlineZipformer2CtcModelConfig Empty => new() { Model = "" };
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct OnlineNemoCtcModelConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string Model;
        public static OnlineNemoCtcModelConfig Empty => new() { Model = "" };
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct OnlineToneCtcModelConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string Model;
        public static OnlineToneCtcModelConfig Empty => new() { Model = "" };
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct OnlineModelConfig
    {
        public OnlineTransducerModelConfig Transducer;
        public OnlineParaformerModelConfig Paraformer;
        public OnlineZipformer2CtcModelConfig Zipformer2Ctc;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string Tokens;
        public int NumThreads;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string Provider;
        public int Debug;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string ModelType;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string ModelingUnit;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string BpeVocab;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string TokensBuf;
        public int TokensBufSize;
        public OnlineNemoCtcModelConfig NemoCtc;
        public OnlineToneCtcModelConfig ToneCtc;

        public static OnlineModelConfig Empty => new()
        {
            Transducer = OnlineTransducerModelConfig.Empty,
            Paraformer = OnlineParaformerModelConfig.Empty,
            Zipformer2Ctc = OnlineZipformer2CtcModelConfig.Empty,
            Tokens = "",
            NumThreads = 1,
            Provider = "cpu",
            Debug = 0,
            ModelType = "",
            ModelingUnit = "cjkchar",
            BpeVocab = "",
            TokensBuf = "",
            TokensBufSize = 0,
            NemoCtc = OnlineNemoCtcModelConfig.Empty,
            ToneCtc = OnlineToneCtcModelConfig.Empty
        };
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct OnlineCtcFstDecoderConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string Graph;
        public int MaxActive;
        public static OnlineCtcFstDecoderConfig Default => new() { Graph = "", MaxActive = 3000 };
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct HomophoneReplacerConfig
    {
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string DictDir;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string Lexicon;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string RuleFsts;
        public static HomophoneReplacerConfig Empty => new() { DictDir = "", Lexicon = "", RuleFsts = "" };
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct OnlineRecognizerConfig
    {
        public FeatureConfig FeatConfig;
        public OnlineModelConfig ModelConfig;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string DecodingMethod;
        public int MaxActivePaths;
        public int EnableEndpoint;
        public float Rule1MinTrailingSilence;
        public float Rule2MinTrailingSilence;
        public float Rule3MinUtteranceLength;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string HotwordsFile;
        public float HotwordsScore;
        public OnlineCtcFstDecoderConfig CtcFstDecoderConfig;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string RuleFsts;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string RuleFars;
        public float BlankPenalty;
        [MarshalAs(UnmanagedType.LPUTF8Str)] public string HotwordsBuf;
        public int HotwordsBufSize;
        public HomophoneReplacerConfig Hr;

        public static OnlineRecognizerConfig Default => new()
        {
            FeatConfig = FeatureConfig.Default,
            ModelConfig = OnlineModelConfig.Empty,
            DecodingMethod = "greedy_search",
            MaxActivePaths = 4,
            EnableEndpoint = 1,
            Rule1MinTrailingSilence = 2.4f,
            Rule2MinTrailingSilence = 0.9f,
            Rule3MinUtteranceLength = 20.0f,
            HotwordsFile = "",
            HotwordsScore = 1.5f,
            CtcFstDecoderConfig = OnlineCtcFstDecoderConfig.Default,
            RuleFsts = "",
            RuleFars = "",
            BlankPenalty = 0,
            HotwordsBuf = "",
            HotwordsBufSize = 0,
            Hr = HomophoneReplacerConfig.Empty
        };
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ResultImpl
    {
        public IntPtr Text;
        public IntPtr Tokens;
        public IntPtr TokensArr;
        public IntPtr Timestamps;
        public int Count;
    }

    internal sealed class OnlineRecognizerHandle : IDisposable
    {
        IntPtr _recognizer;
        IntPtr _stream;

        public OnlineRecognizerHandle(OnlineRecognizerConfig config)
        {
            _recognizer = SherpaOnnxCreateOnlineRecognizer(ref config);
            if (_recognizer == IntPtr.Zero) throw new InvalidOperationException("无法创建 sherpa-onnx 在线识别器，请检查模型与 ASR 运行库版本。 ");
            _stream = SherpaOnnxCreateOnlineStream(_recognizer);
            if (_stream == IntPtr.Zero)
            {
                SherpaOnnxDestroyOnlineRecognizer(_recognizer);
                _recognizer = IntPtr.Zero;
                throw new InvalidOperationException("无法创建 sherpa-onnx 在线流。 ");
            }
        }

        public void AcceptWaveform(float[] samples)
        {
            if (samples.Length == 0) return;
            SherpaOnnxOnlineStreamAcceptWaveform(_stream, 16000, samples, samples.Length);
            while (SherpaOnnxIsOnlineStreamReady(_recognizer, _stream) != 0)
                SherpaOnnxDecodeOnlineStream(_recognizer, _stream);
        }

        public string GetText()
        {
            var p = SherpaOnnxGetOnlineStreamResult(_recognizer, _stream);
            if (p == IntPtr.Zero) return "";
            try
            {
                var result = Marshal.PtrToStructure<ResultImpl>(p);
                return result.Text == IntPtr.Zero ? "" : Marshal.PtrToStringUTF8(result.Text) ?? "";
            }
            finally
            {
                SherpaOnnxDestroyOnlineRecognizerResult(p);
            }
        }

        public bool IsEndpoint => SherpaOnnxOnlineStreamIsEndpoint(_recognizer, _stream) != 0;
        public void Reset() => SherpaOnnxOnlineStreamReset(_recognizer, _stream);

        public void Dispose()
        {
            if (_stream != IntPtr.Zero) SherpaOnnxDestroyOnlineStream(_stream);
            if (_recognizer != IntPtr.Zero) SherpaOnnxDestroyOnlineRecognizer(_recognizer);
            _stream = IntPtr.Zero;
            _recognizer = IntPtr.Zero;
        }
    }

    [DllImport(DllName)] static extern IntPtr SherpaOnnxCreateOnlineRecognizer(ref OnlineRecognizerConfig config);
    [DllImport(DllName)] static extern void SherpaOnnxDestroyOnlineRecognizer(IntPtr handle);
    [DllImport(DllName)] static extern IntPtr SherpaOnnxCreateOnlineStream(IntPtr handle);
    [DllImport(DllName)] static extern void SherpaOnnxDestroyOnlineStream(IntPtr handle);
    [DllImport(DllName)] static extern void SherpaOnnxOnlineStreamAcceptWaveform(IntPtr handle, int sampleRate, float[] samples, int n);
    [DllImport(DllName)] static extern int SherpaOnnxIsOnlineStreamReady(IntPtr recognizer, IntPtr stream);
    [DllImport(DllName)] static extern void SherpaOnnxDecodeOnlineStream(IntPtr recognizer, IntPtr stream);
    [DllImport(DllName)] static extern IntPtr SherpaOnnxGetOnlineStreamResult(IntPtr recognizer, IntPtr stream);
    [DllImport(DllName)] static extern void SherpaOnnxDestroyOnlineRecognizerResult(IntPtr result);
    [DllImport(DllName)] static extern void SherpaOnnxOnlineStreamReset(IntPtr recognizer, IntPtr stream);
    [DllImport(DllName)] static extern int SherpaOnnxOnlineStreamIsEndpoint(IntPtr recognizer, IntPtr stream);
}
