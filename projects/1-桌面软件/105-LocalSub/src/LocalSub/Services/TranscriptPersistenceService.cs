using System.Text.Json;
using LocalSub.Models;

namespace LocalSub.Services;

public static class TranscriptPersistenceService
{
    public static void SaveJson(string path, string sourceFile, string modelId, TimeSpan duration, TimeSpan processingTime, IEnumerable<TranscriptItem> items)
    {
        var ordered = items.OrderBy(x => x.Start).ToArray();
        var payload = new
        {
            format = "LocalSub transcript",
            version = 1,
            source = sourceFile,
            model = modelId,
            durationSeconds = Math.Round(duration.TotalSeconds, 3),
            processingSeconds = Math.Round(processingTime.TotalSeconds, 3),
            realTimeFactor = duration.TotalSeconds > 0 ? Math.Round(processingTime.TotalSeconds / duration.TotalSeconds, 4) : 0,
            createdAt = DateTimeOffset.Now,
            segments = ordered.Select(x => new
            {
                start = Math.Round(x.Start.TotalSeconds, 3),
                end = Math.Round(x.End.TotalSeconds, 3),
                text = x.Text,
                keywords = x.Keywords
            })
        };

        var parent = Path.GetDirectoryName(path);
        if (!string.IsNullOrWhiteSpace(parent)) Directory.CreateDirectory(parent);
        var temp = path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(temp, path, true);
    }

    public static void ExportTxt(string path, IEnumerable<TranscriptItem> items, bool includeTime = true)
    {
        using var sw = new StreamWriter(path, false, new System.Text.UTF8Encoding(true));
        foreach (var item in items.OrderBy(x => x.Start))
        {
            if (includeTime) sw.WriteLine($"[{FormatTime(item.Start)} - {FormatTime(item.End)}] {item.Text}");
            else sw.WriteLine(item.Text);
        }
    }

    static string FormatTime(TimeSpan t)
        => t.TotalHours >= 1 ? t.ToString(@"hh\:mm\:ss\.fff") : t.ToString(@"mm\:ss\.fff");
}
