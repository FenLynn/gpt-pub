using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V094TaskToolBridgeChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        RequireTokens(
            Path.Combine(nativeRoot, "WorkbenchTaskHub.cs"),
            "WorkbenchTaskHub",
            "WorkbenchTaskHandle",
            "FileIntegrityTaskBridge",
            "ExecutionSlots",
            "WorkbenchTaskStore.Save",
            "CancelAll");
        RequireTokens(
            Path.Combine(nativeRoot, "ToolsCenterControl.xaml.cs"),
            "FileIntegrityTaskBridge.Start",
            "任务同时显示在任务中心",
            "任务已写入统一历史",
            "FileIntegrityTaskBridge.Cancel");
        RequireTokens(
            Path.Combine(nativeRoot, "TaskCenterControl.xaml.cs"),
            "WorkbenchTaskHub.Service",
            "FileIntegrityTaskBridge.Cancel");
        RequireTokens(
            Path.Combine(nativeRoot, "TaskToolCoordinator.cs"),
            "Window_Closing",
            "仍有 {active} 个任务",
            "WorkbenchTaskHub.Shutdown");

        VerifySharedRecord();
        Console.WriteLine("PASS AtlasDesk v0.9.4 tools and task center share records, cancellation and bounded history");
    }

    private static void VerifySharedRecord()
    {
        WorkbenchTaskHub.Shutdown();
        try
        {
            var handle = FileIntegrityTaskBridge.Start(
                "smoke integrity task",
                Path.GetTempPath(),
                (_, token) =>
                {
                    token.ThrowIfCancellationRequested();
                    return Task.FromResult("bridge-ok");
                });
            var record = handle.Completion.ConfigureAwait(false).GetAwaiter().GetResult();
            if (record.State != WorkbenchTaskState.Completed
                || record.Result != "bridge-ok"
                || !WorkbenchTaskHub.Service.Tasks.Any(item => item.Id == record.Id))
            {
                throw new InvalidOperationException("Shared integrity task did not reach the common task collection.");
            }

            var serialized = WorkbenchTaskStore.Serialize(WorkbenchTaskHub.Service.Tasks.Take(100));
            if (!serialized.Contains("bridge-ok", StringComparison.Ordinal))
                throw new InvalidOperationException("Shared integrity task was not serializable into bounded history.");
        }
        finally
        {
            WorkbenchTaskHub.Shutdown();
        }
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v0.9.4 sources.");
    }

    private static void RequireTokens(string path, params string[] tokens)
    {
        var source = File.ReadAllText(path);
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException($"Missing v0.9.4 token '{token}' in {path}.");
        }
    }
}
