using LocalSub.Core;
using LocalSub.Models;
using SherpaOnnx;

namespace LocalSub.Services;

public sealed record BatchTranscriptionProgress(int Percent, string Stage, string Detail, int CompletedSegments = 0);
public sealed record BatchTranscriptionResult(string FilePath, TimeSpan Duration, IReadOnlyList<TranscriptItem> Items, TimeSpan ProcessingTime, string DecoderName)
{
    public double RealTimeFactor => Duration.TotalSeconds > 0 ? ProcessingTime.TotalSeconds / Duration.TotalSeconds : 0;
}

public sealed class BatchTranscriptionService
{
    const int SampleRate = 16000;
    const int VadWindowSize = 512;
    const int EnergyFrameSize = 320;

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

        Log($"START file={Path.GetFileName(filePath)} model={model.Id}");
        try
        {
            progress?.Report(new(0, "准备", "检查 ASR 运行库"));
            var runtime = new AsrRuntimeManager(settings);
            await runtime.EnsureAsync(runtimeProgress, ct);

            var vadDescriptor = new ModelCatalogService().Load().FirstOrDefault(x => string.Equals(x.Id, "silero-vad", StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("模型 catalog 中缺少 Silero VAD。");
            if (!models.IsInstalled(vadDescriptor))
            {
                progress?.Report(new(0, "准备", "下载 Silero VAD"));
                await models.DownloadAsync(vadDescriptor, runtimeProgress, ct);
            }

            var vadPath = Path.Combine(models.GetModelFolder(vadDescriptor), "silero_vad.onnx");
            var keywordArray = keywords.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            var ffmpeg = new FfmpegManager(settings);
            var threads = PerformancePolicy.BatchThreads(settings.ResourceProfile);
            progress?.Report(new(1, "加载模型", $"正在加载 {model.Name}，大型模型首次加载可能需要一些时间"));
            var result = await Task.Run(() => TranscribeCore(filePath, model, models.GetModelFolder(model), vadPath, runtime.RuntimeRoot, ffmpeg, threads, keywordArray, progress, ct), ct);
            Log($"DONE file={Path.GetFileName(filePath)} model={model.Id} segments={result.Items.Count} rtf={result.RealTimeFactor:0.000}");
            return result;
        }
        catch (Exception ex)
        {
            Log($"FAIL file={Path.GetFileName(filePath)} model={model.Id} {ex}");
            throw;
        }
    }

    static BatchTranscriptionResult TranscribeCore(
        string filePath,
        ModelDescriptor model,
        string modelFolder,
        string vadPath,
        string runtimeFolder,
        FfmpegManager ffmpeg,
        int threads,
        string[] keywords,
        IProgress<BatchTranscriptionProgress>? progress,
        CancellationToken ct)
    {
        var started = DateTime.UtcNow;
        SherpaInterop.ConfigureRuntime(runtimeFolder);
        progress?.Report(new(1, "加载模型", $"{model.Name}，CPU {threads} 线程"));
        using var recognizer = CreateRecognizer(model, modelFolder, threads);
        progress?.Report(new(2, "模型就绪", $"{model.Name} 已加载，正在打开音轨"));
        using var vad = CreateVad(vadPath);

        var transcript = new TranscriptService();
        var input = new float[8192];
        var pending = new List<float>(VadWindowSize * 4);
        var rmsFrames = new List<float>();
        long samplesRead = 0;
        var lastPercent = -1;
        var segmentCount = 0;
        TimeSpan duration;
        string decoderName;

        using (var source = new MediaAudioSource.Mono16kSource(MediaAudioSource.Open(filePath, ffmpeg)))
        {
            duration = source.Duration;
            decoderName = source.DecoderName;
            if (duration <= TimeSpan.Zero) throw new InvalidDataException("无法取得媒体时长。");

            progress?.Report(new(3, "VAD 扫描", $"{model.Name} 已加载，{decoderName}，{threads} 线程"));
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                var read = source.Read(input, 0, input.Length);
                if (read <= 0) break;
                samplesRead += read;
                CollectRmsFrames(input, read, rmsFrames);
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
                var percent = (int)Math.Clamp(elapsed * 100 / duration.TotalSeconds, 3, 96);
                if (percent >= lastPercent + 2)
                {
                    progress?.Report(new(percent, "VAD 扫描", $"{FormatClock(TimeSpan.FromSeconds(elapsed))} / {FormatClock(duration)}，已识别 {segmentCount} 段", segmentCount));
                    lastPercent = percent;
                }
            }
        }

        if (pending.Count > 0)
        {
            while (pending.Count < VadWindowSize) pending.Add(0);
            vad.AcceptWaveform(pending.Take(VadWindowSize).ToArray());
        }
        var silence = new float[VadWindowSize];
        for (var i = 0; i < 20; i++) vad.AcceptWaveform(silence);
        vad.Flush();
        DrainVad(vad, recognizer, transcript, keywords, ref segmentCount, progress, duration, samplesRead, ct);

        if (transcript.Items.Count == 0)
        {
            var threshold = EstimateEnergyThreshold(rmsFrames);
            Log($"VAD_ZERO file={Path.GetFileName(filePath)} energy_threshold={threshold:0.000000}");
            progress?.Report(new(3, "VAD fallback", $"Silero VAD 得到 0 段，自动启用音量分段，RMS 阈值 {threshold:0.0000}"));
            var candidates = DecodeEnergySegments(filePath, ffmpeg, recognizer, transcript, keywords, duration, threshold, ref segmentCount, progress, ct);
            decoderName += " + 音量 fallback";

            if (transcript.Items.Count == 0)
            {
                Log($"ENERGY_EMPTY file={Path.GetFileName(filePath)} candidates={candidates}");
                progress?.Report(new(4, "宽松 fallback", candidates > 0
                    ? $"音量分段已尝试 {candidates} 段但模型返回空文本，继续用宽松 8 秒分块"
                    : "音量分段仍未找到有效片段，继续用宽松 8 秒分块"));
                var broad = DecodeBroadChunks(filePath, ffmpeg, recognizer, transcript, keywords, duration, Math.Max(0.0008f, threshold * 0.35f), ref segmentCount, progress, ct);
                decoderName += " + 宽松分块";
                if (transcript.Items.Count == 0)
                {
                    Log($"BROAD_EMPTY file={Path.GetFileName(filePath)} chunks={broad}");
                    progress?.Report(new(99, "无识别结果", $"VAD、音量分段和 {broad} 个宽松分块均无文本，请查看 Logs\\batch.log。"));
                }
            }
        }

        var processing = DateTime.UtcNow - started;
        progress?.Report(new(100, "完成", $"识别 {transcript.Items.Count} 段，耗时 {FormatClock(processing)}，RTF {(processing.TotalSeconds / Math.Max(0.001, duration.TotalSeconds)):0.00}", transcript.Items.Count));
        return new BatchTranscriptionResult(filePath, duration, transcript.Items.ToArray(), processing, decoderName);
    }

