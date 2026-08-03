using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V100ReleaseReadinessChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var versionPath = Path.Combine(nativeRoot, "Version.props");
        var versionText = XDocument.Load(versionPath)
            .Descendants("WorkbenchVersion")
            .Select(node => node.Value.Trim())
            .FirstOrDefault();
        if (!Version.TryParse(versionText, out var version) || version < new Version(1, 0, 0))
            throw new InvalidOperationException("AtlasDesk version moved below the formal v1.0.0 baseline.");

        RequireFile(nativeRoot, "WindowWorkAreaGuard.cs");
        RequireFile(nativeRoot, "ProjectContextService.cs");
        RequireFile(nativeRoot, "ProjectUsageService.cs");
        RequireFile(nativeRoot, "ZoteroCitationFormatter.cs");
        RequireFile(nativeRoot, "ZoteroLibraryControl.ReferencePane.cs");
        RequireFile(nativeRoot, "WorkbenchTaskHub.cs");
        RequireFile(nativeRoot, "TaskToolCoordinator.cs");
        RequireFile(nativeRoot, "ProjectWorkflowCoordinator.cs");

        RejectFile(nativeRoot, "V064TaskEnhancer.cs");
        RejectFile(nativeRoot, "V065ToolsEnhancer.cs");
        RejectFile(nativeRoot, "V068HotfixEnhancer.cs");
        RejectFile(nativeRoot, "V070ProjectCenterEnhancer.cs");
        RejectFile(nativeRoot, "V070RuntimeVerifier.cs");

        RequireTokens(
            Path.Combine(nativeRoot, "ZoteroLibrary.cs"),
            "SqliteOpenMode.ReadOnly",
            "PRAGMA query_only=ON");
        RequireTokens(
            Path.Combine(nativeRoot, "ZoteroLibraryControl.ReferencePane.cs"),
            "ShowPdfFolder_Click",
            "CopyCitationKey_Click",
            "CopyCitation_Click");
        RequireTokens(
            Path.Combine(nativeRoot, "ProjectContextService.cs"),
            "CancelAfter(GitTimeout)",
            "--untracked-files=no");
        RequireTokens(
            Path.Combine(nativeRoot, "ProjectUsageService.cs"),
            "PinnedProjectPaths",
            "RecentProjectPaths",
            "Relocate");
        RequireTokens(
            Path.Combine(nativeRoot, "TaskToolCoordinator.cs"),
            "WorkbenchTaskHub.Shutdown",
            "Window_Closing",
            "Window_Closed");
        RequireTokens(
            Path.Combine(nativeRoot, "WindowWorkAreaGuard.cs"),
            "WmGetMinMaxInfo",
            "WorkArea");

        Console.WriteLine($"PASS AtlasDesk {version} preserves v1.0.0 release-readiness components and boundaries");
    }

    private static void RequireFile(string root, string fileName)
    {
        if (!File.Exists(Path.Combine(root, fileName)))
            throw new InvalidOperationException("Required v1.0.0 baseline component is missing: " + fileName);
    }

    private static void RejectFile(string root, string fileName)
    {
        if (File.Exists(Path.Combine(root, fileName)))
            throw new InvalidOperationException("Retired component returned after v1.0.0: " + fileName);
    }

    private static void RequireTokens(string path, params string[] tokens)
    {
        var source = File.ReadAllText(path);
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException($"Missing v1.0.0 baseline token '{token}' in {path}.");
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.x sources.");
    }
}
