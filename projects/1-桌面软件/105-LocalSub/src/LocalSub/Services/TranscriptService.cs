using LocalSub.Models;

namespace LocalSub.Services;

public sealed class TranscriptService
{
    public List<TranscriptItem> Items { get; } = [];
    public void Add(TranscriptItem item, IEnumerable<string> keywords)
    {
        item.Keywords = keywords.Where(k => !string.IsNullOrWhiteSpace(k) && item.Text.Contains(k.Trim(), StringComparison.OrdinalIgnoreCase)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        Items.Add(item);
    }
    public void ExportTxt(string path, bool includeTime = true)
    {
        using var sw = new StreamWriter(path, false, new System.Text.UTF8Encoding(true));
        foreach (var item in Items) sw.WriteLine(includeTime ? $"[{item.Start:hh\\:mm\\:ss}] {item.Text}" : item.Text);
    }
}
