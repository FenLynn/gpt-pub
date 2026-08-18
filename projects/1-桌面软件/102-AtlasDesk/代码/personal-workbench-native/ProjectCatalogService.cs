namespace PersonalWorkbench;

[Flags]
public enum ProjectKind
{
    None = 0,
    Git = 1,
    Python = 2,
    Node = 4,
    DotNet = 8,
    Latex = 16,
    Rust = 32,
    Go = 64
}

public sealed class ProjectDescriptor
{
    public string Name { get; init; } = string.Empty;
    public string RootPath { get; init; } = string.Empty;
    public string RelativePath { get; init; } = string.Empty;
    public ProjectKind Kind { get; init; }
    public string GitBranch { get; init; } = string.Empty;
    public DateTime LastModified { get; init; }
    public string MarkerSummary { get; init; } = string.Empty;
    public bool IsPinned { get; set; }
    public bool IsRecent { get; set; }
    public int RecentOrder { get; set; } = int.MaxValue;
    public bool IsMissing { get; init; }

    public string KindLabel
    {
        get
        {
            if (IsMissing) return "路径失效";
            var labels = new List<string>();
            if (Kind.HasFlag(ProjectKind.Git)) labels.Add("Git");
            if (Kind.HasFlag(ProjectKind.Python)) labels.Add("Python");
            if (Kind.HasFlag(ProjectKind.Node)) labels.Add("Node");
            if (Kind.HasFlag(ProjectKind.DotNet)) labels.Add(".NET");
            if (Kind.HasFlag(ProjectKind.Latex)) labels.Add("LaTeX");
            if (Kind.HasFlag(ProjectKind.Rust)) labels.Add("Rust");
            if (Kind.HasFlag(ProjectKind.Go)) labels.Add("Go");
            return labels.Count == 0 ? "普通目录" : string.Join(" · ", labels);
        }
    }

    public string BranchLabel => string.IsNullOrWhiteSpace(GitBranch) ? string.Empty : "分支 " + GitBranch;
    public string ModifiedLabel => LastModified == default ? string.Empty : LastModified.ToString("yyyy-MM-dd HH:mm");
    public string UsageLabel => IsMissing ? "需重新定位" : IsPinned ? "★ 收藏" : IsRecent ? "最近" : string.Empty;
}

