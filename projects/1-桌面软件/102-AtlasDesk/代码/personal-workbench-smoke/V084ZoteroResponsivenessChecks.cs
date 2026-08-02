using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V084ZoteroResponsivenessChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        VerifyBackgroundScheduler();
        VerifySourceBoundaries();
        Console.WriteLine(
            "PASS AtlasDesk v0.8.4 Zotero background-read and explicit-navigation boundaries");
    }

    private static void VerifyBackgroundScheduler()
    {
        var callerThread = Environment.CurrentManagedThreadId;
        var workerThread = ZoteroReadScheduler.RunAsync(
                () => Task.FromResult(Environment.CurrentManagedThreadId))
            .WaitAsync(TimeSpan.FromSeconds(5))
            .GetAwaiter()
            .GetResult();

        if (workerThread == callerThread)
        {
            throw new InvalidOperationException(
                "ZoteroReadScheduler executed SQLite-shaped work on the caller thread.");
        }
    }

    private static void VerifySourceBoundaries()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var controlPath = Path.Combine(nativeRoot, "ZoteroLibraryControl.xaml.cs");
        var control = File.ReadAllText(controlPath);

        RequireTokens(
            controlPath,
            "Database access is deliberately not bound to IsVisibleChanged",
            "SemaphoreSlim _databaseGate",
            "ZoteroReadScheduler.RunAsync",
            "foreach (var collectionId in collectionIds)",
            "正在后台读取 Zotero 分类与元信息",
            "正在后台检索");
        Reject(
            control,
            "IsVisibleChanged +=",
            "Zotero loading was rebound to visibility changes");
        Reject(
            control,
            "Task.WhenAll(collectionIds",
            "parallel descendant-collection SQLite reads were reintroduced");

        var schedulerPath = Path.Combine(nativeRoot, "ZoteroReadScheduler.cs");
        RequireTokens(
            schedulerPath,
            "Microsoft.Data.Sqlite exposes async-shaped APIs",
            "return Task.Run(async () =>",
            "ConfigureAwait(false)");

        var enhancerPath = Path.Combine(nativeRoot, "WorkbenchEnhancer.cs");
        RequireTokens(
            enhancerPath,
            "FindName(\"LibraryNav\")",
            "libraryNav.Checked += async",
            "private async Task ShowZoteroAsync()",
            "await _zotero.EnsureLoadedAsync()");
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

        throw new DirectoryNotFoundException(
            "Unable to locate the AtlasDesk source tree for v0.8.4 Zotero checks.");
    }

    private static void RequireTokens(string path, params string[] tokens)
    {
        var source = File.ReadAllText(path);
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Missing required AtlasDesk v0.8.4 token '{token}' in {path}.");
            }
        }
    }

    private static void Reject(string source, string token, string message)
    {
        if (source.Contains(token, StringComparison.Ordinal))
            throw new InvalidOperationException(message + ": " + token);
    }
}
