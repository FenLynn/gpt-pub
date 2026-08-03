using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V085ShellResilienceChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var coordinatorPath = Path.Combine(nativeRoot, "ShellResilienceCoordinator.cs");
        RequireTokens(
            coordinatorPath,
            "WmGetMinMaxInfo",
            "WmDpiChanged",
            "MonitorFromWindow",
            "GetMonitorInfo",
            "ApplyMaximizedWorkArea",
            "ApplyMonitorWorkArea",
            "Interlocked.Increment(ref _navigationVersion)",
            "StabilizeNavigation",
            "DispatcherTimer",
            "EnsureDashboardHealthyAsync",
            "_recoveryBurst > 3",
            "已暂停自动重建");

        var coordinator = File.ReadAllText(coordinatorPath);
        Reject(coordinator, "Thread.Sleep(", "shell recovery must never sleep the WPF thread");
        Reject(coordinator, "while (true)", "shell recovery must remain bounded");

        var pipelinePath = Path.Combine(nativeRoot, "WorkbenchFeaturePipeline.cs");
        RequireTokens(
            pipelinePath,
            "ShellResilience = ShellResilienceCoordinator.Attach(window)",
            "public ShellResilienceCoordinator ShellResilience { get; }");

        Console.WriteLine(
            "PASS AtlasDesk v0.8.5 monitor work-area, navigation stabilization and bounded Dashboard recovery boundaries");
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
            "Unable to locate the AtlasDesk source tree for v0.8.5 shell checks.");
    }

    private static void RequireTokens(string path, params string[] tokens)
    {
        var source = File.ReadAllText(path);
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException($"Missing required AtlasDesk v0.8.5 token '{token}' in {path}.");
        }
    }

    private static void Reject(string source, string token, string message)
    {
        if (source.Contains(token, StringComparison.Ordinal))
            throw new InvalidOperationException(message + ": " + token);
    }
}
