using System.Reflection;
using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V091WorkAreaChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");

        RequireTokens(
            Path.Combine(nativeRoot, "WindowWorkAreaGuard.cs"),
            "WmGetMinMaxInfo = 0x0024",
            "MonitorFromWindow",
            "GetMonitorInfo",
            "WorkArea",
            "CalculateMaximizedBounds",
            "handled = TryApplyMonitorWorkArea");
        RequireTokens(
            Path.Combine(nativeRoot, "MainWindow.WorkArea.cs"),
            "OnSourceInitialized",
            "WindowWorkAreaGuard.Attach(this)");
        RequireTokens(
            Path.Combine(nativeRoot, "ToolsCenterControl.Responsive.cs"),
            "ApplyResponsiveInsets",
            "< 700 => 6",
            "< 840 => 9",
            "root.MinHeight = 0");

        VerifyGeometry();
        Console.WriteLine("PASS AtlasDesk v0.9.1 maximized windows respect taskbar work areas and tools remain height-responsive");
    }

    private static void VerifyGeometry()
    {
        var guard = typeof(ProjectContextService).Assembly.GetType("PersonalWorkbench.WindowWorkAreaGuard", throwOnError: true)!;
        var method = guard.GetMethod("CalculateMaximizedBounds", BindingFlags.Static | BindingFlags.NonPublic)
                     ?? throw new InvalidOperationException("Work-area geometry helper is unavailable.");

        VerifyCase(method, new object[] { 0, 0, 0, 0, 1920, 1040 }, 0, 0, 1920, 1040, "bottom taskbar");
        VerifyCase(method, new object[] { -1920, 0, -1880, 0, 0, 1080 }, 40, 0, 1880, 1080, "left taskbar on secondary monitor");
        VerifyCase(method, new object[] { 0, 0, 0, 32, 1920, 1080 }, 0, 32, 1920, 1048, "top taskbar");
    }

    private static void VerifyCase(
        MethodInfo method,
        object[] arguments,
        int expectedX,
        int expectedY,
        int expectedWidth,
        int expectedHeight,
        string label)
    {
        if (method.Invoke(null, arguments) is not ITuple bounds
            || bounds.Length != 4
            || (int)bounds[0]! != expectedX
            || (int)bounds[1]! != expectedY
            || (int)bounds[2]! != expectedWidth
            || (int)bounds[3]! != expectedHeight)
        {
            throw new InvalidOperationException("Invalid maximized work-area geometry for " + label + ".");
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
                    "projects", "1-桌面软件", "102-AtlasDesk", "代码", projectDirectory);
                if (Directory.Exists(path))
                    return path;
                current = current.Parent;
            }
        }

        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v0.9.1 sources.");
    }

    private static void RequireTokens(string path, params string[] tokens)
    {
        var source = File.ReadAllText(path);
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException($"Missing v0.9.1 token '{token}' in {path}.");
        }
    }
}
