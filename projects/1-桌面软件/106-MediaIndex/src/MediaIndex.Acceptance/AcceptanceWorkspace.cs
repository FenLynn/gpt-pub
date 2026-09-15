using System.Text;
using System.Text.Json;

namespace MediaIndex.Acceptance;

internal sealed class AcceptanceWorkspace
{
    private const string StateFileName = "acceptance.workspace.json";

    public AcceptanceWorkspace(string root)
    {
        Root = Path.GetFullPath(root);
        ResultsDirectory = Path.Combine(Root, "Results");
        StatePath = Path.Combine(Root, StateFileName);
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(ResultsDirectory);
    }

    public string Root { get; }
    public string ResultsDirectory { get; }
    public string StatePath { get; }
    public string ImageManifestPath => Path.Combine(Root, "image_manifest.csv");
    public string VideoManifestPath => Path.Combine(Root, "video_manifest.csv");
    public string ImageResultPath => Path.Combine(ResultsDirectory, "a004_results.json");
    public string VideoResultPath => Path.Combine(ResultsDirectory, "v011_results.json");
    public string SummaryResultPath => Path.Combine(ResultsDirectory, "real_domain_summary.json");

    public AcceptanceWorkspaceState Load()
    {
        if (!File.Exists(StatePath))
        {
            return new AcceptanceWorkspaceState();
        }

        try
        {
            return JsonSerializer.Deserialize<AcceptanceWorkspaceState>(
                File.ReadAllText(StatePath, Encoding.UTF8),
                JsonOptions()) ?? new AcceptanceWorkspaceState();
        }
        catch
        {
            return new AcceptanceWorkspaceState();
        }
    }

    public void Save(AcceptanceWorkspaceState state)
    {
        File.WriteAllText(
            StatePath,
            JsonSerializer.Serialize(state, JsonOptions()),
            new UTF8Encoding(false));
    }

    public void WriteManifests(AcceptanceWorkspaceState state)
    {
        WriteImageManifest(state);
        WriteVideoManifest(state);
    }

    private void WriteImageManifest(AcceptanceWorkspaceState state)
    {
        var lines = new List<string>
        {
            "query,expected_source,relation"
        };

        foreach (var query in state.Queries.Where(q => q.Kind == QueryMediaKind.Image))
        {
            var expected = MakeRelativeIfPossible(
                query.ExpectedSourcePath,
                state.ImageLibraryPath);

            lines.Add(string.Join(",",
                Csv(query.QueryPath),
                Csv(expected),
                Csv(query.Relation)));
        }

        File.WriteAllLines(ImageManifestPath, lines, new UTF8Encoding(true));
    }

    private void WriteVideoManifest(AcceptanceWorkspaceState state)
    {
        var lines = new List<string>
        {
            "query,expected_source,relation,expected_start_sec"
        };

        foreach (var query in state.Queries.Where(q => q.Kind == QueryMediaKind.Video))
        {
            var expected = MakeRelativeIfPossible(
                query.ExpectedSourcePath,
                state.VideoLibraryPath);

            lines.Add(string.Join(",",
                Csv(query.QueryPath),
                Csv(expected),
                Csv(query.Relation),
                Csv(query.ExpectedStartSeconds?.ToString(
                    System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty)));
        }

        File.WriteAllLines(VideoManifestPath, lines, new UTF8Encoding(true));
    }

    private static string MakeRelativeIfPossible(string path, string root)
    {
        if (string.IsNullOrWhiteSpace(path) || string.IsNullOrWhiteSpace(root))
        {
            return path ?? string.Empty;
        }

        try
        {
            var fullPath = Path.GetFullPath(path);
            var fullRoot = Path.GetFullPath(root);
            var relative = Path.GetRelativePath(fullRoot, fullPath);

            if (!relative.StartsWith("..", StringComparison.Ordinal))
            {
                return relative.Replace('\', '/');
            }
        }
        catch
        {
        }

        return path;
    }

    private static string Csv(string value)
    {
        value ??= string.Empty;
        if (value.Contains('"'))
        {
            value = value.Replace(""", """");
        }

        return value.IndexOfAny([',', '"', '\r', '\n']) >= 0
            ? $""{value}""
            : value;
    }

    private static JsonSerializerOptions JsonOptions() => new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
        Converters =
        {
            new JsonStringEnumConverter()
        }
    };
}
