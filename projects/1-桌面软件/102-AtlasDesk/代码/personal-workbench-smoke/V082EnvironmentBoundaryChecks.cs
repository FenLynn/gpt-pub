using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V083StartupBoundaryChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        VerifyPythonLauncherParsing();
        VerifySourceBoundaries();
        Console.WriteLine(
            "PASS AtlasDesk v0.8.3 lazy environment discovery, single discovery owner and isolated residency boundaries");
    }

    private static void VerifyPythonLauncherParsing()
    {
        var parsed = PythonEnvironmentService.ParsePythonLauncherPaths(
            " -V:3.12 * C:\\Users\\tester\\AppData\\Local\\Programs\\Python\\Python312\\python.exe\r\n"
            + " -V:3.11   C:\\Program Files\\Python311\\python.exe\r\n"
            + " duplicate C:\\Program Files\\Python311\\python.exe\r\n"
            + " invalid launcher line\r\n");

        if (parsed.Count != 2
            || !parsed.Contains(
                "C:\\Users\\tester\\AppData\\Local\\Programs\\Python\\Python312\\python.exe",
                StringComparer.OrdinalIgnoreCase)
            || !parsed.Contains(
                "C:\\Program Files\\Python311\\python.exe",
                StringComparer.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Python Launcher output parsing or de-duplication regressed.");
        }
    }

    private static void VerifySourceBoundaries()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");

        var servicePath = Path.Combine(nativeRoot, "PythonEnvironmentService.cs");
        var service = File.ReadAllText(servicePath);
        RequireTokens(
            servicePath,
            "FindOnPathAsync(\"py.exe\")",
            "RunToolAsync(launcher, \"-0p\", 5000, logFailure: false)",
            "Keep discovery deliberately serial and bounded");
        Reject(service, "RunToolAsync(\"py.exe\", \"-0p\"",
            "optional Python Launcher is still started directly");
        Reject(service, "SemaphoreSlim",
            "parallel interpreter probing was reintroduced into the recovery build");
        Reject(service, "CreateLinkedTokenSource",
            "cancellable process-tree probing was reintroduced into the recovery build");
        Reject(service, "EnumerateWorkspaceEnvironmentCandidates",
            "project-directory environment scanning was reintroduced into the recovery build");

        var developmentPath = Path.Combine(nativeRoot, "DevelopmentControl.xaml.cs");
        var development = File.ReadAllText(developmentPath);
        RequireTokens(
            developmentPath,
            "Environment discovery is deliberately not bound to IsVisibleChanged",
            "AuthorizeInteractiveEnvironmentRequest",
            "tabs.IsKeyboardFocusWithin",
            "tabs.IsMouseOver",
            "tabs.SelectedIndex = 0",
            "Ignored non-interactive environment discovery request",
            "public async Task EnsureLoadedAsync()",
            "SetBusyState(true)",
            "SetBusyState(false)");
        Reject(development, "IsVisibleChanged +=",
            "environment discovery can still start during control reparenting");
        Reject(development, "CancellationTokenSource",
            "the unstable refresh cancellation chain remains in DevelopmentControl");

        RequireTokens(
            Path.Combine(nativeRoot, "DevelopmentLifecycleGuard.cs"),
            "SuppressLegacyEnvironmentDiscovery",
            "_pythonInitialized");
        RequireTokens(
            Path.Combine(nativeRoot, "WorkbenchFeaturePipeline.cs"),
            "DevelopmentLifecycleGuard.SuppressLegacyEnvironmentDiscovery(window)");
        RequireTokens(
            Path.Combine(nativeRoot, "ProjectWorkflowCoordinator.cs"),
            "case EnvironmentTabIndex:",
            "await _development.EnsureLoadedAsync()",
            "_tabs.SelectedIndex = ProjectTabIndex");

        var residencyRoot = FindProjectSourceRoot("personal-workbench-residency-smoke");
        RequireTokens(
            Path.Combine(residencyRoot, "Program.cs"),
            "[STAThread]",
            "ShutdownMode.OnExplicitShutdown",
            "PumpDispatcher(TimeSpan.FromSeconds(10))",
            "AssertEnvironmentIdle",
            "opening Development project tab started environment discovery",
            "PASS AtlasDesk isolated process remained alive");
        RequireTokens(
            Path.Combine(residencyRoot, "AtlasDesk.ResidencySmoke.csproj"),
            "<UseWPF>true</UseWPF>",
            "personal-workbench-native\\PersonalWorkbench.csproj");

        var smokeRoot = FindProjectSourceRoot("personal-workbench-smoke");
        var smokeProjectPath = Path.Combine(smokeRoot, "PersonalWorkbench.Smoke.csproj");
        RequireTokens(
            smokeProjectPath,
            "personal-workbench-residency-smoke\\AtlasDesk.ResidencySmoke.csproj",
            "ReferenceOutputAssembly=\"false\"");
        var smokeProject = File.ReadAllText(smokeProjectPath);
        Reject(smokeProject, "RunAtlasDeskResidencySmoke",
            "residency process is still nested inside the legacy smoke MSBuild target");
        Reject(smokeProject, "<Exec Command=",
            "residency process execution remains hidden inside MSBuild");
        if (File.Exists(Path.Combine(smokeRoot, "MainWindowStartupProbe.cs")))
        {
            throw new InvalidOperationException(
                "module-initializer-coupled MainWindowStartupProbe still exists in the legacy smoke project");
        }

        var workflowPath = Path.Combine(FindRepositoryRoot(nativeRoot), ".github", "workflows", "p102-atlasdesk-ci.yml");
        RequireTokens(
            workflowPath,
            "name: Run isolated startup residency",
            "timeout-minutes: 2",
            "personal-workbench-residency-smoke/AtlasDesk.ResidencySmoke.csproj",
            "-c Release --no-restore");

        RequireTokens(
            Path.Combine(nativeRoot, "App.xaml.cs"),
            "Application Exit event",
            "CLR ProcessExit event",
            "Main window Closing event");
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
                    "projects", "1-桌面软件", "102-AtlasDesk", "代码", projectDirectory);
                if (Directory.Exists(path))
                    return path;
                current = current.Parent;
            }
        }

        throw new DirectoryNotFoundException(
            "Unable to locate the AtlasDesk source tree for v0.8.3 startup checks.");
    }

    private static string FindRepositoryRoot(string sourcePath)
    {
        var current = new DirectoryInfo(sourcePath);
        while (current is not null)
        {
            if (Directory.Exists(Path.Combine(current.FullName, ".github"))
                && Directory.Exists(Path.Combine(current.FullName, "projects")))
            {
                return current.FullName;
            }
            current = current.Parent;
        }

        throw new DirectoryNotFoundException(
            "Unable to locate repository root for AtlasDesk workflow checks.");
    }

    private static void RequireTokens(string path, params string[] tokens)
    {
        var source = File.ReadAllText(path);
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Missing required AtlasDesk v0.8.3 token '{token}' in {path}.");
            }
        }
    }

    private static void Reject(string source, string token, string message)
    {
        if (source.Contains(token, StringComparison.Ordinal))
            throw new InvalidOperationException(message + ": " + token);
    }
}
