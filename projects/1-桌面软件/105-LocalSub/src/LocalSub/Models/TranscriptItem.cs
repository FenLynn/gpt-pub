namespace LocalSub.Models;

public sealed class TranscriptItem
{
    public TimeSpan Start { get; set; }
    public TimeSpan End { get; set; }
    public string Text { get; set; } = "";
    public List<string> Keywords { get; set; } = [];
}
