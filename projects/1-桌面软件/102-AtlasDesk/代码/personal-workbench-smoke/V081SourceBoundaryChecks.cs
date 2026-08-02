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

        Console.WriteLine("PASS AtlasDesk v0.8.1 shell, WorkArea, development and Dashboard source boundaries");
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

    private static void Reject(string source, string token, string message)
    {
        if (source.Contains(token, StringComparison.Ordinal))
            throw new InvalidOperationException(message + ": " + token);
    }
}