public static class ProjectCatalogService
{
    private static readonly HashSet<string> IgnoredDirectories = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git", ".idea", ".vs", ".vscode", "node_modules", "bin", "obj", "dist", "build",
        "__pycache__", ".venv", "venv", "env", "target", ".pytest_cache", ".mypy_cache"
    };

    public static IReadOnlyList<ProjectDescriptor> Scan(
        string root,
        int maxDepth = 2,
        int maxProjects = 250,
        CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(root)) return Array.Empty<ProjectDescriptor>();
        root = Path.GetFullPath(root);
        maxDepth = Math.Clamp(maxDepth, 0, 5);
        maxProjects = Math.Clamp(maxProjects, 1, 2000);

        var projects = new List<ProjectDescriptor>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var queue = new Queue<(string Path, int Depth)>();
        queue.Enqueue((root, 0));

        while (queue.Count > 0 && projects.Count < maxProjects)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var (directory, depth) = queue.Dequeue();
            string normalized;
            try { normalized = Path.GetFullPath(directory); }
            catch { continue; }
            if (!visited.Add(normalized)) continue;

            var descriptor = Detect(normalized, root);
            if (descriptor is not null) projects.Add(descriptor);
            if (depth >= maxDepth) continue;

            try
            {
                foreach (var child in Directory.EnumerateDirectories(normalized))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var name = Path.GetFileName(child);
                    if (IgnoredDirectories.Contains(name) || name.StartsWith(".", StringComparison.Ordinal)) continue;
                    try
                    {
                        if ((File.GetAttributes(child) & FileAttributes.ReparsePoint) != 0) continue;
                    }
                    catch { continue; }
                    queue.Enqueue((child, depth + 1));
                }
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex) { App.Log("Project scan directory failed: " + ex.Message); }
        }

        cancellationToken.ThrowIfCancellationRequested();
        return projects
            .GroupBy(item => item.RootPath, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .OrderByDescending(item => item.LastModified)
            .ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToArray();
    }

    public static ProjectDescriptor? Detect(string directory, string catalogRoot)
    {
        if (!Directory.Exists(directory)) return null;
        try
        {
            var kind = ProjectKind.None;
            var markers = new List<string>();

            if (Directory.Exists(Path.Combine(directory, ".git")) || File.Exists(Path.Combine(directory, ".git")))
            {
                kind |= ProjectKind.Git;
                markers.Add(".git");
            }
            if (HasAny(directory, "pyproject.toml", "requirements.txt", "environment.yml", "environment.yaml", "setup.py", "Pipfile"))
            {
                kind |= ProjectKind.Python;
                markers.Add("Python");
            }
            if (File.Exists(Path.Combine(directory, "package.json")))
            {
                kind |= ProjectKind.Node;
                markers.Add("package.json");
            }
            if (Directory.EnumerateFiles(directory, "*.sln", SearchOption.TopDirectoryOnly).Any()
                || Directory.EnumerateFiles(directory, "*.csproj", SearchOption.TopDirectoryOnly).Any())
            {
                kind |= ProjectKind.DotNet;
                markers.Add(".NET");
            }
            if (File.Exists(Path.Combine(directory, "latexmkrc"))
                || Directory.EnumerateFiles(directory, "*.tex", SearchOption.TopDirectoryOnly).Any())
            {
                kind |= ProjectKind.Latex;
                markers.Add("LaTeX");
            }
            if (File.Exists(Path.Combine(directory, "Cargo.toml")))
            {
                kind |= ProjectKind.Rust;
                markers.Add("Cargo.toml");
            }
            if (File.Exists(Path.Combine(directory, "go.mod")))
            {
                kind |= ProjectKind.Go;
                markers.Add("go.mod");
            }
            if (kind == ProjectKind.None) return null;

            var full = Path.GetFullPath(directory);
            var relative = Path.GetRelativePath(Path.GetFullPath(catalogRoot), full);
            if (relative == ".") relative = "工作区根目录";
            return new ProjectDescriptor
            {
                Name = Path.GetFileName(full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)) is { Length: > 0 } name ? name : full,
                RootPath = full,
                RelativePath = relative,
                Kind = kind,
                GitBranch = kind.HasFlag(ProjectKind.Git) ? ReadGitBranch(full) : string.Empty,
                LastModified = Directory.GetLastWriteTime(full),
                MarkerSummary = string.Join(" · ", markers)
            };
        }
        catch (Exception ex)
        {
            App.Log("Project detection failed for " + directory + ": " + ex.Message);
            return null;
        }
    }

    public static string ReadGitBranch(string projectRoot)
    {
        try
        {
            var gitPath = Path.Combine(projectRoot, ".git");
            var gitDirectory = gitPath;
            if (File.Exists(gitPath))
            {
                var pointer = File.ReadAllText(gitPath).Trim();
                if (!pointer.StartsWith("gitdir:", StringComparison.OrdinalIgnoreCase)) return string.Empty;
                var target = pointer[7..].Trim();
                gitDirectory = Path.GetFullPath(Path.IsPathRooted(target) ? target : Path.Combine(projectRoot, target));
            }
            var headPath = Path.Combine(gitDirectory, "HEAD");
            if (!File.Exists(headPath)) return string.Empty;
            var head = File.ReadAllText(headPath).Trim();
            const string prefix = "ref: refs/heads/";
            return head.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ? head[prefix.Length..] : head.Length >= 8 ? head[..8] : head;
        }
        catch { return string.Empty; }
    }

    private static bool HasAny(string directory, params string[] names)
        => names.Any(name => File.Exists(Path.Combine(directory, name)));
}
