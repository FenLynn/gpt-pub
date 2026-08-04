using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V1110DashboardSimplicityChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var smokeRoot = FindProjectSourceRoot("personal-workbench-dashboard-isolation-smoke");
        var versionText = XDocument.Load(Path.Combine(nativeRoot, "Version.props"))
            .Descendants("WorkbenchVersion")
            .Select(node => node.Value.Trim())
            .FirstOrDefault();
        if (!Version.TryParse(versionText, out var version) || version != new Version(1, 1, 10))
            throw new InvalidOperationException("AtlasDesk Dashboard simplification candidate must be v1.1.10.");

        var pipeline = File.ReadAllText(RequireFile(nativeRoot, "WorkbenchFeaturePipeline.cs"));
        var coordinator = File.ReadAllText(RequireFile(nativeRoot, "DashboardSimplicityCoordinator.cs"));
        var mainWindow = File.ReadAllText(RequireFile(nativeRoot, "MainWindow.xaml.cs"));
        var publishTargets = File.ReadAllText(RequireFile(nativeRoot, "Directory.Build.targets"));
        var smokeProject = File.ReadAllText(RequireFile(smokeRoot, "AtlasDesk.DashboardIsolationSmoke.csproj"));
        var smokeProgram = File.ReadAllText(RequireFile(smokeRoot, "Program.cs"));

        RequireContains(pipeline,
            "Dashboard = DashboardSimplicityCoordinator.Attach(window, ShellResilience)",
            "public DashboardSimplicityCoordinator Dashboard { get; }");
        RequireAbsent(pipeline,
            "DashboardLifecycleCoordinator.Attach",
            "DashboardScriptDiagnostics.Attach",
            "DashboardInteractionCoordinator.Attach");

        RequireContains(coordinator,
            "MainWindow owns the in-process WPF WebView2",
            "RetireShellDashboardRecoveryHooks",
            "_window.Activated -= activatedHandler",
            "watchdog.Stop()",
            "dashboardNavigation.Checked -= checkedHandler",
            "DisableAutomaticWebViewRecreation",
            "_dashboardRecoveryInProgress",
            "field.SetValue(_window, true)");
        RequireAbsent(coordinator,
            "Process.Start",
            "SetParent",
            "AttachThreadInput",
            "DashboardProcessSurface",
            "AtlasDesk.DashboardHost.exe",
            "AddScriptToExecuteOnDocumentCreatedAsync");

        RequireContains(mainWindow,
            "private WebView2? _dashboardWebView",
            "CoreWebView2Environment? _webViewEnvironment",
            "DashboardHost.Children.Add(_dashboardWebView)",
            "await _dashboardWebView.EnsureCoreWebView2Async(_webViewEnvironment)",
            "await popupView.EnsureCoreWebView2Async(_webViewEnvironment)",
            "args.NewWindow = popupView.CoreWebView2",
            "private void Refresh_Click",
            "private async void DashboardHome_Click");

        RequireAbsent(publishTargets,
            "PublishDedicatedDashboardHost",
            "AtlasDesk.DashboardHost.exe",
            "personal-workbench-dashboard-host");

        RequireAbsent(smokeProject,
            "personal-workbench-dashboard-host",
            "AtlasDesk.DashboardHost.csproj");
        RequireContains(smokeProgram,
            "PASS AtlasDesk in-process Dashboard",
            "_dashboardWebView",
            "Keyboard.Focus",
            "document.activeElement.id");

        Console.WriteLine(
            "PASS AtlasDesk v1.1.10 restores one in-process WPF WebView2, retires automatic Dashboard recovery and removes the dedicated host from publish and verification paths");
    }

    private static string RequireFile(string root, string fileName)
    {
        var path = Path.Combine(root, fileName);
        if (!File.Exists(path))
            throw new InvalidOperationException("Missing v1.1.10 Dashboard simplicity source: " + fileName);
        return path;
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.1.10 Dashboard simplicity token: " + token);
        }
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Retired Dashboard complexity returned: " + token);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.1.10 sources.");
    }
}
