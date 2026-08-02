using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V090ProjectWorkflowChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");

        if (File.Exists(Path.Combine(nativeRoot, "V070ProjectCenterEnhancer.cs")))
            throw new InvalidOperationException("V070ProjectCenterEnhancer was not retired.");
        if (File.Exists(Path.Combine(nativeRoot, "V070RuntimeVerifier.cs")))
            throw new InvalidOperationException("V070RuntimeVerifier was not retired.");

        var contextPath = Path.Combine(nativeRoot, "ProjectContextService.cs");
        var contextSource = File.ReadAllText(contextPath);
        RequireTokens(
            contextPath,
            "Task.Run",
            "WaitForExitAsync",
            "CancelAfter(GitTimeout)",
            "Kill(entireProcessTree: true)",
            "--untracked-files=no",
            "Git 状态读取超时",
            "never scans every project",
            "never launches language runtimes");
        Reject(contextSource, "SearchOption.AllDirectories",
            "project context recursively scans the selected project");
        Reject(contextSource, "IsVisibleChanged",
            "project context is bound to visibility");

        var workflowPath = Path.Combine(nativeRoot, "ProjectWorkflowCoordinator.cs");
        var workflow = File.ReadAllText(workflowPath);
        RequireTokens(
            workflowPath,
            "ProjectSelectionChanged += ProjectSelectionChanged",
            "Interlocked.Increment(ref _contextGeneration)",
            "ProjectContextService.ReadAsync",
            "generation != Interlocked.Read(ref _contextGeneration)",
            "Dispatcher.InvokeAsync",
            "CancelContextRead",
            "OpenFromGlobalSearchAsync",
            "WorkspaceTerminal.OpenProjectTerminalAsync",
            "Header = \"项目\"",
            "Header = \"环境\"",
            "Header = \"终端\"",
            "_tabs.SelectedIndex = ProjectTabIndex",
            "_tabs.SelectionChanged += Tabs_SelectionChanged");
        Reject(workflow, "IsVisibleChanged", "project workflow starts from visibility");
        RequireOrder(
            workflow,
            "_tabs = BuildTabs();",
            "_tabs.SelectedIndex = ProjectTabIndex;",
            "_tabs.SelectionChanged += Tabs_SelectionChanged;");

        var projectControlPath = Path.Combine(nativeRoot, "ProjectCenterControl.xaml.cs");
        var projectControl = File.ReadAllText(projectControlPath);
        RequireTokens(
            projectControlPath,
            "ProjectSelectionChanged",
            "ShowContextLoading",
            "ApplyContext",
            "SelectedProject",
            "Project discovery is intentionally not bound to Loaded or visibility");
        Reject(projectControl, "Loaded += ProjectCenterControl_Loaded",
            "project discovery still starts during control load");
        Reject(projectControl, "ProjectCenterControl_Loaded(",
            "obsolete project Loaded handler remains");

        RequireTokens(
            Path.Combine(nativeRoot, "WorkbenchFeaturePipeline.cs"),
            "ProjectWorkflow = ProjectWorkflowCoordinator.Attach(window, this)",
            "public ProjectWorkflowCoordinator ProjectWorkflow { get; }");

        VerifyLocalContextAsync().GetAwaiter().GetResult();
        Console.WriteLine(
            "PASS AtlasDesk v0.9.0 explicit project selection drives bounded context, workspace and terminal workflow");
    }

    private static async Task VerifyLocalContextAsync()
    {
        var root = Path.Combine(Path.GetTempPath(), "atlasdesk-project-context-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            File.WriteAllText(Path.Combine(root, "pyproject.toml"), "[project]\nname='smoke'");
            var recent = Path.Combine(root, "notes.md");
            File.WriteAllText(recent, "smoke");
            var descriptor = ProjectCatalogService.Detect(root, root)
                             ?? throw new InvalidOperationException("Project descriptor smoke detection failed.");
            var settings = new AppSettings { RecentWorkspaceFiles = new List<string> { recent } };
            var context = await ProjectContextService.ReadAsync(descriptor, settings, CancellationToken.None);
            if (!context.EnvironmentSummary.Contains("Python", StringComparison.Ordinal)
                || !context.RecentFilesSummary.Contains("1", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Project context did not preserve environment and recent-file summaries.");
            }
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { }
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
                if (Directory.Exists(path)) return path;
                current = current.Parent;
            }
        }
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v0.9.0 sources.");
    }

    private static void RequireTokens(string path, params string[] tokens)
    {
        var source = File.ReadAllText(path);
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException($"Missing v0.9.0 token '{token}' in {path}.");
        }
    }

    private static void RequireOrder(string source, params string[] tokens)
    {
        var previous = -1;
        foreach (var token in tokens)
        {
            var current = source.IndexOf(token, previous + 1, StringComparison.Ordinal);
            if (current < 0)
                throw new InvalidOperationException("Missing v0.9.0 order token: " + token);
            if (current <= previous)
                throw new InvalidOperationException("Invalid v0.9.0 initialization order near: " + token);
            previous = current;
        }
    }

    private static void Reject(string source, string token, string message)
    {
        if (source.Contains(token, StringComparison.Ordinal))
            throw new InvalidOperationException(message + ": " + token);
    }
}
