using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V116DashboardProcessIsolationChecks
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
        if (!Version.TryParse(versionText, out var version) || version < new Version(1, 1, 6))
            throw new InvalidOperationException("AtlasDesk must not move below the v1.1.6 Dashboard process-isolation baseline.");

        var appXaml = File.ReadAllText(RequireFile(nativeRoot, "App.xaml"));
        var app = File.ReadAllText(RequireFile(nativeRoot, "App.xaml.cs"));
        var surface = File.ReadAllText(RequireFile(nativeRoot, "DashboardProcessSurface.cs"));
        var protocol = File.ReadAllText(RequireFile(nativeRoot, "DashboardHostProtocol.cs"));
        var lifecycle = File.ReadAllText(RequireFile(nativeRoot, "DashboardLifecycleCoordinator.cs"));
        var releaseNotes = File.ReadAllText(RequireFile(nativeRoot, "RELEASE_NOTES.txt"));
        var hostProject = File.ReadAllText(RequireFile(hostRoot, "AtlasDesk.DashboardHost.csproj"));
        var hostProgram = File.ReadAllText(RequireFile(hostRoot, "Program.cs"));
        var hostOptions = File.ReadAllText(RequireFile(hostRoot, "DashboardHostOptions.cs"));
        var hostForm = File.ReadAllText(RequireFile(hostRoot, "DashboardHostForm.cs"));
        var hostProtocol = File.ReadAllText(RequireFile(hostRoot, "DashboardHostProtocol.cs"));

        RequireContains(appXaml, "StartupUri=\"MainWindow.xaml\"");
        RequireContains(app,
            "StartupGuard.Begin",
            "Activated += App_Activated",
            "base.OnStartup(e)");
        RequireAbsent(app,
            "DashboardHostWindow",
            "DashboardHostLaunchOptions",
            "--dashboard-host");
        if (File.Exists(Path.Combine(nativeRoot, "DashboardHostWindow.cs"))
            || File.Exists(Path.Combine(nativeRoot, "DashboardHostLaunchOptions.cs"))
            || File.Exists(Path.Combine(nativeRoot, "DashboardHostBootstrapWindow.xaml"))
            || File.Exists(Path.Combine(nativeRoot, "DashboardHostBootstrapWindow.xaml.cs")))
        {
            throw new InvalidOperationException("An obsolete in-process WPF DashboardHost source returned.");
        }

        RequireContains(surface,
            "public sealed class DashboardProcessSurface : HwndHost",
            "SetParent",
            "WsChild",
            "AttachDashboardWindow",
            "MoveWindow",
            "DestroyWindowCore");
        RequireContains(protocol,
            "ATLASDESK_DASHBOARD",
            "Convert.FromBase64String");

        RequireContains(hostProject,
            "<UseWindowsForms>true</UseWindowsForms>",
            "<AssemblyName>AtlasDesk.DashboardHost</AssemblyName>",
            "Microsoft.Web.WebView2",
            "<OutputType>Exe</OutputType>",
            "<PublishSingleFile>true</PublishSingleFile>");
        RequireContains(hostProgram,
            "Application.Run(form)",
            "new DashboardHostForm(options)",
            "startup-probe:dedicated-host-main");
        RequireContains(hostOptions,
            "--dashboard-url",
            "--dashboard-profile",
            "--parent-process",
            "Path.GetFullPath");
        RequireContains(hostProtocol,
            "public static class DashboardHostMarker",
            "ATLASDESK_DASHBOARD",
            "Console.Out.Flush");
        RequireContains(hostForm,
            "internal sealed class DashboardHostForm : Form",
            "Microsoft.Web.WebView2.WinForms",
            "AdditionalBrowserArguments = \"--disable-gpu\"",
            "Creating dedicated WinForms WebView2 environment",
            "await _webView.EnsureCoreWebView2Async(_environment)",
            "DashboardHostProtocol.Emit(",
            "\"HWND\"",
            "Handle.ToInt64()",
            "DashboardHostProtocol.Emit(\"READY\")",
            "CoreWebView2ProcessFailedKind.RenderProcessUnresponsive",
            "CoreWebView2ProcessFailedKind.BrowserProcessExited",
            "Console.In.ReadLineAsync",
            "Environment.ExitCode = 73",
            "ParentTimer_Tick");
        RequireAbsent(hostForm,
            "AddScriptToExecuteOnDocumentCreatedAsync",
            "WebMessageReceived +=",
            "atlasdesk-click|");

        var ensureIndex = hostForm.IndexOf("await _webView.EnsureCoreWebView2Async(_environment)", StringComparison.Ordinal);
        var handleIndex = hostForm.IndexOf("\"HWND\"", ensureIndex + 1, StringComparison.Ordinal);
        if (ensureIndex < 0 || handleIndex <= ensureIndex)
            throw new InvalidOperationException("Dedicated DashboardHost must initialize WebView2 before handing its HWND to AtlasDesk.");

        RequireContains(lifecycle,
            "WebView2 moved to dedicated AtlasDesk.DashboardHost.exe process",
            "SuppressInProcessDashboard",
            "WriteMainWindowField(\"_isInitializingDashboard\", true)",
            "DashboardProcessSurface",
            "Path.Combine(App.RuntimeDirectory, \"DashboardHost\")",
            "AtlasDesk.DashboardHost.exe",
            "RedirectStandardInput = true",
            "RedirectStandardOutput = true",
            "WebView2-Isolated",
            "Dedicated DashboardHost exited unexpectedly",
            "AtlasDesk 主窗口和其他页面未受影响",
            "Attempting one automatic dedicated DashboardHost restart",
            "PopoutButton");
        RequireAbsent(lifecycle,
            "Environment.ProcessPath",
            "--dashboard-host",
            "new WebView2",
            "Core_ProcessFailed",
            "DashboardClickGuardScript",
            "AddScriptToExecuteOnDocumentCreatedAsync");

        RequireContains(releaseNotes,
            "AtlasDesk v1.1.6 Dashboard process-isolation hotfix",
            "AtlasDesk.DashboardHost.exe",
            "WinForms WebView2",
            "WebView2-Isolated",
            "--disable-gpu",
            "does not terminate the primary AtlasDesk process",
            "main remains the formal v1.0.0 baseline");

        Console.WriteLine(
            "PASS AtlasDesk retains the v1.1.6 dedicated Dashboard process-isolation baseline");
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
