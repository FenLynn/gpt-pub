using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V081SourceBoundaryChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindNativeSourceRoot();

        RequireTokens(
            Path.Combine(nativeRoot, "DashboardNavigationPolicy.cs"),
            "MainDashboard",
            "AuthenticationPopup",
            "ExternalBrowser",
            "SameOrigin");

        RequireTokens(
            Path.Combine(nativeRoot, "MainWindow.xaml.cs"),
            "RecoverDashboardAsync",
            "OpenExternalUri",
            "DashboardNavigationPolicy.Classify");

        var hotfix = File.ReadAllText(Path.Combine(nativeRoot, "V068HotfixEnhancer.cs"));
        Reject(hotfix, "SetHostMode(TerminalHostMode.Development)",
            "legacy terminal-over-environment host mode remains");
        Reject(hotfix, "_development.Visibility = Visibility.Collapsed",
            "legacy environment hiding path remains");

        RequireTokens(
            Path.Combine(nativeRoot, "V069UiFixEnhancer.cs"),
            "WM_GETMINMAXINFO",
            "MonitorFromWindow",
            "GetMonitorInfo");

        RequireTokens(
            Path.Combine(nativeRoot, "WorkbenchEnhancer.cs"),
            "shell-divider",
            "content.Effect = null",
            "sidebar.Effect = null");

        var projectCenter = File.ReadAllText(Path.Combine(nativeRoot, "V070ProjectCenterEnhancer.cs"));
        RequireTokens(
            Path.Combine(nativeRoot, "V070ProjectCenterEnhancer.cs"),
            "Tabs_SelectionChanged",
            "_tabs.SelectionChanged += Tabs_SelectionChanged",
            "_tabs.SelectedIndex = 0");
        RequireOrder(
            projectCenter,
            "_tabs = BuildTabs();",
            "_tabs.SelectionChanged += Tabs_SelectionChanged;",
            "_tabs.SelectedIndex = 0;");
        RejectExactLine(projectCenter, "tabs.SelectedIndex = 0;",
            "project center selects a local TabControl before the _tabs field is assigned");

        var diagnosticsPath = Path.Combine(nativeRoot, "DashboardScriptDiagnostics.cs");
        var diagnostics = File.ReadAllText(diagnosticsPath);
        RequireTokens(
            diagnosticsPath,
            "AddScriptToExecuteOnDocumentCreatedAsync",
            "ExecuteScriptAsync",
            "WebMessageReceived",
            "window.addEventListener('error'",
            "window.addEventListener('unhandledrejection'",
            "window.alert = value =>",
            "Cannot use 'in' operator to search for 'type' in undefined",
            "url.search = ''",
            "url.hash = ''",
            "AreDefaultScriptDialogsEnabled = true");
        Reject(diagnostics, "AreDefaultScriptDialogsEnabled = false",
            "Dashboard diagnostics disabled all native website dialogs");
        Reject(diagnostics, "window.confirm =",
            "Dashboard diagnostics replaced normal confirm behavior");
        Reject(diagnostics, "window.prompt =",
            "Dashboard diagnostics replaced normal prompt behavior");

        RequireTokens(
            Path.Combine(nativeRoot, "WorkbenchFeaturePipeline.cs"),
            "DashboardDiagnostics = DashboardScriptDiagnostics.Attach(window)",
            "public DashboardScriptDiagnostics DashboardDiagnostics");

        Console.WriteLine("PASS AtlasDesk v0.8.1 shell, WorkArea, development, Dashboard, startup-order and script-diagnostic source boundaries");
    }

    private static string FindNativeSourceRoot()
    {
        var candidates = new[]
        {
            Directory.GetCurrentDirectory(),
            AppContext.BaseDirectory
        };

        foreach (var candidate in candidates)
        {
            var current = new DirectoryInfo(candidate);
            while (current is not null)
            {
                var path = Path.Combine(
                    current.FullName,
                    "projects", "1-桌面软件", "102-AtlasDesk", "代码", "personal-workbench-native");
                if (Directory.Exists(path))
                    return path;
                current = current.Parent;
            }
        }

        throw new DirectoryNotFoundException(
            "Unable to locate the AtlasDesk native source tree for v0.8.1 boundary checks.");
    }

    private static void RequireTokens(string path, params string[] tokens)
    {
        var source = File.ReadAllText(path);
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException($"Missing required AtlasDesk boundary token '{token}' in {path}.");
        }
    }

    private static void RequireOrder(string source, params string[] tokens)
    {
        var previous = -1;
        foreach (var token in tokens)
        {
            var current = source.IndexOf(token, previous + 1, StringComparison.Ordinal);
            if (current < 0)
                throw new InvalidOperationException("Missing startup-order token: " + token);
            if (current <= previous)
                throw new InvalidOperationException("Invalid startup initialization order near: " + token);
            previous = current;
        }
    }

    private static void RejectExactLine(string source, string line, string message)
    {
        if (source.Split('\n').Any(candidate => string.Equals(candidate.Trim(), line, StringComparison.Ordinal)))
            throw new InvalidOperationException(message + ": " + line);
    }

    private static void Reject(string source, string token, string message)
    {
        if (source.Contains(token, StringComparison.Ordinal))
            throw new InvalidOperationException(message + ": " + token);
    }
}
