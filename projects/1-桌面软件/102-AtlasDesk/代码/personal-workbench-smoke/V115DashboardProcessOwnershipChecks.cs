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
        if (!Version.TryParse(versionText, out var version) || version != new Version(1, 1, 5))
            throw new InvalidOperationException("AtlasDesk Dashboard process-ownership hotfix must be v1.1.5.");

        var lifecycle = File.ReadAllText(RequireFile(nativeRoot, "DashboardLifecycleCoordinator.cs"));
        var releaseNotes = File.ReadAllText(RequireFile(nativeRoot, "RELEASE_NOTES.txt"));

        RequireContains(lifecycle,
            "using Microsoft.Web.WebView2.Core",
            "ReplaceButtonElement",
            "parent.Children.RemoveAt(index)",
            "parent.Children.Insert(index, replacement)",
            "DashboardClickGuardScript",
            "now - lastAt < 900",
            "atlasdesk-click|",
            "Core_WebMessageReceived",
            "Core_ProcessFailed",
            "WebView2 process failure classified",
            "WriteMainWindowField(\"_dashboardRecoveryInProgress\", true)",
            "CoreWebView2ProcessFailedKind.GpuProcessExited",
            "CoreWebView2ProcessFailedKind.UtilityProcessExited",
            "CoreWebView2ProcessFailedKind.RenderProcessUnresponsive",
            "CoreWebView2ProcessFailedKind.RenderProcessExited",
            "CoreWebView2ProcessFailedKind.BrowserProcessExited",
            "destructive rebuild skipped",
            "RecoverRendererWithBoundedReloadAsync",
            "10-second cooldown",
            "Environment_BrowserProcessExited",
            "FailureReportFolderPath",
            "Dashboard command started",
            "Dashboard command completed",
            "controlled Dashboard recreation");

        RequireAbsent(lifecycle,
            "ReplaceClickHandler",
            "button.Click -= legacyHandler");

        RequireContains(releaseNotes,
            "AtlasDesk v1.1.5 WebView2 process-ownership hotfix",
            "physical replacement buttons",
            "GPU and utility process exits",
            "RenderProcessUnresponsive",
            "BrowserProcessExited",
            "900 ms",
            "main remains the formal v1.0.0 baseline");

        Console.WriteLine(
            "PASS AtlasDesk v1.1.5 physically replaces legacy Dashboard buttons, classifies WebView2 failures and suppresses rapid web clicks");
    }

    private static string RequireFile(string root, string fileName)
    {
        var path = Path.Combine(root, fileName);
        if (!File.Exists(path))
            throw new InvalidOperationException("Missing v1.1.5 Dashboard process-ownership source: " + fileName);
        return path;
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.1.5 Dashboard process-ownership token: " + token);
        }
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden v1.1.5 Dashboard process-ownership token returned: " + token);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.1.5 sources.");
    }
}
