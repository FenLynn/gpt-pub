using LocalSub.Models;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using SherpaOnnx;

namespace LocalSub.Services;

public sealed record BatchTranscriptionProgress(int Percent, string Stage, string Detail, int CompletedSegments = 0);
public sealed record BatchTranscriptionResult(string FilePath, TimeSpan Duration, IReadOnlyList<TranscriptItem> Items, TimeSpan ProcessingTime)
{
    public double RealTimeFactor => Duration.TotalSeconds > 0 ? ProcessingTime.TotalSeconds / Duration.TotalSeconds : 0;
}

/// <summary>
/// File transcription pipeline: media -> 16 kHz mono -> Silero VAD -> offline ASR -> timestamped transcript.
/// It deliberately streams audio instead of loading the whole movie into memory.
/// </summary>
public sealed class BatchTranscriptionService
{
    const int SampleRate = 16000;
    const int VadWindowSize = 512;

    public async Task<BatchTranscriptionResult> TranscribeAsync(
        string filePath,
        AppSettings settings,
        ModelDescriptor model,
        ModelManager models,
        IEnumerable<string> keywords,
        IProgress<BatchTranscriptionProgress>? progress = null,
        IProgress<ModelOperationProgress>? runtimeProgress = null,
        CancellationToken ct = default)
    {
        if (!File.Exists(filePath)) throw new FileNotFoundException("媒体文件不存在。", filePath);
        if (!model.BatchCapable) throw new NotSupportedException($"模型“{model.Name}”未标记为后台转写模型。");
        if (!models.IsInstalled(model)) throw new InvalidOperationException($"后台模型“{model.Name}”尚未安装。");

        progress?.Report(new(0, "准备", "检查 ASR 运行库"));
        var runtime = new AsrRuntimeManager(settings);
        await runtime.EnsureAsync(runtimeProgress, ct);

        var vadDescriptor = new ModelCatalogService().Load()
            .FirstOrDefault(x => string.Equals(x.Id, "silero-vad", StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException("模型 catalog 中缺少 Silero VAD。");
        if (!models.IsInstalled(vadDescriptor))
        {
            progress?.Report(new(0, "准备", "下载 Silero VAD"));
            await models.DownloadAsync(vadDescriptor, runtimeProgress, ct);
        }

        var vadPath = Path.Combine(models.GetModelFolder(vadDescriptor), "silero_vad.onnx");
        var keywordArray = keywords.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        return await Task.Run(() => TranscribeCore(filePath, model, models.GetModelFolder(model), vadPath, runtime.RuntimeRoot, keywordArray, progress, ct), ct);
    }

    static BatchTranscriptionResult TranscribeCore(
        string filePath,
        ModelDescriptor model,
        string modelFolder,
        string vadPath,
        string runtimeFolder,
        string[] keywords,
        IProgress<BatchTranscriptionProgress>? progress,
        CancellationToken ct)
    {
        var started = DateTime.UtcNow;
        SherpaInterop.ConfigureRuntime(runtimeFolder);
        using var recognizer = CreateRecognizer(model, modelFolder);
        using var vad = CreateVad(vadPath);
        using var reader = new MediaFoundationReader(filePath);
        var duration = reader.TotalTime;
        if (duration <= TimeSpan.Zero) throw new InvalidDataException("无法取得媒体时长。");

        ISampleProvider provider = reader.ToSampleProvider();
        provider = new DownmixToMonoSampleProvider(provider);
        if (provider.WaveFormat.SampleRate != SampleRate)
            provider = new WdlResamplingSampleProvider(provider, SampleRate);

        var transcript = new TranscriptService();
        var input = new float[8192];
        var pending = new List<float>(VadWindowSize * 4);
        long samplesRead = 0;
        var lastPercent = -1;
        var segmentCount = 0;

        progress?.Report(new(1, "转写", $"{model.Name} 已加载，开始扫描音轨"));
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            var read = provider.Read(input, 0, input.Length);
            if (read <= 0) break;
            samplesRead += read;
            for (var i = 0; i < read; i++) pending.Add(input[i]);

            var offset = 0;
            while (pending.Count - offset >= VadWindowSize)
            {
                var window = pending.GetRange(offset, VadWindowSize).ToArray();
                vad.AcceptWaveform(window);
                offset += VadWindowSize;
                DrainVad(vad, recognizer, transcript, keywords, ref segmentCount, progress, duration, samplesRead, ct);
            }
            if (offset > 0) pending.RemoveRange(0, offset);

            var elapsed = samplesRead / (double)SampleRate;
            var percent = (int)Math.Clamp(elapsed * 100 / duration.TotalSeconds, 0, 98);
            if (percent >= lastPercent + 1)
            {
                progress?.Report(new(percent, "转写", $"{FormatClock(TimeSpan.FromSeconds(elapsed))} / {FormatClock(duration)}，已识别 {segmentCount} 段", segmentCount));
                lastPercent = percent;
            }
        }

        if (pending.Count > 0)
        {
            while (pending.Count < VadWindowSize) pending.Add(0);
            vad.AcceptWaveform(pending.Take(VadWindowSize).ToArray());
        }
        // Pad silence before flush so an utterance ending exactly at EOF can close naturally.
        var silence = new float[VadWindowSize];
        for (var i = 0; i < 16; i++) vad.AcceptWaveform(silence);
        vad.Flush();
        DrainVad(vad, recognizer, transcript, keywords, ref segmentCount, progress, duration, samplesRead, ct);

        var processing = DateTime.UtcNow - started;
        progress?.Report(new(100, "完成", $"识别 {transcript.Items.Count} 段，耗时 {FormatClock(processing)}，RTF {(processing.TotalSeconds / Math.Max(0.001, duration.TotalSeconds)):0.00}", transcript.Items.Count));
        return new BatchTranscriptionResult(filePath, duration, transcript.Items.ToArray(), processing);
    }

    static void DrainVad(
        VoiceActivityDetector vad,
        OfflineRecognizer recognizer,
        TranscriptService transcript,
        string[] keywords,
        ref int segmentCount,
        IProgress<BatchTranscriptionProgress>? progress,
        TimeSpan duration,
        long samplesRead,
        CancellationToken ct)
    {
        while (!vad.IsEmpty())
        {
            ct.ThrowIfCancellationRequested();
            var segment = vad.Front();
            vad.Pop();
            if (segment.Samples.Length < 1600) continue;

            var startSample = ReadSegmentStart(segment);
            if (startSample < 0) startSample = Math.Max(0, samplesRead - segment.Samples.Length);
            var start = TimeSpan.FromSeconds(startSample / (double)SampleRate);
            var end = start + TimeSpan.FromSeconds(segment.Samples.Length / (double)SampleRate);

            using var stream = recognizer.CreateStream();
            stream.AcceptWaveform(SampleRate, segment.Samples);
            recognizer.Decode(stream);
            var text = Cleanup(stream.Result.Text);
            if (string.IsNullOrWhiteSpace(text)) continue;

            transcript.Add(new TranscriptItem { Start = start, End = end, Text = text }, keywords);
            segmentCount++;
            var percent = (int)Math.Clamp(end.TotalSeconds * 100 / Math.Max(0.001, duration.TotalSeconds), 0, 99);
            progress?.Report(new(percent, "识别语音段", $"{FormatClock(start)}  {TrimForStatus(text)}", segmentCount));
        }
    }

    static long ReadSegmentStart(object segment)
    {
        try
        {
            var p = segment.GetType().GetProperty("Start");
            var value = p?.GetValue(segment);
            return value == null ? -1 : Convert.ToInt64(value);
        }
        catch { return -1; }
    }

    static OfflineRecognizer CreateRecognizer(ModelDescriptor model, string folder)
    {
        var cfg = new OfflineRecognizerConfig();
        cfg.ModelConfig.NumThreads = Math.Clamp(Environment.ProcessorCount / 2, 1, 6);
        cfg.ModelConfig.Provider = "cpu";
        cfg.ModelConfig.Debug = 0;
        cfg.DecodingMethod = "greedy_search";

        if (string.Equals(model.Id, "sensevoice-small-int8", StringComparison.OrdinalIgnoreCase))
        {
            cfg.ModelConfig.Tokens = Path.Combine(folder, "tokens.txt");
            cfg.ModelConfig.SenseVoice.Model = Path.Combine(folder, "model.int8.onnx");
            cfg.ModelConfig.SenseVoice.Language = "auto";
            cfg.ModelConfig.SenseVoice.UseInverseTextNormalization = 1;
        }
        else if (string.Equals(model.Id, "offline-zipformer-ctc-zh-int8", StringComparison.OrdinalIgnoreCase))
        {
            cfg.ModelConfig.Tokens = Path.Combine(folder, "tokens.txt");
            cfg.ModelConfig.ZipformerCtc.Model = Path.Combine(folder, "model.int8.onnx");
        }
        else if (string.Equals(model.Id, "funasr-nano-int8", StringComparison.OrdinalIgnoreCase))
        {
            cfg.ModelConfig.Tokens = "";
            cfg.ModelConfig.FunAsrNano.EncoderAdaptor = Path.Combine(folder, "encoder_adaptor.int8.onnx");
            cfg.ModelConfig.FunAsrNano.LLM = Path.Combine(folder, "llm.int8.onnx");
            cfg.ModelConfig.FunAsrNano.Embedding = Path.Combine(folder, "embedding.int8.onnx");
            cfg.ModelConfig.FunAsrNano.Tokenizer = Path.Combine(folder, "Qwen3-0.6B");
        }
        else
        {
            throw new NotSupportedException($"当前后台转写尚未配置模型“{model.Name}”。");
        }

        return new OfflineRecognizer(cfg);
    }

    static VoiceActivityDetector CreateVad(string modelPath)
    {
        var cfg = new VadModelConfig
        {
            SampleRate = SampleRate,
            NumThreads = 1,
            Provider = "cpu",
            Debug = 0
        };
        cfg.SileroVad.Model = modelPath;
        cfg.SileroVad.Threshold = 0.45f;
        cfg.SileroVad.MinSilenceDuration = 0.30f;
        cfg.SileroVad.MinSpeechDuration = 0.20f;
        cfg.SileroVad.MaxSpeechDuration = 12.0f;
        cfg.SileroVad.WindowSize = VadWindowSize;
        return new VoiceActivityDetector(cfg, 120.0f);
    }

    static string Cleanup(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        var s = text.Trim();
        while (s.Contains("  ", StringComparison.Ordinal)) s = s.Replace("  ", " ", StringComparison.Ordinal);
        return s;
    }

    static string TrimForStatus(string text) => text.Length <= 45 ? text : text[..45] + "…";
    static string FormatClock(TimeSpan t) => t.TotalHours >= 1 ? t.ToString(@"hh\:mm\:ss") : t.ToString(@"mm\:ss");

    sealed class DownmixToMonoSampleProvider : ISampleProvider
    {
        readonly ISampleProvider _source;
        readonly int _channels;
        float[] _scratch = [];

        public DownmixToMonoSampleProvider(ISampleProvider source)
        {
            _source = source;
            _channels = Math.Max(1, source.WaveFormat.Channels);
            WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(source.WaveFormat.SampleRate, 1);
        }

        public WaveFormat WaveFormat { get; }

        public int Read(float[] buffer, int offset, int count)
        {
            var needed = count * _channels;
            if (_scratch.Length < needed) _scratch = new float[needed];
            var read = _source.Read(_scratch, 0, needed);
            var frames = read / _channels;
            for (var f = 0; f < frames; f++)
            {
                double sum = 0;
                var b = f * _channels;
                for (var c = 0; c < _channels; c++) sum += _scratch[b + c];
                buffer[offset + f] = (float)(sum / _channels);
            }
            return frames;
        }
    }
}
