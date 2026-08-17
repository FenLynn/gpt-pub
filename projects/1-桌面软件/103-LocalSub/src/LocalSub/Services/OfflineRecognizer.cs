using System.Reflection;
using System.Runtime.InteropServices;
using LocalSub.Models;
using SherpaOnnx;

namespace LocalSub.Services;

/// <summary>
/// Compatibility bridge used by LocalSub services. It intentionally shadows
/// SherpaOnnx.OfflineRecognizer inside the LocalSub.Services namespace, so the
/// existing batch/SenseVoice/Fun-ASR call sites keep their current shape while
/// recognizer creation is routed through our UTF-8 native C API wrapper.
/// </summary>
internal sealed class OfflineRecognizer : IDisposable
{
    const string DllName = "sherpa-onnx-c-api";
    static readonly FieldInfo NativeHandleField = typeof(NativeOfflineRecognizer)
        .GetField("_recognizer", BindingFlags.Instance | BindingFlags.NonPublic)
        ?? throw new MissingFieldException(nameof(NativeOfflineRecognizer), "_recognizer");

    readonly NativeOfflineRecognizer _native;
    IntPtr _handle;

    public OfflineRecognizer(OfflineRecognizerConfig config)
    {
        var (descriptor, folder, runtimeRoot) = ResolveModel(config);
        var threads = Math.Clamp(config.ModelConfig.NumThreads <= 0 ? 1 : config.ModelConfig.NumThreads, 1, 12);
        _native = new NativeOfflineRecognizer(descriptor, folder, threads, runtimeRoot);
        _handle = (IntPtr)(NativeHandleField.GetValue(_native) ?? IntPtr.Zero);
        if (_handle == IntPtr.Zero)
        {
            _native.Dispose();
            throw new InvalidOperationException($"sherpa-onnx 无法加载离线模型“{descriptor.Name}”。");
        }
    }

    public SherpaOnnx.OfflineStream CreateStream()
    {
        if (_handle == IntPtr.Zero) return new SherpaOnnx.OfflineStream(IntPtr.Zero);
        var stream = SherpaOnnxCreateOfflineStream(_handle);
        return new SherpaOnnx.OfflineStream(stream);
    }

    public void Decode(SherpaOnnx.OfflineStream stream)
    {
        if (_handle == IntPtr.Zero) throw new ObjectDisposedException(nameof(OfflineRecognizer));
        if (stream.Handle == IntPtr.Zero) throw new InvalidOperationException("sherpa-onnx 未能创建离线识别流。");
        SherpaOnnxDecodeOfflineStream(_handle, stream.Handle);
    }

    public void Dispose()
    {
        _handle = IntPtr.Zero;
        _native.Dispose();
    }

