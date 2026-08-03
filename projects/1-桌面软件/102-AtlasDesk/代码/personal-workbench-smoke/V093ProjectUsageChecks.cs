using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V093ProjectUsageChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        RequireTokens(
            Path.Combine(nativeRoot, "AppSettings.cs"),
            "PinnedProjectPaths",
            "RecentProjectPaths",
            "ProjectRecentLimit",
            "NormalizePaths");
        RequireTokens(
            Path.Combine(nativeRoot, "ProjectUsageService.cs"),
            "BuildMissingSavedProjects",
            "TogglePinned",
            "RecordOpened",
            "Relocate",
            "Distinct(StringComparer.OrdinalIgnoreCase)");
        RequireTokens(
            Path.Combine(nativeRoot, "ProjectCenterControl.xaml.cs"),
            "UsageFilter",
            "IsMissing",
            "OpenFolderDialog",
            "ProjectCatalogService.Detect",
            "ProjectUsageService.RecordOpened",
            "ProjectSelectionChangedEventArgs { Project = available ? project : null }");
        RequireTokens(
            Path.Combine(nativeRoot, "ProjectCenterControl.xaml"),
            "收藏",
            "最近使用",
            "路径失效",
            "重新定位",
            "UsageLabel");

        VerifySavedProjectOverlay();
        Console.WriteLine("PASS AtlasDesk v0.9.3 project favorites, recents and missing-path recovery are bounded and explicit");
    }

    private static void VerifySavedProjectOverlay()
    {
        var root = Path.Combine(Path.GetTempPath(), "atlasdesk-project-usage-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var active = Path.Combine(root, "active");
            Directory.CreateDirectory(active);
            File.WriteAllText(Path.Combine(active, "pyproject.toml"), "[project]\nname='active'");
            var missing = Path.Combine(root, "moved-project");
            var descriptor = ProjectCatalogService.Detect(active, root)
                             ?? throw new InvalidOperationException("Active project was not detected.");
            var projects = new List<ProjectDescriptor> { descriptor };
            var settings = new AppSettings
            {
                WorkspaceRoot = root,
                PinnedProjectPaths = new List<string> { active, missing },
                RecentProjectPaths = new List<string> { active }
            };

            ProjectUsageService.ApplyUsage(projects, settings);
            if (!descriptor.IsPinned || !descriptor.IsRecent || descriptor.IsMissing)
                throw new InvalidOperationException("Active project usage state is invalid.");

            var missingProjects = ProjectUsageService.BuildMissingSavedProjects(
                settings,
                root,
                projects.Select(project => project.RootPath));
            if (missingProjects.Count != 1
                || !missingProjects[0].IsMissing
                || !missingProjects[0].IsPinned
                || !string.Equals(missingProjects[0].RootPath, missing, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("Missing saved project overlay is invalid.");
            }
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { }
        }
    }

    private static string FindProjectSourceRoot(string projectDirectory)
    {
        foreach (var candidate in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var current = new DirectoryInfo(candidate);
            while (current is not null)
            {
                var path = Path.Combine(current.FullName, "projects", "1-桌面软件", "102-AtlasDesk", "代码", projectDirectory);
                if (Directory.Exists(path)) return path;
                current = current.Parent;
            }
        }
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v0.9.3 sources.");
    }

    private static void RequireTokens(string path, params string[] tokens)
    {
        var source = File.ReadAllText(path);
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException($"Missing v0.9.3 token '{token}' in {path}.");
        }
    }
}
