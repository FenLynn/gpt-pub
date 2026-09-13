using System.Text.Json;
using LocalSub.Core;
using LocalSub.Models;
using LocalSub.Services;

namespace LocalSub.UI;

internal sealed record PersistedTranscriptItem(long StartMs, long EndMs, string Text, string[] Keywords);
internal sealed record PersistedBatchResult(
    long DurationMs,
    long ProcessingMs,
    string DecoderName,
    PersistedTranscriptItem[] Items);
internal sealed record PersistedBatchQueueItem(
    string Id,
    string Path,
    string Name,
    string State,
    PersistedBatchResult? Result);
internal sealed record PersistedBatchQueueState(
    int Version,
    string? SelectedId,
    PersistedBatchQueueItem[] Queue);

internal static class BatchQueueStateStore
{
    static readonly JsonSerializerOptions Options = new() { WriteIndented = true };
    internal static string StatePath => Path.Combine(PortablePaths.DataDir, "Batch", "queue-state.json");

    internal static PersistedBatchQueueState Load()
    {
        try
        {
            if (!File.Exists(StatePath)) return new(1, null, []);
            return JsonSerializer.Deserialize<PersistedBatchQueueState>(File.ReadAllText(StatePath), Options)
                ?? new(1, null, []);
        }
        catch
        {
            return new(1, null, []);
        }
    }

    internal static void Save(string? selectedId, IEnumerable<(string Id, string Path, string Name, string State, BatchTranscriptionResult? Result)> queue)
    {
        var payload = new PersistedBatchQueueState(
            1,
            selectedId,
            queue.Select(x => new PersistedBatchQueueItem(
                x.Id,
                x.Path,
                x.Name,
                x.State,
                x.Result == null ? null : new PersistedBatchResult(
                    (long)Math.Round(x.Result.Duration.TotalMilliseconds),
                    (long)Math.Round(x.Result.ProcessingTime.TotalMilliseconds),
                    x.Result.DecoderName,
                    x.Result.Items.Select(item => new PersistedTranscriptItem(
                        (long)Math.Round(item.Start.TotalMilliseconds),
                        (long)Math.Round(item.End.TotalMilliseconds),
                        item.Text,
                        item.Keywords.ToArray())).ToArray()))).ToArray());

        var parent = Path.GetDirectoryName(StatePath)!;
        Directory.CreateDirectory(parent);
        var temp = StatePath + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(payload, Options));
        File.Move(temp, StatePath, true);
    }

    internal static BatchTranscriptionResult ToResult(string filePath, PersistedBatchResult result)
        => new(
            filePath,
            TimeSpan.FromMilliseconds(Math.Max(0, result.DurationMs)),
            result.Items.Select(x => new TranscriptItem
            {
                Start = TimeSpan.FromMilliseconds(Math.Max(0, x.StartMs)),
                End = TimeSpan.FromMilliseconds(Math.Max(x.StartMs, x.EndMs)),
                Text = x.Text ?? "",
                Keywords = x.Keywords?.Where(k => !string.IsNullOrWhiteSpace(k)).ToList() ?? []
            }).ToArray(),
            TimeSpan.FromMilliseconds(Math.Max(0, result.ProcessingMs)),
            result.DecoderName ?? "已恢复");
}