    static (ModelDescriptor Descriptor, string Folder, string RuntimeRoot) ResolveModel(OfflineRecognizerConfig config)
    {
        string folder;
        ModelDescriptor descriptor;

        if (!string.IsNullOrWhiteSpace(config.ModelConfig.SenseVoice.Model))
        {
            var modelPath = Path.GetFullPath(config.ModelConfig.SenseVoice.Model);
            folder = Path.GetDirectoryName(modelPath) ?? throw new InvalidDataException("SenseVoice 模型路径无效。");
            descriptor = new ModelDescriptor
            {
                Id = "sensevoice-small-int8",
                Name = "SenseVoice Small INT8",
                FolderName = Path.GetFileName(folder),
                RequiredFiles = ["model.int8.onnx", "tokens.txt"],
                BatchCapable = true,
                LiveCapable = true
            };
            ValidateSenseVoiceFiles(folder);
        }
        else if (!string.IsNullOrWhiteSpace(config.ModelConfig.ZipformerCtc.Model))
        {
            var modelPath = Path.GetFullPath(config.ModelConfig.ZipformerCtc.Model);
            folder = Path.GetDirectoryName(modelPath) ?? throw new InvalidDataException("Offline Zipformer CTC 模型路径无效。");
            descriptor = new ModelDescriptor
            {
                Id = "offline-zipformer-ctc-zh-int8",
                Name = "Zipformer CTC Offline 中文 INT8",
                FolderName = Path.GetFileName(folder),
                RequiredFiles = ["model.int8.onnx", "tokens.txt"],
                BatchCapable = true
            };
        }
        else if (!string.IsNullOrWhiteSpace(config.ModelConfig.FireRedAsrCtc.Model))
        {
            var modelPath = Path.GetFullPath(config.ModelConfig.FireRedAsrCtc.Model);
            folder = Path.GetDirectoryName(modelPath) ?? throw new InvalidDataException("FireRedASR2 CTC 模型路径无效。");
            descriptor = new ModelDescriptor
            {
                Id = "firered-asr2-ctc-zh-en-int8",
                Name = "FireRedASR2 CTC 中英 INT8",
                FolderName = Path.GetFileName(folder),
                RequiredFiles = ["model.int8.onnx", "tokens.txt"],
                BatchCapable = true
            };
        }
        else if (!string.IsNullOrWhiteSpace(config.ModelConfig.FunAsrNano.EncoderAdaptor))
        {
            var modelPath = Path.GetFullPath(config.ModelConfig.FunAsrNano.EncoderAdaptor);
            folder = Path.GetDirectoryName(modelPath) ?? throw new InvalidDataException("Fun-ASR-Nano 模型路径无效。");
            descriptor = new ModelDescriptor
            {
                Id = "funasr-nano-int8",
                Name = "Fun-ASR-Nano INT8",
                FolderName = Path.GetFileName(folder),
                RequiredFiles = ["encoder_adaptor.int8.onnx", "llm.int8.onnx", "embedding.int8.onnx", "Qwen3-0.6B"],
                BatchCapable = true,
                LiveCapable = false
            };
        }
        else
        {
            throw new NotSupportedException("LocalSub native 离线桥没有识别到已配置的 SenseVoice、Offline Zipformer CTC、FireRedASR2 CTC 或 Fun-ASR-Nano 模型。");
        }

        var asrRoot = Directory.GetParent(folder)?.FullName
            ?? throw new InvalidDataException("无法从模型目录推导 ASR 根目录。");
        var runtimeRoot = Path.Combine(asrRoot, "_runtime");
        if (!File.Exists(Path.Combine(runtimeRoot, "sherpa-onnx-c-api.dll")))
            throw new FileNotFoundException("ASR native runtime 不完整。", Path.Combine(runtimeRoot, "sherpa-onnx-c-api.dll"));

        return (descriptor, folder, runtimeRoot);
    }

    static void ValidateSenseVoiceFiles(string folder)
    {
        var model = Path.Combine(folder, "model.int8.onnx");
        var tokens = Path.Combine(folder, "tokens.txt");
        if (!File.Exists(model) || !File.Exists(tokens)) return;

        var modelBytes = new FileInfo(model).Length;
        var tokenBytes = new FileInfo(tokens).Length;
        // Official SenseVoice INT8 is about 228 MB and tokens.txt about 308 KB.
        // Use deliberately loose lower bounds so a truncated/corrupt install is
        // rejected without tying the app to one exact archive byte count.
        if (modelBytes < 180L * 1024 * 1024 || tokenBytes < 150L * 1024)
            throw new InvalidDataException(
                $"SenseVoice 模型文件体积异常：model.int8.onnx={modelBytes / 1024d / 1024d:0.0} MB，tokens.txt={tokenBytes / 1024d:0} KB。请在模型页删除后重新下载/修复。");
    }

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr SherpaOnnxCreateOfflineStream(IntPtr recognizer);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    static extern void SherpaOnnxDecodeOfflineStream(IntPtr recognizer, IntPtr stream);
}
