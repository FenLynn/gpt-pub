using System.Text.Json;

namespace MediaIndex.App;

internal sealed class AppSettings
{
    public string ImageLibraryPath { get; set; } = string.Empty;
}

internal sealed class IndexBuildResult
{
    public bool Ok { get; set; }
    public string LibraryRoot { get; set; } = string.Empty;
    public string IndexDir { get; set; } = string.Empty;
    public string IndexId { get; set; } = string.Empty;
    public int Images { get; set; }
    public int Added { get; set; }
    public int Updated { get; set; }
    public int Reused { get; set; }
    public int Removed { get; set; }
    public int Failed { get; set; }
    public double Seconds { get; set; }
    public long MatrixBytes { get; set; }
}

internal sealed class QueryResult
{
    public bool Ok { get; set; }
    public string Query { get; set; } = string.Empty;
    public string LibraryRoot { get; set; } = string.Empty;
    public string IndexDir { get; set; } = string.Empty;
    public int IndexedImages { get; set; }
    public string RankingMode { get; set; } = string.Empty;
    public double CandidateMs { get; set; }
    public double TotalMs { get; set; }
    public List<QueryHit> Results { get; set; } = new();
}

internal sealed class QueryHit
{
    public int Rank { get; set; }
    public string Confidence { get; set; } = string.Empty;
    public string Relpath { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public bool Online { get; set; }
    public bool Exact { get; set; }
    public int PhashDistance { get; set; }
    public double Inliers { get; set; }
    public double Ratio { get; set; }
    public double Ncc { get; set; }
    public double? TemplateScore { get; set; }
    public double VerificationScore { get; set; }
}

internal static class JsonModel
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true
    };
}
