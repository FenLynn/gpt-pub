using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V095LifecycleConvergenceChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        RejectFile(nativeRoot, "V064TaskEnhancer.cs");
        RejectFile(nativeRoot, "V065ToolsEnhancer.cs");
        RejectFile(nativeRoot, "TaskToolTypeAliases.cs");

        var coordinatorPath = Path.Combine(nativeRoot, "TaskToolCoordinator.cs");
        RequireTokens(
            coordinatorPath,
            "TaskCenterControl",
            "ToolsCenterControl",
            "ShowTasks",
            "ShowTools",
            "HideBoth",
            "Window_Closing",
            "Window_Closed",
            "WorkbenchTaskHub.Shutdown");

        var pipelinePath = Path.Combine(nativeRoot, "WorkbenchFeaturePipeline.cs");
        RequireTokens(
            pipelinePath,
            "TaskTools = TaskToolCoordinator.Attach(window, this)",
            "public TaskToolCoordinator TaskTools { get; }");
        Reject(File.ReadAllText(pipelinePath), "V064TaskEnhancer", "retired task enhancer remains in pipeline");
        Reject(File.ReadAllText(pipelinePath), "V065ToolsEnhancer", "retired tools enhancer remains in pipeline");

        var shutdownCalls = Directory.EnumerateFiles(nativeRoot, "*.cs", SearchOption.TopDirectoryOnly)
            .Select(File.ReadAllText)
            .Sum(source => Count(source, "WorkbenchTaskHub.Shutdown();"));
        if (shutdownCalls != 1)
            throw new InvalidOperationException($"Expected one task-hub shutdown owner, found {shutdownCalls}.");

        Console.WriteLine("PASS AtlasDesk v0.9.5 task and tool pages have one responsibility-named lifecycle owner");
    }

    private static int Count(string source, string token)
    {
        var count = 0;
        var index = 0;
        while ((index = source.IndexOf(token, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += token.Length;
        }
        return count;
    }

    private static void RejectFile(string root, string fileName)
    {
        if (File.Exists(Path.Combine(root, fileName)))
            throw new InvalidOperationException("Retired lifecycle file remains: " + fileName);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v0.9.5 sources.");
    }

    private static void RequireTokens(string path, params string[] tokens)
    {
        var source = File.ReadAllText(path);
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException($"Missing v0.9.5 token '{token}' in {path}.");
        }
    }

    private static void Reject(string source, string token, string message)
    {
        if (source.Contains(token, StringComparison.Ordinal))
            throw new InvalidOperationException(message + ": " + token);
    }
}
