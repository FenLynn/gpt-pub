using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V120ProjectCockpitChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var versionText = XDocument.Load(Path.Combine(nativeRoot, "Version.props"))
            .Descendants("WorkbenchVersion")
            .Select(node => node.Value.Trim())
            .FirstOrDefault();
        if (!Version.TryParse(versionText, out var version) || version != new Version(1, 2, 0))
            throw new InvalidOperationException("AtlasDesk project cockpit candidate must be v1.2.0.");

        var xaml = File.ReadAllText(RequireFile(nativeRoot, "ProjectCenterControl.xaml"));
        var control = File.ReadAllText(RequireFile(nativeRoot, "ProjectCenterControl.xaml.cs"));
        var workflow = File.ReadAllText(RequireFile(nativeRoot, "ProjectWorkflowCoordinator.cs"));
        var store = File.ReadAllText(RequireFile(nativeRoot, "ProductivityContextStore.cs"));
        var coordinator = File.ReadAllText(RequireFile(nativeRoot, "ProductivityContextCoordinator.cs"));

        RequireContains(xaml,
            "Text=\"项目工作台\"",
            "x:Name=\"OverviewScroll\"",
            "x:Name=\"GitValueText\"",
            "x:Name=\"EnvironmentValueText\"",
            "x:Name=\"RecentValueText\"",
            "x:Name=\"ContextValueText\"",
            "x:Name=\"FavoriteList\"",
            "x:Name=\"CommandList\"",
            "x:Name=\"ResearchList\"",
            "x:Name=\"DashboardButton\"",
            "x:Name=\"ContextButton\"",
            "Content=\"运行选中命令\"",
            "Content=\"复制引用键\"",
            "Content=\"在 Zotero 定位\"");

        RequireContains(control,
            "ContextActionRequested",
            "ProductivityContextStore.FindProfile",
            ".Take(8)",
            "context-edit-current",
            "context-open-dashboard",
            "context-open-favorite",
            "context-run-command",
            "context-open-research",
            "ProjectContextCommandInvocation",
            "ProjectResearchInvocation",
            "ReloadSelectedOverview");
        RequireAbsent(control,
            "SearchOption.AllDirectories",
            "System.Threading.Timer",
            "DispatcherTimer",
            "GetOrCreateProfile(state, project.RootPath)");

        RequireContains(workflow,
            "_projects.ContextActionRequested += ProjectContextActionRequested",
            "ProductivityContextCoordinator.TryExecuteAsync(_window, e.Result)",
            "_projects.ReloadSelectedOverview()",
            "ProjectContextService.ReadAsync",
            "CancelContextRead");
        RequireAbsent(workflow,
            "new ProductivityContextCoordinator",
            "IsVisibleChanged");

        RequireContains(store,
            "%APPDATA%",
            "productivity-context.json",
            "AtomicFileStore.WriteAllText");
        RequireContains(coordinator,
            "Zotero SQLite access stays read-only",
            "context-run-command",
            "context-open-research");

        Console.WriteLine(
            "PASS AtlasDesk v1.2.0 project cockpit aggregates bounded selected-project status, explicit files, commands and read-only literature actions through existing owners");
    }

    private static string RequireFile(string root, params string[] parts)
    {
        var path = parts.Aggregate(root, Path.Combine);
        if (!File.Exists(path))
            throw new InvalidOperationException("Missing v1.2.0 project cockpit source: " + path);
        return path;
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.2.0 project cockpit token: " + token);
        }
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden v1.2.0 project cockpit token returned: " + token);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.2.0 sources.");
    }
}
