using System.IO;
using System.Text.Json;

namespace PersonalWorkbench;

public sealed class ProductivityContextState
{
    public int SchemaVersion { get; set; } = 1;
    public bool RestoreLastSession { get; set; } = true;
    public ProductivitySessionSnapshot Session { get; set; } = new();
    public List<ProjectContextProfile> Projects { get; set; } = new();
}

public sealed class ProductivitySessionSnapshot
{
    public string LastView { get; set; } = "home";
    public string WorkspacePath { get; set; } = string.Empty;
    public string ProjectRoot { get; set; } = string.Empty;
    public string ZoteroQuery { get; set; } = string.Empty;
    public DateTime SavedAtUtc { get; set; }
}

public sealed class ProjectContextProfile
{
    public string ProjectRoot { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string DefaultShell { get; set; } = "powershell";
    public string PythonEnvironment { get; set; } = string.Empty;
    public string DashboardUrl { get; set; } = string.Empty;
    public List<ProjectContextCommand> Commands { get; set; } = new();
    public List<string> FavoriteFiles { get; set; } = new();
    public List<ProjectResearchLink> ResearchLinks { get; set; } = new();
    public DateTime UpdatedUtc { get; set; }

    public string EffectiveName => !string.IsNullOrWhiteSpace(DisplayName)
        ? DisplayName
        : Path.GetFileName(ProjectRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
}

public sealed class ProjectContextCommand
{
    public string Name { get; set; } = string.Empty;
    public string Command { get; set; } = string.Empty;
    public string WorkingDirectory { get; set; } = string.Empty;
}

public sealed class ProjectResearchLink
{
    public long ItemId { get; set; }
    public string ItemKey { get; set; } = string.Empty;
    public string CitationKey { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Doi { get; set; } = string.Empty;
    public string PdfPath { get; set; } = string.Empty;
    public DateTime LinkedUtc { get; set; }
}

public sealed record ProjectContextCommandInvocation(ProjectContextProfile Profile, ProjectContextCommand Command);
public sealed record ProjectContextFavoriteInvocation(ProjectContextProfile Profile, string Path);
public sealed record ProjectResearchInvocation(ProjectContextProfile Profile, ProjectResearchLink Link);

public static class ProductivityContextStore
{
    private static readonly object Sync = new();
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    public static string StatePath => Path.Combine(App.AppDataDirectory, "productivity-context.json");
    public static string BackupPath => StatePath + ".bak";

    public static ProductivityContextState Load()
    {
        lock (Sync)
        {
            try
            {
                Directory.CreateDirectory(App.AppDataDirectory);
                var state = LoadFile(StatePath) ?? LoadFile(BackupPath) ?? new ProductivityContextState();
                Normalize(state);
                return state;
            }
            catch (Exception ex)
            {
                App.Log("Load productivity context failed: " + ex);
                return new ProductivityContextState();
            }
        }
    }

    public static void Save(ProductivityContextState state)
    {
        ArgumentNullException.ThrowIfNull(state);
        lock (Sync)
        {
            try
            {
                Normalize(state);
                Directory.CreateDirectory(App.AppDataDirectory);
                var temporary = StatePath + ".tmp";
                File.WriteAllText(temporary, JsonSerializer.Serialize(state, JsonOptions));
                if (File.Exists(StatePath))
                    File.Copy(StatePath, BackupPath, overwrite: true);
                File.Move(temporary, StatePath, overwrite: true);
            }
            catch (Exception ex)
            {
                App.Log("Save productivity context failed: " + ex);
            }
        }
    }

    public static ProjectContextProfile GetOrCreateProfile(ProductivityContextState state, string projectRoot)
    {
        ArgumentNullException.ThrowIfNull(state);
        var normalized = NormalizePath(projectRoot);
        var profile = state.Projects.FirstOrDefault(item => PathsEqual(item.ProjectRoot, normalized));
        if (profile is not null)
            return profile;

        profile = new ProjectContextProfile
        {
            ProjectRoot = normalized,
            DisplayName = Path.GetFileName(normalized.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)),
            UpdatedUtc = DateTime.UtcNow
        };
        state.Projects.Add(profile);
        return profile;
    }

    public static ProjectContextProfile? FindProfile(ProductivityContextState state, string? projectRoot)
    {
        if (string.IsNullOrWhiteSpace(projectRoot))
            return null;
        return state.Projects.FirstOrDefault(item => PathsEqual(item.ProjectRoot, projectRoot));
    }

    public static string ResolveCurrentProjectRoot(ProductivityContextState state, AppSettings settings)
    {
        if (Directory.Exists(state.Session.ProjectRoot))
            return state.Session.ProjectRoot;
        if (Directory.Exists(settings.WorkspaceRoot))
            return settings.WorkspaceRoot;
        return state.Projects.FirstOrDefault(item => Directory.Exists(item.ProjectRoot))?.ProjectRoot ?? string.Empty;
    }

    public static IReadOnlyList<GlobalSearchResult> BuildSearchResults(AppSettings settings, string? query)
    {
        var state = Load();
        var text = query?.Trim() ?? string.Empty;
        var hasQuery = text.Length > 0;
        var results = new List<GlobalSearchResult>();
        var currentRoot = ResolveCurrentProjectRoot(state, settings);
        var currentProfile = FindProfile(state, currentRoot);

        AddIfMatch(results, Command(
            "编辑当前项目上下文",
            string.IsNullOrWhiteSpace(currentRoot) ? "选择项目后配置终端、环境、命令、常用文件和关联文献" : currentRoot,
            "context-edit-current",
            currentRoot), text);
        AddIfMatch(results, Command(
            state.RestoreLastSession ? "关闭工作会话恢复" : "开启工作会话恢复",
            "只恢复页面、项目、文件位置与检索上下文，不重新执行终端命令",
            "context-toggle-restore",
            string.Empty), text);
        AddIfMatch(results, Command(
            "恢复上次工作会话",
            BuildSessionSubtitle(state.Session),
            "context-restore-session",
            string.Empty), text);

        if (currentProfile is not null)
        {
            AddIfMatch(results, Project(
                "打开当前项目",
                currentProfile.ProjectRoot,
                "context-open-project",
                currentProfile.ProjectRoot,
                currentProfile), text);
            AddIfMatch(results, Command(
                "在当前项目打开终端",
                currentProfile.DefaultShell + " · " + currentProfile.ProjectRoot,
                "context-run-command",
                currentProfile.ProjectRoot,
                new ProjectContextCommandInvocation(
                    currentProfile,
                    new ProjectContextCommand
                    {
                        Name = currentProfile.EffectiveName,
                        Command = "cd .",
                        WorkingDirectory = currentProfile.ProjectRoot
                    })), text);
            if (Uri.TryCreate(currentProfile.DashboardUrl, UriKind.Absolute, out _))
            {
                AddIfMatch(results, Command(
                    "打开当前项目 Dashboard",
                    currentProfile.DashboardUrl,
                    "context-open-dashboard",
                    currentProfile.DashboardUrl,
                    currentProfile), text);
            }
        }

        var validProfiles = state.Projects
            .Where(item => Directory.Exists(item.ProjectRoot))
            .OrderByDescending(item => PathsEqual(item.ProjectRoot, currentRoot))
            .ThenByDescending(item => item.UpdatedUtc);
        var visibleProfiles = hasQuery
            ? validProfiles.Take(20)
            : currentProfile is not null
                ? validProfiles.Where(item => PathsEqual(item.ProjectRoot, currentProfile.ProjectRoot)).Take(1)
                : validProfiles.Take(4);
        var commandLimit = hasQuery ? 12 : 5;
        var favoriteLimit = hasQuery ? 12 : 5;
        var researchLimit = hasQuery ? 20 : 5;

        foreach (var profile in visibleProfiles)
        {
            AddIfMatch(results, Project(
                profile.EffectiveName,
                "项目上下文 · " + profile.ProjectRoot,
                "context-open-project",
                profile.ProjectRoot,
                profile), text);

            foreach (var command in profile.Commands
                         .Where(item => !string.IsNullOrWhiteSpace(item.Command))
                         .Take(commandLimit))
            {
                AddIfMatch(results, Command(
                    command.Name.Length > 0 ? command.Name : command.Command,
                    profile.EffectiveName + " · " + command.Command,
                    "context-run-command",
                    profile.ProjectRoot,
                    new ProjectContextCommandInvocation(profile, command)), text);
            }

            foreach (var favorite in profile.FavoriteFiles
                         .Where(path => File.Exists(path) || Directory.Exists(path))
                         .Take(favoriteLimit))
            {
                AddIfMatch(results, new GlobalSearchResult
                {
                    Kind = GlobalSearchResultKind.Workspace,
                    Category = "项目常用",
                    Title = Path.GetFileName(favorite),
                    Subtitle = profile.EffectiveName + " · " + favorite,
                    Hint = "在工作区打开",
                    Action = "context-open-favorite",
                    Target = favorite,
                    Payload = new ProjectContextFavoriteInvocation(profile, favorite)
                }, text);
            }

            foreach (var link in profile.ResearchLinks.Take(researchLimit))
            {
                AddIfMatch(results, new GlobalSearchResult
                {
                    Kind = GlobalSearchResultKind.Zotero,
                    Category = "项目文献",
                    Title = link.Title,
                    Subtitle = string.Join(" · ", new[] { profile.EffectiveName, link.CitationKey, link.Doi }
                        .Where(value => !string.IsNullOrWhiteSpace(value))),
                    Hint = File.Exists(link.PdfPath) ? "定位 / PDF" : "在 Zotero 中定位",
                    Action = "context-open-research",
                    Target = link.Title,
                    Payload = new ProjectResearchInvocation(profile, link)
                }, text);
            }
        }

        return results
            .GroupBy(item => item.Action + "|" + item.Target + "|" + item.Title, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Take(50)
            .ToArray();
    }

    private static ProductivityContextState? LoadFile(string path)
    {
        if (!File.Exists(path))
            return null;
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<ProductivityContextState>(json, JsonOptions);
    }

    private static void Normalize(ProductivityContextState state)
    {
        state.SchemaVersion = 1;
        state.Session ??= new ProductivitySessionSnapshot();
        state.Projects ??= new List<ProjectContextProfile>();
        state.Projects = state.Projects
            .Where(item => item is not null && !string.IsNullOrWhiteSpace(item.ProjectRoot))
            .GroupBy(item => NormalizePath(item.ProjectRoot), StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderByDescending(item => item.UpdatedUtc).First())
            .ToList();

        foreach (var profile in state.Projects)
        {
            profile.ProjectRoot = NormalizePath(profile.ProjectRoot);
            profile.DisplayName = profile.DisplayName?.Trim() ?? string.Empty;
            profile.DefaultShell = string.Equals(profile.DefaultShell, "cmd", StringComparison.OrdinalIgnoreCase)
                ? "cmd"
                : "powershell";
            profile.PythonEnvironment = profile.PythonEnvironment?.Trim() ?? string.Empty;
            profile.DashboardUrl = profile.DashboardUrl?.Trim() ?? string.Empty;
            profile.Commands ??= new List<ProjectContextCommand>();
            profile.Commands = profile.Commands
                .Where(item => item is not null && !string.IsNullOrWhiteSpace(item.Command))
                .Select(item => new ProjectContextCommand
                {
                    Name = item.Name?.Trim() ?? string.Empty,
                    Command = item.Command.Trim(),
                    WorkingDirectory = item.WorkingDirectory?.Trim() ?? string.Empty
                })
                .Take(40)
                .ToList();
            profile.FavoriteFiles ??= new List<string>();
            profile.FavoriteFiles = profile.FavoriteFiles
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Select(NormalizePath)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(80)
                .ToList();
            profile.ResearchLinks ??= new List<ProjectResearchLink>();
            profile.ResearchLinks = profile.ResearchLinks
                .Where(item => item is not null && !string.IsNullOrWhiteSpace(item.Title))
                .GroupBy(item => item.ItemId > 0 ? "id:" + item.ItemId : "key:" + item.ItemKey + "|" + item.Title,
                    StringComparer.OrdinalIgnoreCase)
                .Select(group => group.OrderByDescending(item => item.LinkedUtc).First())
                .Take(200)
                .ToList();
        }
    }

    private static string NormalizePath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return string.Empty;
        try { return Path.GetFullPath(path.Trim()); }
        catch { return path.Trim(); }
    }

    private static bool PathsEqual(string? left, string? right)
    {
        if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right))
            return false;
        return string.Equals(NormalizePath(left), NormalizePath(right), StringComparison.OrdinalIgnoreCase);
    }

