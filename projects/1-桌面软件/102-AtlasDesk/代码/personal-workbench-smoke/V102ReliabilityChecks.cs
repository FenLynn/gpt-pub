using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V102ReliabilityChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var settingsSource = File.ReadAllText(Path.Combine(nativeRoot, "AppSettings.cs"));
        var startupSource = File.ReadAllText(Path.Combine(nativeRoot, "StartupGuard.cs"));
        var appSource = File.ReadAllText(Path.Combine(nativeRoot, "App.xaml.cs"));
        var diagnosticsSource = File.ReadAllText(Path.Combine(nativeRoot, "DiagnosticsService.cs"));
        var diagnosticsWindowSource = File.ReadAllText(Path.Combine(nativeRoot, "DiagnosticsWindow.xaml.cs"));

        RequireContains(settingsSource,
            "AtomicFileStore.WriteAllText",
            "SettingsLoadSource.Backup",
            "AtomicFileStore.Quarantine",
            "SerializePersistent",
            "RuntimeDashboardAutoOpenSuppressed");
        RequireContains(startupSource,
            "SafeModeThreshold = 2",
            "SafeModeRecommended",
            "ShouldUseSafeMode",
            "AtomicFileStore.WriteAllText");
        RequireContains(appSource,
            "public static bool IsSafeMode",
            "StartupGuard.SafeModeRecommended",
            "本次不会自动打开 Dashboard");
        RequireContains(diagnosticsSource,
            "CancellationToken cancellationToken",
            "CheckDashboardReachabilityAsync",
            "CancelAfter(TimeSpan.FromSeconds(4))",
            "CheckTerminalHost",
            "ExecutableLocator.Resolve",
            "SettingsLoadSource.Backup");
        RequireAbsent(diagnosticsSource,
            "Process.Start(",
            "Process.StartInfo");
        RequireContains(diagnosticsWindowSource,
            "CancelOperation",
            "_operationGeneration",
            "OperationCanceledException",
            "IsCurrent(operation)");

        VerifyAtomicWriteAndBackup();
        VerifyStartupPolicy();
        VerifyConfiguredExecutableResolution();
        Console.WriteLine("PASS AtlasDesk v1.0.2 atomically protects settings, enters bounded safe startup and runs cancellable diagnostics");
    }

    private static void VerifyAtomicWriteAndBackup()
    {
        var root = Path.Combine(Path.GetTempPath(), "AtlasDesk-v102-atomic-" + Guid.NewGuid().ToString("N"));
        var primary = Path.Combine(root, "settings.json");
        var backup = primary + ".bak";
        Directory.CreateDirectory(root);
        try
        {
            AtomicFileStore.WriteAllText(primary, "first");
            AtomicFileStore.WriteAllText(primary, "second", backup);
            if (File.ReadAllText(primary) != "second" || File.ReadAllText(backup) != "first")
                throw new InvalidOperationException("Atomic write did not preserve the previous valid file as backup.");

            var quarantined = AtomicFileStore.Quarantine(primary, "corrupt");
            if (quarantined is null || File.Exists(primary) || !File.Exists(quarantined))
                throw new InvalidOperationException("Atomic quarantine did not isolate the requested file.");
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { }
        }
    }

    private static void VerifyStartupPolicy()
    {
        var now = DateTimeOffset.UtcNow;
        var previous = new StartupGuardState
        {
            Version = "1.0.2",
            Running = true,
            ConsecutiveUncleanStarts = 0,
            LastStartUtc = now.AddMinutes(-2)
        };
        var first = StartupGuard.CreateNext(previous, "1.0.2", now);
        if (first.ConsecutiveUncleanStarts != 1 || StartupGuard.ShouldUseSafeMode(first))
            throw new InvalidOperationException("The first unclean start must warn without forcing safe mode.");

        var second = StartupGuard.CreateNext(first, "1.0.2", now.AddMinutes(1));
        if (second.ConsecutiveUncleanStarts != 2 || !StartupGuard.ShouldUseSafeMode(second))
            throw new InvalidOperationException("The second consecutive unclean start must enter safe mode.");

        var clean = StartupGuard.MarkClean(second, now.AddMinutes(2));
        if (clean.Running || clean.ConsecutiveUncleanStarts != 0)
            throw new InvalidOperationException("A clean exit must reset the consecutive unclean counter.");
    }

    private static void VerifyConfiguredExecutableResolution()
    {
        var root = Path.Combine(Path.GetTempPath(), "AtlasDesk-v102-exe-" + Guid.NewGuid().ToString("N"));
        var executable = Path.Combine(root, "tool.exe");
        Directory.CreateDirectory(root);
        File.WriteAllBytes(executable, Array.Empty<byte>());
        try
        {
            var resolved = ExecutableLocator.Resolve(executable, "missing-tool");
            if (!string.Equals(resolved, executable, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Configured executable resolution did not prefer an existing explicit path.");
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { }
        }
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.0.2 reliability token: " + token);
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden v1.0.2 reliability token returned: " + token);
    }

    private static string FindProjectSourceRoot(string projectDirectory)
    {
        foreach (var candidate in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var current = new DirectoryInfo(candidate);
            while (current is not null)
            {
                var path = Path.Combine(current.FullName, "projects", "1-桌面软件", "102-AtlasDesk", "代码", projectDirectory);
                if (Directory.Exists(path)) return path;
                current = current.Parent;
            }
        }
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.0.2 sources.");
    }
}
