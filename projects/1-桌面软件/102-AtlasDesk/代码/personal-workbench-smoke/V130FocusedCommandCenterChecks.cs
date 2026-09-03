using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V130FocusedCommandCenterChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var versionText = XDocument.Load(Path.Combine(nativeRoot, "Version.props"))
            .Descendants("WorkbenchVersion")
            .Select(node => node.Value.Trim())
            .FirstOrDefault();
        if (!Version.TryParse(versionText, out var version) || version != new Version(1, 3, 0))
            throw new InvalidOperationException("AtlasDesk focused Command Center candidate must be v1.3.0.");

        var catalog = File.ReadAllText(RequireFile(nativeRoot, "CommandCenterCatalog.cs"));
        var windowXaml = File.ReadAllText(RequireFile(nativeRoot, "GlobalSearchWindow.xaml"));
        var windowCode = File.ReadAllText(RequireFile(nativeRoot, "GlobalSearchWindow.xaml.cs"));
        var shortcut = File.ReadAllText(RequireFile(nativeRoot, "GlobalShortcutBootstrap.cs"));
        var experience = File.ReadAllText(RequireFile(nativeRoot, "V061ExperienceEnhancer.cs"));
        var contextStore = File.ReadAllText(RequireFile(nativeRoot, "ProductivityContextStore.cs"));
        var notes = File.ReadAllText(RequireFile(nativeRoot, "RELEASE_NOTES_v1.3.0.txt"));

        RequireContains(catalog,
            "MaxRecentResults = 8",
            "MaxTotalResults = 36",
            "BuildStaticResults",
            "BuildRecentFileResults",
            "Task.FromResult<IReadOnlyList<GlobalSearchResult>>",
            "新建 PowerShell 终端",
            "打开工作根目录");
        RequireAbsent(catalog,
            "ProjectCatalogService.Scan",
            "SearchWorkspaceFilesBounded",
            "Directory.EnumerateFileSystemEntries",
            "WorkbenchTaskStore.Load",
            "ZoteroLibrary.SearchAsync",
            "MaxVisitedDirectories",
            "MaxExaminedEntries",
            "FileSystemWatcher",
            "DispatcherTimer");

        RequireContains(windowXaml,
            "Title=\"AtlasDesk 快速打开\"",
            "搜索页面、当前项目、文件、命令或文献…",
            "Text=\"Ctrl+K\"",
            "↑↓ 选择    Enter 执行    Esc 关闭");
        RequireContains(windowCode,
            "ProductivityContextStore.BuildSearchResults",
            "RankMatch",
            "RankDefault",
            "Take(string.IsNullOrWhiteSpace(text) ? 24 : CommandCenterCatalog.MaxTotalResults)",
            "Math.Clamp");
        RequireContains(shortcut,
            "args.Key != Key.K",
            "ModifierKeys.Control");
        RequireContains(experience,
            "Ctrl+K · 搜索页面、当前项目、文件、命令和文献",
            "ProductivityContextCoordinator.TryExecuteAsync");
        RequireContains(contextStore,
            "context-open-project",
            "context-run-command",
            "context-open-dashboard",
            "context-open-favorite",
            "context-open-research");

        RequireContains(notes,
            "AtlasDesk v1.3.0 focused Command Center",
            "existing Ctrl+K window",
            "no second index or command system",
            "Workspace traversal, project rescanning, task-history loading and direct Zotero database search are removed",
            "No new Data file",
            "formal main v1.0.0 baseline remain unchanged");

        Console.WriteLine(
            "PASS AtlasDesk v1.3.0 focuses the existing Ctrl+K Command Center on current context and existing actions without a new index or subsystem");
    }

    private static string RequireFile(string root, params string[] parts)
    {
        var path = parts.Aggregate(root, Path.Combine);
        if (!File.Exists(path))
            throw new InvalidOperationException("Missing v1.3.0 focused Command Center source: " + path);
        return path;
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.3.0 focused Command Center token: " + token);
        }
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden v1.3.0 focused Command Center token returned: " + token);
        }
    }

    private static string FindProjectSourceRoot(string projectDirectory)
    {
        foreach (var candidate in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var current = new DirectoryInfo(candidate);
            while (current is not null)
            {
                var path = Path.Combine(
                    current.FullName,
                    "projects",
                    "1-桌面软件",
                    "102-AtlasDesk",
                    "代码",
                    projectDirectory);
                if (Directory.Exists(path))
                    return path;
                current = current.Parent;
            }
        }
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.3.0 sources.");
    }
}