    private static string BuildSessionSubtitle(ProductivitySessionSnapshot session)
    {
        var values = new[]
        {
            session.LastView,
            session.ProjectRoot,
            session.WorkspacePath,
            session.SavedAtUtc == default ? string.Empty : session.SavedAtUtc.ToLocalTime().ToString("MM-dd HH:mm")
        }.Where(value => !string.IsNullOrWhiteSpace(value));
        var subtitle = string.Join(" · ", values);
        return subtitle.Length > 0 ? subtitle : "尚无可恢复会话";
    }

    private static void AddIfMatch(ICollection<GlobalSearchResult> results, GlobalSearchResult item, string query)
    {
        if (string.IsNullOrWhiteSpace(query)
            || item.Title.Contains(query, StringComparison.CurrentCultureIgnoreCase)
            || item.Subtitle.Contains(query, StringComparison.CurrentCultureIgnoreCase)
            || item.Category.Contains(query, StringComparison.CurrentCultureIgnoreCase))
        {
            results.Add(item);
        }
    }

    private static GlobalSearchResult Command(string title, string subtitle, string action, string target, object? payload = null) => new()
    {
        Kind = GlobalSearchResultKind.Command,
        Category = "上下文",
        Title = title,
        Subtitle = subtitle,
        Hint = "执行",
        Action = action,
        Target = target,
        Payload = payload
    };

    private static GlobalSearchResult Project(string title, string subtitle, string action, string target, object? payload) => new()
    {
        Kind = GlobalSearchResultKind.Project,
        Category = "项目",
        Title = title,
        Subtitle = subtitle,
        Hint = "打开",
        Action = action,
        Target = target,
        Payload = payload
    };
}
