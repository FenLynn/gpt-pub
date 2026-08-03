using System.Runtime.CompilerServices;
using System.Text.Json;

namespace PersonalWorkbench.Smoke;

internal static class V103FinalReliabilityChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var appSource = File.ReadAllText(Path.Combine(nativeRoot, "App.xaml.cs"));
        var performanceSource = File.ReadAllText(Path.Combine(nativeRoot, "PerformanceBaselineService.cs"));
        var logSource = File.ReadAllText(Path.Combine(nativeRoot, "LogMaintenance.cs"));
        var diagnosticsSource = File.ReadAllText(Path.Combine(nativeRoot, "DiagnosticsService.cs"));
        var coordinatorSource = File.ReadAllText(Path.Combine(nativeRoot, "DiagnosticsCoordinator.cs"));
        var pipelineSource = File.ReadAllText(Path.Combine(nativeRoot, "WorkbenchFeaturePipeline.cs"));

        RequireContains(appSource,
            "LogMaintenance.Prepare(LogPath)",
            "PerformanceBaselineService.Begin",
            "PerformanceBaselineService.MarkMainWindowLoaded",
            "PerformanceBaselineService.MarkPipelineAttached");
        RequireContains(performanceSource,
            "public const int MaxHistory = 20",
            "AppendBoundedHistory",
            "TakeLast(limit)",
            "WorkingSetBytes");
        RequireAbsent(performanceSource,
            "WorkspaceRoot",
            "DashboardUrl",
            "RecentWorkspaceFiles",
            "Terminal",
            "Command");
        RequireContains(logSource,
            "DefaultMaxBytes = 4L * 1024 * 1024",
            "DefaultArchiveCount = 2",
            "RotateIfNeeded",
            "File.Move");
        RequireContains(diagnosticsSource,
            "CheckPerformance",
            "startup-performance.json",
            "PerformanceBaselineService.ReadHistory",
            "LogMaintenance.DefaultArchiveCount");
        RequireContains(coordinatorSource,
            "public sealed class DiagnosticsCoordinator : IDisposable",
            "_window.Closed += Window_Closed",
            "_diagnosticsWindow?.Close()",
            "diagnostics-coordinator");
        RequireContains(pipelineSource,
            "Diagnostics = DiagnosticsCoordinator.Attach",
            "public DiagnosticsCoordinator Diagnostics");
        RequireAbsent(pipelineSource, "V062StabilityEnhancer");
        if (File.Exists(Path.Combine(nativeRoot, "V062StabilityEnhancer.cs")))
            throw new InvalidOperationException("Retired V062StabilityEnhancer returned in v1.0.3.");

        VerifyBoundedPerformanceHistory();
        VerifyLogRotation();
        VerifyPerformancePayloadPrivacy();
        Console.WriteLine("PASS AtlasDesk v1.0.3 bounds privacy-safe startup baselines, rotates logs and owns diagnostics lifecycle explicitly");
    }

    private static void VerifyBoundedPerformanceHistory()
    {
        var root = Path.Combine(Path.GetTempPath(), "AtlasDesk-v103-performance-" + Guid.NewGuid().ToString("N"));
        var path = Path.Combine(root, "performance.json");
        Directory.CreateDirectory(root);
        try
        {
            var start = DateTimeOffset.UtcNow.AddMinutes(-30);
            for (var index = 0; index < 25; index++)
            {
                PerformanceBaselineService.AppendBoundedHistory(
                    path,
                    new StartupPerformanceSample(
                        "1.0.3",
                        start.AddMinutes(index),
                        false,
                        100 + index,
                        200 + index,
                        (128L + index) * 1024 * 1024),
                    20);
            }

            var history = PerformanceBaselineService.ReadHistory(path);
            if (history.Count != 20
                || history[0].PipelineAttachedMs != 205
                || history[^1].PipelineAttachedMs != 224)
            {
                throw new InvalidOperationException("Startup performance history did not preserve the newest bounded samples.");
            }

            var summary = PerformanceBaselineService.GetSummary(path);
            if (summary.SampleCount != 20
                || summary.Latest?.PipelineAttachedMs != 224
                || summary.MedianPipelineAttachedMs <= 0)
            {
                throw new InvalidOperationException("Startup performance summary is invalid.");
            }
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { }
        }
    }

    private static void VerifyLogRotation()
    {
        var root = Path.Combine(Path.GetTempPath(), "AtlasDesk-v103-log-" + Guid.NewGuid().ToString("N"));
        var path = Path.Combine(root, "atlasdesk.log");
        Directory.CreateDirectory(root);
        try
        {
            File.WriteAllText(path, new string('A', 2048));
            if (!LogMaintenance.RotateIfNeeded(path, 1024, 2)
                || File.Exists(path)
                || !File.Exists(LogMaintenance.ArchivePath(path, 1)))
            {
                throw new InvalidOperationException("First log rotation failed.");
            }

            File.WriteAllText(path, new string('B', 2048));
            if (!LogMaintenance.RotateIfNeeded(path, 1024, 2)
                || !File.Exists(LogMaintenance.ArchivePath(path, 1))
                || !File.Exists(LogMaintenance.ArchivePath(path, 2))
                || File.ReadAllText(LogMaintenance.ArchivePath(path, 1))[0] != 'B'
                || File.ReadAllText(LogMaintenance.ArchivePath(path, 2))[0] != 'A')
            {
                throw new InvalidOperationException("Bounded multi-generation log rotation failed.");
            }
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { }
        }
    }

    private static void VerifyPerformancePayloadPrivacy()
    {
        var json = JsonSerializer.Serialize(new StartupPerformanceSample(
            "1.0.3",
            DateTimeOffset.UtcNow,
            false,
            120,
            240,
            256L * 1024 * 1024));
        foreach (var forbidden in new[] { "path", "url", "user", "command", "workspace", "terminal" })
        {
            if (json.Contains(forbidden, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Performance payload exposed a forbidden field: " + forbidden);
        }
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.0.3 final reliability token: " + token);
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden v1.0.3 final reliability token returned: " + token);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.0.3 sources.");
    }
}
