namespace PersonalWorkbench;

public static class ProjectUsageService
{
    public static void ApplyUsage(IList<ProjectDescriptor> projects, AppSettings settings)
    {
        ArgumentNullException.ThrowIfNull(projects);
        ArgumentNullException.ThrowIfNull(settings);

        var pinned = new HashSet<string>(settings.PinnedProjectPaths, StringComparer.OrdinalIgnoreCase);
        var recentOrder = settings.RecentProjectPaths
            .Select((path, index) => new { Path = path, Index = index })
            .ToDictionary(item => item.Path, item => item.Index, StringComparer.OrdinalIgnoreCase);

        foreach (var project in projects)
        {
            project.IsPinned = pinned.Contains(project.RootPath);
            project.IsRecent = recentOrder.ContainsKey(project.RootPath);
            project.RecentOrder = recentOrder.TryGetValue(project.RootPath, out var index) ? index : int.MaxValue;
        }
    }

    public static IReadOnlyList<ProjectDescriptor> BuildMissingSavedProjects(
        AppSettings settings,
        string workspaceRoot,
        IEnumerable<string> discoveredPaths)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var discovered = new HashSet<string>(discoveredPaths, StringComparer.OrdinalIgnoreCase);
        var saved = settings.PinnedProjectPaths
            .Concat(settings.RecentProjectPaths)
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Distinct(StringComparer.OrdinalIgnoreCase);
        var result = new List<ProjectDescriptor>();

        foreach (var path in saved)
        {
            if (discovered.Contains(path) || Directory.Exists(path))
                continue;

            string full;
            try { full = Path.GetFullPath(path); }
            catch { continue; }
            var name = Path.GetFileName(full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            var relative = TryRelative(workspaceRoot, full);
            result.Add(new ProjectDescriptor
            {
                Name = string.IsNullOrWhiteSpace(name) ? full : name,
                RootPath = full,
                RelativePath = relative,
                IsMissing = true
            });
        }

        ApplyUsage(result, settings);
        return result;
    }

    public static void TogglePinned(AppSettings settings, string projectPath)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var full = Normalize(projectPath);
        if (string.IsNullOrWhiteSpace(full))
            return;

        var paths = settings.PinnedProjectPaths
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var index = paths.FindIndex(path => string.Equals(path, full, StringComparison.OrdinalIgnoreCase));
        if (index >= 0)
            paths.RemoveAt(index);
        else
            paths.Insert(0, full);
        settings.PinnedProjectPaths = paths;
        settings.Save();
    }

    public static void RecordOpened(AppSettings settings, string projectPath)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var full = Normalize(projectPath);
        if (string.IsNullOrWhiteSpace(full))
            return;

        var recent = settings.RecentProjectPaths
            .Where(path => !string.IsNullOrWhiteSpace(path)
                           && !string.Equals(path, full, StringComparison.OrdinalIgnoreCase))
            .ToList();
        recent.Insert(0, full);
        settings.RecentProjectPaths = recent.Take(settings.ProjectRecentLimit).ToList();
        settings.Save();
    }

    public static void Relocate(AppSettings settings, string oldPath, string newPath)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var oldFull = Normalize(oldPath);
        var newFull = Normalize(newPath);
        if (string.IsNullOrWhiteSpace(oldFull) || string.IsNullOrWhiteSpace(newFull))
            return;

        settings.PinnedProjectPaths = Replace(settings.PinnedProjectPaths, oldFull, newFull);
        settings.RecentProjectPaths = Replace(settings.RecentProjectPaths, oldFull, newFull)
            .Take(settings.ProjectRecentLimit)
            .ToList();
        settings.Save();
    }

    private static List<string> Replace(IEnumerable<string> source, string oldPath, string newPath)
    {
        return source
            .Select(path => string.Equals(Normalize(path), oldPath, StringComparison.OrdinalIgnoreCase) ? newPath : Normalize(path))
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string Normalize(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return string.Empty;
        try { return Path.GetFullPath(path.Trim()); }
        catch { return string.Empty; }
    }

    private static string TryRelative(string workspaceRoot, string path)
    {
        try
        {
            return Directory.Exists(workspaceRoot)
                ? Path.GetRelativePath(Path.GetFullPath(workspaceRoot), path)
                : path;
        }
        catch { return path; }
    }
}
