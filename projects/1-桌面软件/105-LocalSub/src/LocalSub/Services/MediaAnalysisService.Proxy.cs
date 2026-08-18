using LocalSub.Models;

namespace LocalSub.Services;

public sealed record MediaAnalysisProgress(int Percent, string Stage, string Detail);
public sealed record MediaAnalysisResult(string FilePath, TimeSpan Duration, int SampleRate, int Channels, float[] Waveform, double SecondsPerPoint, string DecoderName);

/// <summary>
/// Shell-side proxy. Media decoding and waveform extraction run in LocalSub.Core.exe.
/// </summary>
public sealed class MediaAnalysisService
{
    public Task<MediaAnalysisResult> AnalyzeAsync(
        string filePath,
        IProgress<MediaAnalysisProgress>? progress = null,
        CancellationToken ct = default)
        => AnalyzeAsync(filePath, AppSettings.Load(), progress, ct);

    public Task<MediaAnalysisResult> AnalyzeAsync(
        string filePath,
        AppSettings settings,
        IProgress<MediaAnalysisProgress>? progress = null,
        CancellationToken ct = default)
    {
        if (!CoreWorkerBroker.IsAvailable)
            throw new FileNotFoundException("LocalSub.Core.exe 不存在，媒体解析已按新架构要求禁用进程内回退。", Path.Combine(AppContext.BaseDirectory, "LocalSub.Core.exe"));
        return CoreWorkerBroker.Shared.AnalyzeAsync(filePath, progress, ct);
    }
}
