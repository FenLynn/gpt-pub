using System.Runtime.InteropServices;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace LocalSub.Services;

public sealed record MediaAnalysisProgress(int Percent, string Stage, string Detail);
public sealed record MediaAnalysisResult(string FilePath, TimeSpan Duration, int SampleRate, int Channels, float[] Waveform, double SecondsPerPoint);

public sealed class MediaAnalysisService
{
    public Task<MediaAnalysisResult> AnalyzeAsync(string filePath, IProgress<MediaAnalysisProgress>? progress = null, CancellationToken ct = default)
        => Task.Run(() => AnalyzeCore(filePath, progress, ct), ct);

    MediaAnalysisResult AnalyzeCore(string filePath, IProgress<MediaAnalysisProgress>? progress, CancellationToken ct)
    {
        if (!File.Exists(filePath)) throw new FileNotFoundException("媒体文件不存在。", filePath);
        progress?.Report(new(0, "打开媒体", Path.GetFileName(filePath)));

        try
        {
            using var reader = new MediaFoundationReader(filePath);
            var duration = reader.TotalTime;
            var sampleProvider = reader.ToSampleProvider();
            var format = sampleProvider.WaveFormat;
            var sampleRate = format.SampleRate;
            var channels = Math.Max(1, format.Channels);
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
                var read = sampleProvider.Read(buffer, 0, buffer.Length);
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
                        bucketFrames = 0; bucketSquares = 0; bucketPeak = 0;
                    }
                }

                var percent = (int)Math.Clamp(framesRead * 100L / totalFrames, 0, 99);
                if (percent >= lastPercent + 2)
                {
                    progress?.Report(new(percent, "解析音轨", $"{TimeSpan.FromSeconds(framesRead / (double)sampleRate):hh\:mm\:ss} / {duration:hh\:mm\:ss}"));
                    lastPercent = percent;
                }
            }

            if (bucketFrames > 0)
            {
                var rms = (float)Math.Sqrt(bucketSquares / Math.Max(1, bucketFrames));
                points.Add(Math.Clamp(rms * 0.72f + bucketPeak * 0.28f, 0f, 1f));
            }

            progress?.Report(new(100, "完成", $"已生成 {points.Count} 个波形点"));
            return new MediaAnalysisResult(filePath, duration, sampleRate, channels, points.ToArray(), secondsPerPoint);
        }
        catch (COMException ex)
        {
            throw new NotSupportedException("Windows Media Foundation 无法解析这个媒体文件。当前第一版优先支持系统可解码的 MP4/MOV/M4A/WMA 等格式；MKV/特殊编码将在下一步加入 FFmpeg fallback。", ex);
        }
        catch (InvalidOperationException ex)
        {
            throw new NotSupportedException("无法打开媒体音轨。当前第一版使用 Windows Media Foundation 以避免额外下载大型媒体运行库，后续会为不支持的容器自动接 FFmpeg fallback。", ex);
        }
    }
}
