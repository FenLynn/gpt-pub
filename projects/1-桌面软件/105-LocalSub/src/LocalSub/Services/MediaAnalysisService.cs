using LocalSub.Models;

namespace LocalSub.Services;

public sealed record MediaAnalysisProgress(int Percent, string Stage, string Detail);
public sealed record MediaAnalysisResult(string FilePath, TimeSpan Duration, int SampleRate, int Channels, float[] Waveform, double SecondsPerPoint, string DecoderName);

public sealed class MediaAnalysisService
{
    public Task<MediaAnalysisResult> AnalyzeAsync(string filePath, IProgress<MediaAnalysisProgress>? progress = null, CancellationToken ct = default)
        => AnalyzeAsync(filePath, AppSettings.Load(), progress, ct);

    public Task<MediaAnalysisResult> AnalyzeAsync(string filePath, AppSettings settings, IProgress<MediaAnalysisProgress>? progress = null, CancellationToken ct = default)
    {
#if !LOCALSUB_CORE_WORKER
        if (CoreWorkerBroker.IsAvailable)
            return CoreWorkerBroker.Shared.AnalyzeAsync(filePath, progress, ct);
#endif
        return Task.Run(() => AnalyzeCore(filePath, settings, progress, ct), ct);
    }

    static MediaAnalysisResult AnalyzeCore(string filePath, AppSettings settings, IProgress<MediaAnalysisProgress>? progress, CancellationToken ct)
    {
        if (!File.Exists(filePath)) throw new FileNotFoundException("媒体文件不存在。", filePath);
        progress?.Report(new(0, "打开媒体", Path.GetFileName(filePath)));

        var ffmpeg = new FfmpegManager(settings);
        using var source = MediaAudioSource.Open(filePath, ffmpeg);
        var duration = source.Duration;
        var sampleRate = source.SampleRate;
        var channels = Math.Max(1, source.Channels);
        if (duration <= TimeSpan.Zero) throw new InvalidDataException("无法取得媒体音频时长。");

        var totalFrames = Math.Max(1L, (long)Math.Ceiling(duration.TotalSeconds * sampleRate));
        var framesPerPoint = Math.Max(sampleRate / 20, (int)Math.Ceiling(totalFrames / 2500.0));
        var secondsPerPoint = framesPerPoint / (double)sampleRate;
        var points = new List<float>((int)Math.Min(3000, Math.Ceiling((double)totalFrames / framesPerPoint) + 4));
        var buffer = new float[8192 * channels];
        long framesRead = 0;
        var bucketFrames = 0;
        double bucketSquares = 0;
        float bucketPeak = 0;
        var lastPercent = -1;

        while (true)
        {
            ct.ThrowIfCancellationRequested();
            var read = source.Read(buffer, 0, buffer.Length);
            if (read <= 0) break;
            var frameCount = read / channels;
            for (var f = 0; f < frameCount; f++)
            {
                double sum = 0;
                var frameBase = f * channels;
                for (var c = 0; c < channels; c++) sum += buffer[frameBase + c];
                var mono = (float)(sum / channels);
                var abs = Math.Abs(mono);
                bucketPeak = Math.Max(bucketPeak, abs);
                bucketSquares += mono * mono;
                bucketFrames++;
                framesRead++;
                if (bucketFrames >= framesPerPoint)
                {
                    var rms = (float)Math.Sqrt(bucketSquares / Math.Max(1, bucketFrames));
                    points.Add(Math.Clamp(rms * 0.72f + bucketPeak * 0.28f, 0f, 1f));
                    bucketFrames = 0;
                    bucketSquares = 0;
                    bucketPeak = 0;
                }
            }

            var percent = (int)Math.Clamp(framesRead * 100L / totalFrames, 0, 99);
            if (percent >= lastPercent + 2)
            {
                var elapsed = TimeSpan.FromSeconds(framesRead / (double)sampleRate);
                progress?.Report(new(percent, "解析音轨", $"{source.DecoderName}  {FormatClock(elapsed)} / {FormatClock(duration)}"));
                lastPercent = percent;
            }
        }

        if (bucketFrames > 0)
        {
            var rms = (float)Math.Sqrt(bucketSquares / Math.Max(1, bucketFrames));
            points.Add(Math.Clamp(rms * 0.72f + bucketPeak * 0.28f, 0f, 1f));
        }

        progress?.Report(new(100, "完成", $"{source.DecoderName} 已生成 {points.Count} 个波形点"));
        return new MediaAnalysisResult(filePath, duration, sampleRate, channels, points.ToArray(), secondsPerPoint, source.DecoderName);
    }

    static string FormatClock(TimeSpan value)
        => value.TotalHours >= 1 ? value.ToString(@"hh\:mm\:ss") : value.ToString(@"mm\:ss");
}
