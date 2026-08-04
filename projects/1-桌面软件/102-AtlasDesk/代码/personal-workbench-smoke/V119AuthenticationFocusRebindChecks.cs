using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V119AuthenticationFocusRebindChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var versionText = XDocument.Load(Path.Combine(nativeRoot, "Version.props"))
            .Descendants("WorkbenchVersion")
            .Select(node => node.Value.Trim())
            .FirstOrDefault();
        if (!Version.TryParse(versionText, out var version) || version != new Version(1, 1, 9))
            throw new InvalidOperationException("AtlasDesk authentication focus-rebind candidate must be v1.1.9.");

        var surface = File.ReadAllText(RequireFile(nativeRoot, "DashboardProcessSurface.cs"));

        RequireContains(surface,
            "DispatcherTimer _inputWatchdog",
            "Interval = TimeSpan.FromMilliseconds(25)",
            "InputWatchdog_Tick",
            "GetParent(_dashboardHandle) != _hostHandle",
            "_observedDetached = true",
            "_focusRecoveryAttempts = 12",
            "IsAnyMouseButtonDown()",
            "IsCursorInsideHost()",
            "GetAsyncKeyState",
            "GetCursorPos",
            "GetWindowRect",
            "QueueDashboardInputActivation",
            "AttachThreadInput(currentThread, dashboardThread, true)",
            "AttachThreadInput(currentThread, dashboardThread, false)",
            "SetFocus(_dashboardHandle)");

        RequireAbsent(surface,
            "MouseMove +=",
            "IsMouseOver",
            "SetForegroundWindow(_dashboardHandle)");

        Console.WriteLine(
            "PASS AtlasDesk v1.1.9 detects DashboardHost detach/re-embed, performs bounded focus recovery and restores input only on real Dashboard mouse presses without hover focus stealing");
    }

    private static string RequireFile(string root, string fileName)
    {
        var path = Path.Combine(root, fileName);
        if (!File.Exists(path))
            throw new InvalidOperationException("Missing v1.1.9 authentication focus-rebind source: " + fileName);
        return path;
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.1.9 authentication focus-rebind token: " + token);
        }
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden v1.1.9 focus-stealing token returned: " + token);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.1.9 sources.");
    }
}
