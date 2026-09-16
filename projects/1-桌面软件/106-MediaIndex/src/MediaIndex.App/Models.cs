using System.Text.Json;
using System.Text.Json.Serialization;

namespace MediaIndex.App;

internal sealed class AppSettings
{
    public string ImageLibraryPath { get; set; } = string.Empty;
}

internal sealed class IndexBuildResult
{
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [JsonPropertyName("library_root")]
    public string LibraryRoot { get; set; } = string.Empty;

    [JsonPropertyName("index_dir")]
    public string IndexDir { get; set; } = string.Empty;

    [JsonPropertyName("index_id")]
    public string IndexId { get; set; } = string.Empty;

    [JsonPropertyName("images")]
    public int Images { get; set; }

    [JsonPropertyName("added")]
    public int Added { get; set; }

    [JsonPropertyName("updated")]
    public int Updated { get; set; }

    [JsonPropertyName("reused")]
    public int Reused { get; set; }

    [JsonPropertyName("removed")]
    public int Removed { get; set; }

    [JsonPropertyName("failed")]
    public int Failed { get; set; }

    [JsonPropertyName("seconds")]
    public double Seconds { get; set; }

    [JsonPropertyName("matrix_bytes")]
    public long MatrixBytes { get; set; }
}

internal sealed class QueryResult
{
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [JsonPropertyName("query")]
    public string Query { get; set; } = string.Empty;

    [JsonPropertyName("library_root")]
    public string LibraryRoot { get; set; } = string.Empty;

    [JsonPropertyName("index_dir")]
    public string IndexDir { get; set; } = string.Empty;

    [JsonPropertyName("indexed_images")]
    public int IndexedImages { get; set; }

    [JsonPropertyName("ranking_mode")]
    public string RankingMode { get; set; } = string.Empty;

    [JsonPropertyName("candidate_ms")]
    public double CandidateMs { get; set; }

    [JsonPropertyName("total_ms")]
    public double TotalMs { get; set; }

    [JsonPropertyName("results")]
    public List<QueryHit> Results { get; set; } = new();
}

internal sealed class QueryHit
{
    [JsonPropertyName("rank")]
    public int Rank { get; set; }

    [JsonPropertyName("confidence")]
    public string Confidence { get; set; } = string.Empty;

    [JsonPropertyName("relpath")]
    public string Relpath { get; set; } = string.Empty;

    [JsonPropertyName("path")]
    public string Path { get; set; } = string.Empty;

    [JsonPropertyName("online")]
    public bool Online { get; set; }

    [JsonPropertyName("exact")]
    public bool Exact { get; set; }

    [JsonPropertyName("phash_distance")]
    public int PhashDistance { get; set; }

    [JsonPropertyName("local_score")]
    public double LocalScore { get; set; }

    [JsonPropertyName("candidate_lane")]
    public string CandidateLane { get; set; } = string.Empty;

    [JsonPropertyName("inliers")]
    public double Inliers { get; set; }

    [JsonPropertyName("ratio")]
    public double Ratio { get; set; }

    [JsonPropertyName("ncc")]
    public double Ncc { get; set; }

    [JsonPropertyName("template_score")]
    public double? TemplateScore { get; set; }

    [JsonPropertyName("verification_score")]
    public double VerificationScore { get; set; }
}

internal static class JsonModel
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true
    };
}
