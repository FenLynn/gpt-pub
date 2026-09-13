using LocalSub.Models;
using LocalSub.Services;

namespace LocalSub.UI;

internal static class ProductizationSmoke
{
    internal static void Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "LocalSub", "ProductizationSmoke", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var media = Path.Combine(root, "demo.wav");
            File.WriteAllBytes(media, [0x52, 0x49, 0x46, 0x46]);
            var items = new[]
            {
                new TranscriptItem
                {
                    Start = TimeSpan.FromMilliseconds(1250),
                    End = TimeSpan.FromMilliseconds(3560),
                    Text = "第一句字幕",
                    Keywords = ["字幕"]
                },
                new TranscriptItem
                {
                    Start = TimeSpan.FromMilliseconds(4200),
                    End = TimeSpan.FromMilliseconds(7520),
                    Text = "Second subtitle line",
                    Keywords = []
                }
            };
            var result = new BatchTranscriptionResult(
                media,
                TimeSpan.FromSeconds(10),
                items,
                TimeSpan.FromSeconds(3.2),
                "SmokeDecoder");

            var txt = Path.Combine(root, "demo.txt");
            var srt = Path.Combine(root, "demo.srt");
            var vtt = Path.Combine(root, "demo.vtt");
            TranscriptPersistenceService.ExportTxt(txt, items);
            TranscriptPersistenceService.ExportSrt(srt, items);
            TranscriptPersistenceService.ExportVtt(vtt, items);

            var txtText = File.ReadAllText(txt);
            var srtText = File.ReadAllText(srt);
            var vttText = File.ReadAllText(vtt);
            if (!txtText.Contains("第一句字幕", StringComparison.Ordinal))
                throw new InvalidOperationException("TXT export smoke failed.");
            if (!srtText.Contains("00:00:01,250 --> 00:00:03,560", StringComparison.Ordinal) ||
                !srtText.Contains("Second subtitle line", StringComparison.Ordinal))
                throw new InvalidOperationException("SRT export smoke failed.");
            if (!vttText.StartsWith("WEBVTT", StringComparison.Ordinal) ||
                !vttText.Contains("00:00:04.200 --> 00:00:07.520", StringComparison.Ordinal))
                throw new InvalidOperationException("VTT export smoke failed.");

            var statePath = Path.Combine(root, "queue-state.json");
            BatchQueueStateStore.SaveTo(
                statePath,
                "done",
                new (string Id, string Path, string Name, string State, BatchTranscriptionResult? Result)[]
                {
                    ("done", media, "demo.wav", "完成 2 段", result),
                    ("interrupted", media, "pending.wav", "转写中", null)
                });
            var state = BatchQueueStateStore.LoadFrom(statePath);
            if (state.SelectedId != "done" || state.Queue.Length != 2)
                throw new InvalidOperationException("Queue persistence smoke failed.");
            var saved = state.Queue.FirstOrDefault(x => x.Id == "done")
                ?? throw new InvalidOperationException("Completed queue item was not persisted.");
            if (saved.Result == null)
                throw new InvalidOperationException("Completed transcript result was not persisted.");
            var restored = BatchQueueStateStore.ToResult(saved.Path, saved.Result);
            if (restored.Items.Count != 2 || restored.Items[0].Text != "第一句字幕")
                throw new InvalidOperationException("Completed transcript restore smoke failed.");
            var interrupted = state.Queue.FirstOrDefault(x => x.Id == "interrupted");
            if (interrupted?.State != "转写中" || interrupted.Result != null)
                throw new InvalidOperationException("Interrupted queue state smoke failed.");
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { }
        }
    }
}