    static void DrainVad(VoiceActivityDetector vad, OfflineRecognizer recognizer, TranscriptService transcript, string[] keywords, ref int segmentCount,
        IProgress<BatchTranscriptionProgress>? progress, TimeSpan duration, long samplesRead, CancellationToken ct)
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
            DecodeAndAppend(recognizer, transcript, keywords, segment.Samples, start, end, ref segmentCount, progress, duration, "识别语音段", ct);
        }
    }

    static int DecodeEnergySegments(
        string filePath,
        FfmpegManager ffmpeg,
        OfflineRecognizer recognizer,
        TranscriptService transcript,
        string[] keywords,
        TimeSpan duration,
        float threshold,
        ref int segmentCount,
        IProgress<BatchTranscriptionProgress>? progress,
        CancellationToken ct)
    {
        const int preRollSamples = SampleRate / 5;
        const int silenceFramesToClose = 25;
        const int maxSegmentSamples = SampleRate * 10;
        var attempts = 0;
        using var source = new MediaAudioSource.Mono16kSource(MediaAudioSource.Open(filePath, ffmpeg));
        var input = new float[8192];
        var pending = new List<float>(8192 + EnergyFrameSize);
        var preRoll = new List<float>(preRollSamples);
        var segment = new List<float>(SampleRate * 4);
        long frameStart = 0;
        long segmentStart = 0;
        var active = false;
        var silenceFrames = 0;
        var lastPercent = -1;

        while (true)
        {
            ct.ThrowIfCancellationRequested();
            var read = source.Read(input, 0, input.Length);
            if (read <= 0) break;
            for (var i = 0; i < read; i++) pending.Add(input[i]);
            var offset = 0;
            while (pending.Count - offset >= EnergyFrameSize)
            {
                ct.ThrowIfCancellationRequested();
                var frame = pending.GetRange(offset, EnergyFrameSize).ToArray();
                offset += EnergyFrameSize;
                var speech = ComputeRms(frame, frame.Length) >= threshold;

                if (!active)
                {
                    if (speech)
                    {
                        active = true;
                        segmentStart = Math.Max(0, frameStart - preRoll.Count);
                        if (preRoll.Count > 0) segment.AddRange(preRoll);
                        segment.AddRange(frame);
                        preRoll.Clear();
                    }
                    else
                    {
                        preRoll.AddRange(frame);
                        if (preRoll.Count > preRollSamples) preRoll.RemoveRange(0, preRoll.Count - preRollSamples);
                    }
                }
                else
                {
                    segment.AddRange(frame);
                    silenceFrames = speech ? 0 : silenceFrames + 1;
                    if (silenceFrames >= silenceFramesToClose || segment.Count >= maxSegmentSamples)
                    {
                        attempts += DecodeEnergyCandidate(recognizer, transcript, keywords, segment, segmentStart, ref segmentCount, progress, duration, ct);
                        segment.Clear();
                        active = false;
                        silenceFrames = 0;
                        preRoll.Clear();
                    }
                }

                frameStart += EnergyFrameSize;
                var percent = (int)Math.Clamp(frameStart * 100.0 / Math.Max(1, duration.TotalSeconds * SampleRate), 0, 98);
                if (percent >= lastPercent + 5)
                {
                    progress?.Report(new(percent, "VAD fallback", $"音量分段 {percent}% · 已尝试 {attempts} 段 · 已识别 {segmentCount} 段", segmentCount));
                    lastPercent = percent;
                }
            }
            if (offset > 0) pending.RemoveRange(0, offset);
        }

        if (active && segment.Count > 0)
            attempts += DecodeEnergyCandidate(recognizer, transcript, keywords, segment, segmentStart, ref segmentCount, progress, duration, ct);
        return attempts;
    }

    static int DecodeEnergyCandidate(
        OfflineRecognizer recognizer,
        TranscriptService transcript,
        string[] keywords,
        List<float> segment,
        long startSample,
        ref int segmentCount,
        IProgress<BatchTranscriptionProgress>? progress,
        TimeSpan duration,
        CancellationToken ct)
    {
        if (segment.Count < SampleRate / 5) return 0;
        var start = TimeSpan.FromSeconds(startSample / (double)SampleRate);
        var end = start + TimeSpan.FromSeconds(segment.Count / (double)SampleRate);
        DecodeAndAppend(recognizer, transcript, keywords, segment.ToArray(), start, end, ref segmentCount, progress, duration, "fallback 识别", ct);
        return 1;
    }

    static int DecodeBroadChunks(
        string filePath,
        FfmpegManager ffmpeg,
        OfflineRecognizer recognizer,
        TranscriptService transcript,
        string[] keywords,
        TimeSpan duration,
        float minRms,
        ref int segmentCount,
        IProgress<BatchTranscriptionProgress>? progress,
        CancellationToken ct)
    {
        const int chunkSamples = SampleRate * 8;
        using var source = new MediaAudioSource.Mono16kSource(MediaAudioSource.Open(filePath, ffmpeg));
        var buffer = new float[chunkSamples];
        long startSample = 0;
        var attempts = 0;
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            var total = 0;
            while (total < buffer.Length)
            {
                var read = source.Read(buffer, total, buffer.Length - total);
                if (read <= 0) break;
                total += read;
            }
            if (total <= 0) break;

            var rms = ComputeRms(buffer, total);
            if (rms >= minRms)
            {
                attempts++;
                var samples = buffer.Take(total).ToArray();
                var start = TimeSpan.FromSeconds(startSample / (double)SampleRate);
                var end = start + TimeSpan.FromSeconds(total / (double)SampleRate);
                DecodeAndAppend(recognizer, transcript, keywords, samples, start, end, ref segmentCount, progress, duration, "宽松分块识别", ct);
            }
            startSample += total;
            var percent = (int)Math.Clamp(startSample * 100.0 / Math.Max(1, duration.TotalSeconds * SampleRate), 0, 99);
            progress?.Report(new(percent, "宽松 fallback", $"{percent}% · 已尝试 {attempts} 块 · 已识别 {segmentCount} 段", segmentCount));
            if (total < buffer.Length) break;
        }
        return attempts;
    }

    static void DecodeAndAppend(
        OfflineRecognizer recognizer,
        TranscriptService transcript,
        string[] keywords,
        float[] samples,
        TimeSpan start,
        TimeSpan end,
        ref int segmentCount,
        IProgress<BatchTranscriptionProgress>? progress,
        TimeSpan duration,
        string stage,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        try
        {
            using var stream = recognizer.CreateStream();
            if (stream.Handle == IntPtr.Zero)
                throw new InvalidOperationException("sherpa-onnx 未能创建离线识别流。");

            stream.AcceptWaveform(SampleRate, samples);
            recognizer.Decode(stream);
            var text = Cleanup(SherpaOfflineResultReader.GetText(stream));
            if (string.IsNullOrWhiteSpace(text)) return;

            transcript.Add(new TranscriptItem { Start = start, End = end, Text = text }, keywords);
            segmentCount++;
            var percent = (int)Math.Clamp(end.TotalSeconds * 100 / Math.Max(0.001, duration.TotalSeconds), 0, 99);
            progress?.Report(new(percent, stage, $"{FormatClock(start)}  {TrimForStatus(text)}", segmentCount));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Log($"DECODE_FAIL stage={stage} start={start.TotalSeconds:0.000}s samples={samples.Length} type={ex.GetType().Name} {ex}");
            throw new InvalidOperationException($"{stage}在 {FormatClock(start)} 失败：{ex.Message}", ex);
        }
    }

    static void CollectRmsFrames(float[] samples, int count, List<float> output)
    {
        for (var offset = 0; offset + EnergyFrameSize <= count; offset += EnergyFrameSize)
            output.Add(ComputeRms(samples.AsSpan(offset, EnergyFrameSize)));
    }

    static float EstimateEnergyThreshold(List<float> values)
    {
        var sorted = values.Where(x => x > 0.00001f && float.IsFinite(x)).OrderBy(x => x).ToArray();
        if (sorted.Length == 0) return 0.0015f;
        var p20 = Percentile(sorted, 0.20);
        var p85 = Percentile(sorted, 0.85);
        var candidate = Math.Max(0.0015f, Math.Max(p20 * 2.2f, p85 * 0.16f));
        var cap = Math.Max(0.0020f, p85 * 0.55f);
        return Math.Clamp(Math.Min(candidate, cap), 0.0010f, 0.08f);
    }

    static float Percentile(float[] sorted, double fraction)
    {
        if (sorted.Length == 0) return 0;
        var index = (int)Math.Clamp(Math.Round((sorted.Length - 1) * fraction), 0, sorted.Length - 1);
        return sorted[index];
    }

    static float ComputeRms(float[] samples, int count) => ComputeRms(samples.AsSpan(0, count));

    static float ComputeRms(ReadOnlySpan<float> samples)
    {
        if (samples.Length == 0) return 0;
        double sum = 0;
        foreach (var v in samples) sum += v * v;
        return (float)Math.Sqrt(sum / samples.Length);
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

    static OfflineRecognizer CreateRecognizer(ModelDescriptor model, string folder, int threads)
    {
        var cfg = new OfflineRecognizerConfig();
        cfg.FeatConfig.SampleRate = SampleRate;
        cfg.FeatConfig.FeatureDim = 80;
        cfg.ModelConfig.NumThreads = Math.Clamp(threads, 1, 12);
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
        else throw new NotSupportedException($"当前后台转写尚未配置模型“{model.Name}”。");
        return new OfflineRecognizer(cfg);
    }

    static VoiceActivityDetector CreateVad(string modelPath)
    {
        var cfg = new VadModelConfig { SampleRate = SampleRate, NumThreads = 1, Provider = "cpu", Debug = 0 };
        cfg.SileroVad.Model = modelPath;
        cfg.SileroVad.Threshold = 0.32f;
        cfg.SileroVad.MinSilenceDuration = 0.38f;
        cfg.SileroVad.MinSpeechDuration = 0.16f;
        cfg.SileroVad.MaxSpeechDuration = 9.0f;
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

    static void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(PortablePaths.LogsDir);
            File.AppendAllText(Path.Combine(PortablePaths.LogsDir, "batch.log"), $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}{Environment.NewLine}");
        }
        catch { }
    }

    static string TrimForStatus(string text) => text.Length <= 45 ? text : text[..45] + "…";
    static string FormatClock(TimeSpan t) => t.TotalHours >= 1 ? t.ToString(@"hh\:mm\:ss") : t.ToString(@"mm\:ss");
}
