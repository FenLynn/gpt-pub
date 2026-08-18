using LocalSub.Models;

namespace LocalSub.Services;

public sealed record BatchTranscriptionProgress(int Percent, string Stage, string Detail, int CompletedSegments = 0);
public sealed record BatchTranscriptionResult(string FilePath, TimeSpan Duration, IReadOnlyList<TranscriptItem> Items, TimeSpan ProcessingTime, string DecoderName)
{
    public double RealTimeFactor => Duration.TotalSeconds > 0 ? ProcessingTime.TotalSeconds / Duration.TotalSeconds : 0;
}

/// <summary>
/// Shell-side proxy. The real implementation is compiled only into LocalSub.Core.exe.
/// This keeps model loading, VAD, media decoding and offline ASR out of the GUI process.
/// </summary>
public sealed class BatchTranscriptionService
{
    public Task<BatchTranscriptionResult> TranscribeAsync(
        string filePath,
        AppSettings settings,
        ModelDescriptor model,
        ModelManager models,
        IEnumerable<string> keywords,
        IProgress<BatchTranscriptionProgress>? progress = null,
        IProgress<ModelOperationProgress>? runtimeProgress = null,
        CancellationToken ct = default)
    {
        if (!CoreWorkerBroker.IsAvailable)
            throw new FileNotFoundException("LocalSub.Core.exe 不存在，后台转写已按新架构要求禁用进程内回退。", Path.Combine(AppContext.BaseDirectory, "LocalSub.Core.exe"));
        return CoreWorkerBroker.Shared.TranscribeAsync(filePath, model.Id, keywords, progress, runtimeProgress, ct);
    }
}
