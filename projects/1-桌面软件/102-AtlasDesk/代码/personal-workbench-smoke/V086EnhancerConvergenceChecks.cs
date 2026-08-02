using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V086EnhancerConvergenceChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var pipelinePath = Path.Combine(nativeRoot, "WorkbenchFeaturePipeline.cs");
        var pipeline = File.ReadAllText(pipelinePath);

        RequireTokens(
            pipelinePath,
            "FeatureHosts = FeatureHostTerminalCoordinator.Attach(window, this)",
            "LegacyConvergence = LegacyEnhancerConvergenceCoordinator.Attach(window, UiFixes)",
            "public FeatureHostTerminalCoordinator FeatureHosts { get; }",
            "public LegacyEnhancerConvergenceCoordinator LegacyConvergence { get; }");
        Reject(pipeline, "V068HotfixEnhancer", "retired V068 hotfix remains in the feature pipeline");

        var retiredPath = Path.Combine(nativeRoot, "V068HotfixEnhancer.cs");
        if (File.Exists(retiredPath))
            throw new InvalidOperationException("V068HotfixEnhancer.cs was not retired.");

        RequireTokens(
            Path.Combine(nativeRoot, "FeatureHostTerminalCoordinator.cs"),
            "Long-term owner for the Library/Development feature hosts",
            "NormalizeFeatureHosts",
            "WireTerminalLifecycle",
            "DockTerminalBottom",
            "TerminalHostMode.Bottom");

        RequireTokens(
            Path.Combine(nativeRoot, "LegacyEnhancerConvergenceCoordinator.cs"),
            "RemoveWindowWorkAreaHook",
            "ShellResilienceCoordinator is the exclusive owner",
            "DispatcherPriority.Loaded");

        Console.WriteLine(
            "PASS AtlasDesk v0.8.6 retired V068 and established named feature-host and legacy-ownership boundaries");
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
                if (Directory.Exists(path)) return path;
                current = current.Parent;
            }
        }
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v0.8.6 sources.");
    }

    private static void RequireTokens(string path, params string[] tokens)
    {
        var source = File.ReadAllText(path);
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException($"Missing v0.8.6 token '{token}' in {path}.");
        }
    }

    private static void Reject(string source, string token, string message)
    {
        if (source.Contains(token, StringComparison.Ordinal))
            throw new InvalidOperationException(message + ": " + token);
    }
}
