using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V115DashboardProcessOwnershipChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var versionText = XDocument.Load(Path.Combine(nativeRoot, "Version.props"))
            .Descendants("WorkbenchVersion")
            .Select(node => node.Value.Trim())
            .FirstOrDefault();
        if (!Version.TryParse(versionText, out var version) || version < new Version(1, 1, 5))
            throw new InvalidOperationException("AtlasDesk must not move below the v1.1.5 Dashboard process-ownership baseline.");

        var lifecycle = File.ReadAllText(RequireFile(nativeRoot, "DashboardLifecycleCoordinator.cs"));
        var releaseNotes = File.ReadAllText(RequireFile(nativeRoot, "RELEASE_NOTES.txt"));

        RequireContains(releaseNotes,
            "AtlasDesk v1.1.5 WebView2 process-ownership hotfix",
            "physical replacement buttons",
            "GPU and utility process exits",
            "RenderProcessUnresponsive",
            "BrowserProcessExited",
            "900 ms",
            "main remains the formal v1.0.0 baseline");

        if (version == new Version(1, 1, 5))
        {
            RequireContains(lifecycle,
                "DashboardClickGuardScript",
                "Core_ProcessFailed",
                "CoreWebView2ProcessFailedKind.GpuProcessExited",
                "CoreWebView2ProcessFailedKind.RenderProcessUnresponsive",
                "CoreWebView2ProcessFailedKind.BrowserProcessExited");
        }
        else
        {
            // v1.1.6 supersedes same-process failure handling with a dedicated
            // WinForms executable. The v1.1.5 findings remain documented, but DOM
            // injection and WebView2 ownership must not return to AtlasDesk.exe.
            RequireContains(lifecycle,
                "WebView2 moved to dedicated AtlasDesk.DashboardHost.exe process",
                "DashboardProcessSurface",
                "AtlasDesk.DashboardHost.exe");
            RequireAbsent(lifecycle,
                "DashboardClickGuardScript",
                "AddScriptToExecuteOnDocumentCreatedAsync",
                "Core_WebMessageReceived",
                "--dashboard-host");
        }

        Console.WriteLine(
            "PASS AtlasDesk retains the v1.1.5 process-failure history while v1.1.6 moves active WebView2 ownership into AtlasDesk.DashboardHost.exe");
    }

    private static string RequireFile(string root, string fileName)
    {
        var path = Path.Combine(root, fileName);
        if (!File.Exists(path))
            throw new InvalidOperationException("Missing Dashboard process-ownership source: " + fileName);
        return path;
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing Dashboard process-ownership token: " + token);
        }
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden in-process Dashboard token returned: " + token);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk sources.");
    }
}
