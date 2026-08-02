using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V082EnvironmentBoundaryChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        VerifyPythonLauncherParsing();
        VerifyWorkspaceEnvironmentDiscovery();
        VerifySourceBoundaries();
        Console.WriteLine("PASS AtlasDesk v0.8.2 optional Python launcher, workspace environments and refresh-state boundaries");
    }

    private static void VerifyPythonLauncherParsing()
    {
        var parsed = PythonEnvironmentService.ParsePythonLauncherPaths(
            " -V:3.12 * C:\\Users\\tester\\AppData\\Local\\Programs\\Python\\Python312\\python.exe\r\n"
            + " -V:3.11   C:\\Program Files\\Python311\\python.exe\r\n"
            + " duplicate C:\\Program Files\\Python311\\python.exe\r\n"
            + " invalid launcher line\r\n");

        if (parsed.Count != 2
            || !parsed.Contains("C:\\Users\\tester\\AppData\\Local\\Programs\\Python\\Python312\\python.exe", StringComparer.OrdinalIgnoreCase)
            || !parsed.Contains("C:\\Program Files\\Python311\\python.exe", StringComparer.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Python Launcher output parsing or de-duplication regressed.");
        }
    }

    private static void VerifyWorkspaceEnvironmentDiscovery()
    {
        var root = Path.Combine(Path.GetTempPath(), "atlasdesk-v082-env-" + Guid.NewGuid().ToString("N"));
        try
        {
            CreateFakeEnvironment(Path.Combine(root, ".venv"));
            CreateFakeEnvironment(Path.Combine(root, "laser-model", "venv"));
            CreateFakeEnvironment(Path.Combine(root, "node_modules", "ignored", ".venv"));

            var prefixes = PythonEnvironmentService.EnumerateWorkspaceEnvironmentPrefixes(root);
            var expectedRoot = Path.GetFullPath(Path.Combine(root, ".venv"));
            var expectedProject = Path.GetFullPath(Path.Combine(root, "laser-model", "venv"));
            if (prefixes.Count != 2
                || !prefixes.Contains(expectedRoot, StringComparer.OrdinalIgnoreCase)
                || !prefixes.Contains(expectedProject, StringComparer.OrdinalIgnoreCase)
                || prefixes.Any(path => path.Contains("node_modules", StringComparison.OrdinalIgnoreCase)))
            {
                throw new InvalidOperationException("Workspace Python environment discovery did not preserve the bounded one-level policy.");
            }
        }
        finally
        {
            try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch { }
        }
    }

    private static void VerifySourceBoundaries()
    {
        var nativeRoot = FindNativeSourceRoot();
        var servicePath = Path.Combine(nativeRoot, "PythonEnvironmentService.cs");
        var service = File.ReadAllText(servicePath);
        RequireTokens(
            servicePath,
            "FindOnPathAsync(\"py.exe\"",
            "RunToolAsync(launcher, \"-0p\", 5000, cancellationToken, logFailure: false)",
            "SemaphoreSlim(4)",
            "EnumerateWorkspaceEnvironmentCandidates",
            "IgnoredWorkspaceDirectories",
            "CancellationToken cancellationToken = default");
        Reject(service, "RunToolAsync(\"py.exe\", \"-0p\"",
            "optional Python Launcher is still started directly without discovery");

        RequireTokens(
            Path.Combine(nativeRoot, "DevelopmentControl.xaml"),
            "x:Name=\"RefreshButton\"",
            "x:Name=\"DiscoveryProgress\"",
            "IsIndeterminate=\"True\"");
        RequireTokens(
            Path.Combine(nativeRoot, "DevelopmentControl.xaml.cs"),
            "CancellationTokenSource? _refreshCancellation",
            "SetBusyState(true)",
            "SetBusyState(false)",
            "已包含工作区根目录与一级项目目录");
    }

    private static void CreateFakeEnvironment(string prefix)
    {
        var scripts = Path.Combine(prefix, "Scripts");
        Directory.CreateDirectory(scripts);
        File.WriteAllBytes(Path.Combine(scripts, "python.exe"), [0x4D, 0x5A]);
    }

    private static string FindNativeSourceRoot()
    {
        foreach (var candidate in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
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
            "Unable to locate the AtlasDesk native source tree for v0.8.2 environment checks.");
    }

    private static void RequireTokens(string path, params string[] tokens)
    {
        var source = File.ReadAllText(path);
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException($"Missing required AtlasDesk v0.8.2 token '{token}' in {path}.");
        }
    }

    private static void Reject(string source, string token, string message)
    {
        if (source.Contains(token, StringComparison.Ordinal))
            throw new InvalidOperationException(message + ": " + token);
    }
}
