using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V121CompactHomeProjectResourceChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var versionText = XDocument.Load(Path.Combine(nativeRoot, "Version.props"))
            .Descendants("WorkbenchVersion")
            .Select(node => node.Value.Trim())
            .FirstOrDefault();
        if (!Version.TryParse(versionText, out var version) || version != new Version(1, 2, 1))
            throw new InvalidOperationException("AtlasDesk compact home and project-resource candidate must be v1.2.1.");

        var source = File.ReadAllText(RequireFile(nativeRoot, "CompactProjectExperience.cs"));
        var notes = File.ReadAllText(RequireFile(nativeRoot, "RELEASE_NOTES_v1.2.1.txt"));

        RequireContains(source,
            "typeof(ProjectCenterControl)",
            "typeof(HomeDashboardControl)",
            "Text = \"项目资源\"",
            "搜索文件、命令或文献",
            "RenameSection(stack, \"常用文件\", \"文件\")",
            "RenameSection(stack, \"常用命令\", \"命令\")",
            "RenameSection(stack, \"关联文献\", \"文献\")",
            "ProductivityContextStore.Load()",
            "state.Session.ProjectRoot",
            "state.Session.WorkspacePath",
            "最近项目 · ",
            "RaiseButtonByContent(home, \"开发\")",
            "最近文件");
        RequireAbsent(source,
            "DispatcherTimer",
            "System.Threading.Timer",
            "SearchOption.AllDirectories",
            "EnumerateFiles",
            "EnumerateDirectories",
            "FileSystemWatcher",
            "Process.Start",
            "JsonSerializer");

        RequireContains(notes,
            "AtlasDesk v1.2.1 compact home and project resources",
            "existing saved session project",
            "already loaded favorite files",
            "No new Data file",
            "main remains the formal v1.0.0 baseline");

        Console.WriteLine(
            "PASS AtlasDesk v1.2.1 reuses existing session state and loaded project resources without adding a new subsystem");
    }

    private static string RequireFile(string root, params string[] parts)
    {
        var path = parts.Aggregate(root, Path.Combine);
        if (!File.Exists(path))
            throw new InvalidOperationException("Missing v1.2.1 compact source: " + path);
        return path;
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.2.1 compact token: " + token);
        }
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden v1.2.1 compact token returned: " + token);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.2.1 sources.");
    }
}
