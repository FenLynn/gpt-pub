using System.Text.Json.Serialization;

namespace MediaIndex.Acceptance;

internal enum QueryMediaKind
{
    Image,
    Video
}

internal sealed class AcceptanceQuery
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public QueryMediaKind Kind { get; set; }
    public string QueryPath { get; set; } = string.Empty;
    public string ExpectedSourcePath { get; set; } = string.Empty;
    public string Relation { get; set; } = string.Empty;
    public double? ExpectedStartSeconds { get; set; }
    public bool IsLabeled { get; set; }

    [JsonIgnore]
    public string KindText => Kind == QueryMediaKind.Image ? "图片" : "视频";

    [JsonIgnore]
    public string QueryName => Path.GetFileName(QueryPath);

    [JsonIgnore]
    public string ExpectedName =>
        !IsLabeled
            ? "未设置"
            : string.IsNullOrWhiteSpace(ExpectedSourcePath)
                ? "无对应源"
                : Path.GetFileName(ExpectedSourcePath);
}

internal sealed class AcceptanceWorkspaceState
{
    public string ImageLibraryPath { get; set; } = string.Empty;
    public string VideoLibraryPath { get; set; } = string.Empty;
    public List<AcceptanceQuery> Queries { get; set; } = new();
}

internal sealed class AcceptanceSummary
{
    public JsonElement? Image { get; set; }
    public JsonElement? Video { get; set; }
    public bool PrivateMediaCommitted { get; set; }
    public string PhaseGate { get; set; } = string.Empty;
}
