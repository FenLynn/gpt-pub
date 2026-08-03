using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V114DashboardStabilityChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var versionText = XDocument.Load(Path.Combine(nativeRoot, "Version.props"))
            .Descendants("WorkbenchVersion")
            .Select(node => node.Value.Trim())
            .FirstOrDefault();
        if (!Version.TryParse(versionText, out var version) || version != new Version(1, 1, 4))
            throw new InvalidOperationException("AtlasDesk Dashboard stability hotfix must be v1.1.4.");

        var lifecycle = File.ReadAllText(RequireFile(nativeRoot, "DashboardLifecycleCoordinator.cs"));
        var pipeline = File.ReadAllText(RequireFile(nativeRoot, "WorkbenchFeaturePipeline.cs"));
        var mainWindow = File.ReadAllText(RequireFile(nativeRoot, "MainWindow.xaml.cs"));
        var releaseNotes = File.ReadAllText(RequireFile(nativeRoot, "RELEASE_NOTES.txt"));

        RequireContains(lifecycle,
            "public sealed class DashboardLifecycleCoordinator",
            "RetireShellDashboardRecoveryHooks",
            "_window.Activated -= activatedHandler",
            "watchdog.Stop()",
            "dashboardNavigation.Checked -= checkedHandler",
            "ReplaceBrowserButton(browserControls, \"刷新\", \"Refresh_Click\", Refresh_Click)",
            "ReplaceClickHandler(retry, \"RetryDashboard_Click\", Retry_Click)",
            "SemaphoreSlim _commandGate",
            "WaitForDashboardIdleAsync",
            "Dashboard 正在初始化或恢复，本次操作已取消以避免闪退",
            "ex is COMException or InvalidOperationException or ObjectDisposedException",
            "InvokeMainWindowTaskAsync(\"EnsureDashboardAsync\", true)",
            "RecoverIfControllerMissingAsync",
            "Do not dispose the semaphore while an async click continuation may still");

        RequireContains(pipeline,
            "ShellResilience = ShellResilienceCoordinator.Attach(window)",
            "DashboardLifecycle = DashboardLifecycleCoordinator.Attach(window, ShellResilience)",
            "public DashboardLifecycleCoordinator DashboardLifecycle { get; }");

        RequireContains(releaseNotes,
            "AtlasDesk v1.1.4 Dashboard stability hotfix",
            "E_ABORT (0x80004004)",
            "Refresh, retry, Dashboard home, back and forward",
            "main remains the formal v1.0.0 baseline");

        var shellIndex = pipeline.IndexOf(
            "ShellResilience = ShellResilienceCoordinator.Attach(window)",
            StringComparison.Ordinal);
        var lifecycleIndex = pipeline.IndexOf(
            "DashboardLifecycle = DashboardLifecycleCoordinator.Attach(window, ShellResilience)",
            StringComparison.Ordinal);
        var diagnosticsIndex = pipeline.IndexOf(
            "DashboardDiagnostics = DashboardScriptDiagnostics.Attach(window)",
            StringComparison.Ordinal);
        if (shellIndex < 0 || lifecycleIndex <= shellIndex || diagnosticsIndex <= lifecycleIndex)
            throw new InvalidOperationException("Dashboard lifecycle guard must attach immediately after shell resilience and before WebView diagnostics.");

        // The retained MainWindow handlers remain for XAML compatibility, but the
        // lifecycle coordinator must detach and replace every command that directly
        // touches WebView2 before the user can invoke it.
        RequireContains(mainWindow,
            "private void Refresh_Click(object sender, RoutedEventArgs e) => _dashboardWebView?.Reload();",
            "private async void RetryDashboard_Click",
            "private async void DashboardHome_Click");

        Console.WriteLine(
            "PASS AtlasDesk v1.1.4 serializes Dashboard commands and retires shell recovery hooks that raced WebView2 controller creation");
    }

    private static string RequireFile(string root, string fileName)
    {
        var path = Path.Combine(root, fileName);
        if (!File.Exists(path))
            throw new InvalidOperationException("Missing v1.1.4 Dashboard stability source: " + fileName);
        return path;
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.1.4 Dashboard stability token: " + token);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.1.4 sources.");
    }
}
