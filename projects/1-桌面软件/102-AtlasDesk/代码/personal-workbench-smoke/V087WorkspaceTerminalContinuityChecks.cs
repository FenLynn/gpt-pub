using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V087WorkspaceTerminalContinuityChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");

        RequireTokens(
            Path.Combine(nativeRoot, "AppSettings.cs"),
            "LastTerminalShell",
            "LastTerminalWorkingDirectory",
            "LastTerminalTitle",
            "Directory.Exists(value.LastTerminalWorkingDirectory)");

        var coordinatorPath = Path.Combine(nativeRoot, "WorkspaceTerminalCoordinator.cs");
        var coordinator = File.ReadAllText(coordinatorPath);
        RequireTokens(
            coordinatorPath,
            "_workspace.OpenTerminalRequested += Workspace_OpenTerminalRequested",
            "_development.OpenTerminalRequested += Development_OpenTerminalRequested",
            "WorkspaceTerminalFactory.Create",
            "TerminalLaunchSpec.Create",
            "OpenProjectTerminalAsync",
            "OpenDefaultAsync",
            "ReopenLastAsync",
            "ModifierKeys.Control",
            "ModifierKeys.Shift",
            "Key.R",
            "LastTerminalWorkingDirectory",
            "process automatically; reopening always requires an explicit user action");
        Reject(coordinator, "IsVisibleChanged", "terminal continuity is bound to visibility");
        Reject(coordinator, "Loaded += async", "terminal continuity auto-opens on control load");

        var shell = File.ReadAllText(Path.Combine(nativeRoot, "WorkbenchEnhancer.cs"));
        Reject(shell, "_workspace.OpenTerminalRequested +=",
            "base shell still owns workspace session creation");
        Reject(shell, "_development.OpenTerminalRequested +=",
            "base shell still owns development session creation");
        Reject(shell, "_terminal.OpenShellAsync(_settings.DefaultShell)",
            "base shell still creates Ctrl+Shift+T sessions");

        var projectWorkflowPath = Path.Combine(nativeRoot, "ProjectWorkflowCoordinator.cs");
        var projectWorkflow = File.ReadAllText(projectWorkflowPath);
        RequireTokens(
            projectWorkflowPath,
            "_pipeline.WorkspaceTerminal.OpenProjectTerminalAsync",
            "reopenLast");
        Reject(projectWorkflow, "_terminal.OpenAsync(WorkspaceTerminalFactory.Create",
            "project workflow bypasses the terminal continuity owner");

        RequireTokens(
            Path.Combine(nativeRoot, "WorkbenchFeaturePipeline.cs"),
            "WorkspaceTerminal = WorkspaceTerminalCoordinator.Attach(window, this)",
            "public WorkspaceTerminalCoordinator WorkspaceTerminal { get; }");

        Console.WriteLine(
            "PASS AtlasDesk v0.8.7 workspace, development and project terminals use one explicit continuity owner");
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v0.8.7 sources.");
    }

    private static void RequireTokens(string path, params string[] tokens)
    {
        var source = File.ReadAllText(path);
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException($"Missing v0.8.7 token '{token}' in {path}.");
        }
    }

    private static void Reject(string source, string token, string message)
    {
        if (source.Contains(token, StringComparison.Ordinal))
            throw new InvalidOperationException(message + ": " + token);
    }
}
