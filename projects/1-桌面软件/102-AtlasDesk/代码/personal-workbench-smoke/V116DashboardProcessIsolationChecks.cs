using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V116DashboardProcessIsolationChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var versionText = XDocument.Load(Path.Combine(nativeRoot, "Version.props"))
            .Descendants("WorkbenchVersion")
            .Select(node => node.Value.Trim())
            .FirstOrDefault();
        if (!Version.TryParse(versionText, out var version) || version != new Version(1, 1, 6))
            throw new InvalidOperationException("AtlasDesk Dashboard process-isolation candidate must be v1.1.6.");

        var app = File.ReadAllText(RequireFile(nativeRoot, "App.xaml.cs"));
        var options = File.ReadAllText(RequireFile(nativeRoot, "DashboardHostLaunchOptions.cs"));
        var surface = File.ReadAllText(RequireFile(nativeRoot, "DashboardProcessSurface.cs"));
        var host = File.ReadAllText(RequireFile(nativeRoot, "DashboardHostWindow.cs"));
        var lifecycle = File.ReadAllText(RequireFile(nativeRoot, "DashboardLifecycleCoordinator.cs"));
        var releaseNotes = File.ReadAllText(RequireFile(nativeRoot, "RELEASE_NOTES.txt"));

        RequireContains(app,
            "DashboardHostLaunchOptions.TryParse",
            "StartupUri = null",
            "ShutdownMode = ShutdownMode.OnMainWindowClose",
            "new DashboardHostWindow",
            "StartupGuard.Begin");
        var hostBranch = app.IndexOf("DashboardHostLaunchOptions.TryParse", StringComparison.Ordinal);
        var startupGuard = app.IndexOf("StartupGuard.Begin", StringComparison.Ordinal);
        if (hostBranch < 0 || startupGuard <= hostBranch)
            throw new InvalidOperationException("Dashboard helper mode must bypass StartupGuard before primary startup begins.");

        RequireContains(options,
            "--dashboard-host",
            "--dashboard-url",
            "--dashboard-profile",
            "--parent-process",
            "Path.GetFullPath");

        RequireContains(surface,
            "public sealed class DashboardProcessSurface : HwndHost",
            "SetParent",
            "WsChild",
            "AttachDashboardWindow",
            "MoveWindow",
            "DestroyWindowCore");

        RequireContains(host,
            "public sealed class DashboardHostWindow : Window",
            "ProtocolPrefix = \"ATLASDESK_DASHBOARD\"",
            "AdditionalBrowserArguments = \"--disable-gpu\"",
            "Creating isolated WebView2 environment",
            "DOM injection disabled",
            "CoreWebView2ProcessFailedKind.RenderProcessUnresponsive",
            "CoreWebView2ProcessFailedKind.BrowserProcessExited",
            "WatchParentProcessAsync",
            "Console.In.ReadLineAsync",
            "Environment.ExitCode = 73");
        RequireAbsent(host,
            "AddScriptToExecuteOnDocumentCreatedAsync",
            "WebMessageReceived +=",
            "atlasdesk-click|");

        RequireContains(lifecycle,
            "WebView2 moved to isolated AtlasDesk process",
            "SuppressInProcessDashboard",
            "WriteMainWindowField(\"_isInitializingDashboard\", true)",
            "DashboardProcessSurface",
            "Environment.ProcessPath",
            "RedirectStandardInput = true",
            "RedirectStandardOutput = true",
            "--dashboard-host",
            "WebView2-Isolated",
            "DashboardHost exited unexpectedly",
            "AtlasDesk 主窗口和其他页面未受影响",
            "Attempting one automatic isolated DashboardHost restart",
            "PopoutButton");
        RequireAbsent(lifecycle,
            "new WebView2",
            "Core_ProcessFailed",
            "DashboardClickGuardScript",
            "AddScriptToExecuteOnDocumentCreatedAsync");

        RequireContains(releaseNotes,
            "AtlasDesk v1.1.6 Dashboard process-isolation hotfix",
            "second AtlasDesk.exe process",
            "same executable, separate operating-system process",
            "WebView2-Isolated",
            "--disable-gpu",
            "does not terminate the primary AtlasDesk process",
            "main remains the formal v1.0.0 baseline");

        Console.WriteLine(
            "PASS AtlasDesk v1.1.6 keeps WebView2 and Dashboard page code in an isolated AtlasDesk.exe process with an embedded cross-process HWND surface");
    }

    private static string RequireFile(string root, string fileName)
    {
        var path = Path.Combine(root, fileName);
        if (!File.Exists(path))
            throw new InvalidOperationException("Missing v1.1.6 process-isolation source: " + fileName);
        return path;
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.1.6 process-isolation token: " + token);
        }
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden v1.1.6 in-process Dashboard token returned: " + token);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.1.6 sources.");
    }
}
