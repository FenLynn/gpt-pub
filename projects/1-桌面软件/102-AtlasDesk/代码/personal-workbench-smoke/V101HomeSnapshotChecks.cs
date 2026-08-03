using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V101HomeSnapshotChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var homeSource = File.ReadAllText(Path.Combine(nativeRoot, "HomeDashboardControl.xaml.cs"));
        var snapshotSource = File.ReadAllText(Path.Combine(nativeRoot, "HomeSnapshotService.cs"));
        var taskHubSource = File.ReadAllText(Path.Combine(nativeRoot, "WorkbenchTaskHub.cs"));

        RequireContains(homeSource,
            "HomeSnapshotService.ReadAsync",
            "WorkbenchTaskHub.Current",
            "CancelRefresh",
            "ConfigureMetricCard");
        RequireAbsent(homeSource,
            "ZoteroLibrary.ReadSnapshotAsync",
            "ProjectCatalogService.Scan",
            "ProjectContextService",
            "Process.Start",
            "ReadGitBranch");
        RequireContains(snapshotSource,
            "Task.Run",
            "WorkbenchTaskStore.Load",
            "PinnedProjectPaths",
            "RecentProjectPaths",
            "RecentWorkspaceFiles");
        RequireAbsent(snapshotSource,
            "ZoteroLibrary",
            "ProjectCatalogService.Scan",
            "Process.Start",
            "git status");
        RequireContains(taskHubSource, "public static WorkbenchTaskService? Current");

        VerifyRealSnapshot();
        Console.WriteLine("PASS AtlasDesk v1.0.1 home uses bounded saved-state snapshots without Zotero, Git or project scans");
    }

    private static void VerifyRealSnapshot()
    {
        var root = Path.Combine(Path.GetTempPath(), "AtlasDesk-v101-home-" + Guid.NewGuid().ToString("N"));
        var workspace = Path.Combine(root, "workspace");
        var pinned = Path.Combine(root, "pinned");
        var recent = Path.Combine(root, "recent");
        var missing = Path.Combine(root, "missing");
        var file = Path.Combine(workspace, "note.md");
        var zotero = Path.Combine(root, "zotero.sqlite");

        Directory.CreateDirectory(workspace);
        Directory.CreateDirectory(pinned);
        Directory.CreateDirectory(recent);
        File.WriteAllText(file, "# smoke");
        File.WriteAllBytes(zotero, Array.Empty<byte>());

        try
        {
            var settings = new AppSettings
            {
                WorkspaceRoot = workspace,
                DashboardUrl = "https://example.com/dashboard",
                ZoteroDbPath = zotero,
                ZoteroLoadFullLibrary = false,
                ZoteroCalibrationLimit = 250,
                PinnedProjectPaths = new List<string> { pinned, missing },
                RecentProjectPaths = new List<string> { recent, missing },
                RecentWorkspaceFiles = new List<string> { file, Path.Combine(root, "gone.md") }
            };
            var tasks = new[]
            {
                new HomeTaskDescriptor(WorkbenchTaskState.Running, "running", DateTimeOffset.Now),
                new HomeTaskDescriptor(WorkbenchTaskState.Completed, "completed", DateTimeOffset.Now.AddMinutes(-1)),
                new HomeTaskDescriptor(WorkbenchTaskState.Failed, "failed", DateTimeOffset.Now.AddMinutes(-2))
            };

            var snapshot = HomeSnapshotService.ReadAsync(settings, tasks)
                .ConfigureAwait(false)
                .GetAwaiter()
                .GetResult();

            if (!snapshot.WorkspaceAvailable
                || snapshot.WorkspacePath != workspace
                || !snapshot.DashboardConfigured
                || snapshot.DashboardHost != "example.com"
                || !snapshot.ZoteroConfigured
                || snapshot.PinnedProjectCount != 1
                || snapshot.RecentProjectCount != 1
                || snapshot.MissingProjectCount != 1
                || snapshot.ActiveTaskCount != 1
                || snapshot.TaskHistoryCount != 3
                || snapshot.ProblemTaskCount != 1
                || snapshot.RecentWorkspaceFiles.Count != 1
                || snapshot.RecentWorkspaceFiles[0] != file)
            {
                throw new InvalidOperationException("v1.0.1 home snapshot did not preserve the bounded saved-state contract.");
            }
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
                throw new InvalidOperationException("Missing v1.0.1 home token: " + token);
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden v1.0.1 home token returned: " + token);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.0.1 sources.");
    }
}
