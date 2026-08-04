using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V117DashboardInputFocusChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var hostRoot = FindProjectSourceRoot("personal-workbench-dashboard-host");
        var versionText = XDocument.Load(Path.Combine(nativeRoot, "Version.props"))
            .Descendants("WorkbenchVersion")
            .Select(node => node.Value.Trim())
            .FirstOrDefault();
        if (!Version.TryParse(versionText, out var version) || version < new Version(1, 1, 7))
            throw new InvalidOperationException("AtlasDesk Dashboard input-focus baseline must not move below v1.1.7.");

        var surface = File.ReadAllText(RequireFile(nativeRoot, "DashboardProcessSurface.cs"));
        var host = File.ReadAllText(RequireFile(hostRoot, "DashboardHostForm.cs"));
        var releaseNotes = File.ReadAllText(RequireFile(nativeRoot, "RELEASE_NOTES.txt"));

        RequireContains(surface,
            "public bool ActivateDashboardInput()",
            "AttachThreadInput(currentThread, dashboardThread, true)",
            "AttachThreadInput(currentThread, dashboardThread, false)",
            "WmParentNotify",
            "IsMouseButtonMessage",
            "GotKeyboardFocus +=",
            "PreviewMouseDown +=",
            "SetFocus(_dashboardHandle)",
            "DispatcherPriority.Input");

        RequireContains(host,
            "WmMouseActivate",
            "WmSetFocus",
            "FocusBrowserInput(\"wm-mouseactivate\")",
            "FocusBrowserInput(\"wm-setfocus\")",
            "AttachThreadInput(currentThread, foregroundThread, true)",
            "AttachThreadInput(currentThread, foregroundThread, false)",
            "SetFocus(_webView.Handle)",
            "case \"focus\"",
            "DashboardHostProtocol.Emit(\"FOCUS\"");

        RequireContains(releaseNotes,
            "AtlasDesk v1.1.7 Dashboard input-focus hotfix",
            "AttachThreadInput",
            "WM_MOUSEACTIVATE",
            "main remains the formal v1.0.0 baseline");

        Console.WriteLine(
            "PASS AtlasDesk retains the v1.1.7 cross-process input-focus bridge while later versions may replace the original authentication-window strategy");
    }

    private static string RequireFile(string root, string fileName)
    {
        var path = Path.Combine(root, fileName);
        if (!File.Exists(path))
            throw new InvalidOperationException("Missing v1.1.7 Dashboard input-focus source: " + fileName);
        return path;
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.1.7 Dashboard input-focus token: " + token);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.1.7 sources.");
    }
}
