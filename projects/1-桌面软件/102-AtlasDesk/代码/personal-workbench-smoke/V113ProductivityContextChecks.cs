using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V113ProductivityContextChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var versionPath = Path.Combine(nativeRoot, "Version.props");
        var versionText = XDocument.Load(versionPath)
            .Descendants("WorkbenchVersion")
            .Select(node => node.Value.Trim())
            .FirstOrDefault();
        if (!Version.TryParse(versionText, out var version) || version != new Version(1, 1, 3))
            throw new InvalidOperationException("AtlasDesk productivity-context candidate must be v1.1.3.");

        var storePath = RequireFile(nativeRoot, "ProductivityContextStore.cs");
        var coordinatorPath = RequireFile(nativeRoot, "ProductivityContextCoordinator.cs");
        var editorPath = RequireFile(nativeRoot, "ProjectContextWindow.cs");
        var pipelinePath = RequireFile(nativeRoot, "WorkbenchFeaturePipeline.cs");
        var searchWindowPath = RequireFile(nativeRoot, "GlobalSearchWindow.xaml.cs");
        var experiencePath = RequireFile(nativeRoot, "V061ExperienceEnhancer.cs");
        var projectWorkflowPath = RequireFile(nativeRoot, "ProjectWorkflowCoordinator.cs");
        var zoteroSearchPath = RequireFile(nativeRoot, "ZoteroLibraryControl.Search.cs");
        var zoteroReferencePath = RequireFile(nativeRoot, "ZoteroLibraryControl.ReferencePane.cs");
        var releaseNotesPath = RequireFile(nativeRoot, "RELEASE_NOTES.txt");

        var store = File.ReadAllText(storePath);
        var coordinator = File.ReadAllText(coordinatorPath);
        var editor = File.ReadAllText(editorPath);
        var pipeline = File.ReadAllText(pipelinePath);
        var searchWindow = File.ReadAllText(searchWindowPath);
        var experience = File.ReadAllText(experiencePath);
        var projectWorkflow = File.ReadAllText(projectWorkflowPath);
        var zoteroSearch = File.ReadAllText(zoteroSearchPath);
        var zoteroReference = File.ReadAllText(zoteroReferencePath);
        var releaseNotes = File.ReadAllText(releaseNotesPath);

        RequireContains(store,
            "productivity-context.json",
            "BackupPath",
            "AtomicFileStore.WriteAllText",
            "LoadFile(StatePath) ?? LoadFile(BackupPath)",
            "Load productivity context file failed",
            "RestoreLastSession",
            "ProjectContextProfile",
            "ProjectContextCommand",
            "ProjectResearchLink",
            "BuildSearchResults",
            "ResearchLinks",
            "Command = \"cd .\"",
            "var hasQuery = text.Length > 0");
        RequireContains(coordinator,
            "public sealed class ProductivityContextCoordinator",
            "TryExecuteAsync",
            "InstallContextButton",
            "InstallZoteroProjectLinkButton",
            "App.IsSafeMode",
            "RestoreSessionAsync",
            "Window_Closing",
            "InitialInput = baseSpec.InitialInput + command.Command.Trim() + \"\\r\"",
            "SelectedRecord",
            "CurrentCitationKey",
            "ApplyExternalSearchAsync");
        RequireAbsent(coordinator,
            "SqliteConnection",
            "SqliteCommand",
            "UPDATE zotero",
            "INSERT INTO zotero",
            "DELETE FROM zotero",
            "TerminalOutput",
            "WebView2Profile");

        RequireContains(editor,
            "项目上下文",
            "启动与命令",
            "关联文献",
            "Zotero 数据库继续严格只读",
            "名称 :: 命令 :: 可选工作目录",
            "line.Split(new[] { \"::\" }, 3",
            "AccessibilityCoordinator.PrepareWindow(this)",
            "AutomationProperties.SetName(control, label)",
            "ProductivityContextStore.Save");
        RequireContains(searchWindow,
            "CommandCenterCatalog.SearchAsync",
            "ProductivityContextStore.BuildSearchResults",
            "Task.WhenAll(catalogTask, contextTask)",
            ".Concat(catalogTask.Result)");
        RequireContains(experience,
            "ProductivityContextCoordinator.TryExecuteAsync",
            "搜索页面、项目、文件、任务、文献、上下文和命令");
        RequireContains(projectWorkflow,
            "public ProjectDescriptor? SelectedProject => _projects.SelectedProject");
        RequireContains(zoteroSearch,
            "public string CurrentSearchQuery");
        RequireContains(zoteroReference,
            "public ZoteroRecord? SelectedRecord",
            "public string CurrentCitationKey");
        RequireContains(releaseNotes,
            "AtlasDesk v1.1.3 productivity-context candidate",
            "v1.1.0 - Command Center context",
            "v1.1.1 - Project context profiles",
            "v1.1.2 - Safe session continuation",
            "v1.1.3 - Project and Zotero bridge",
            "%APPDATA%\\AtlasDesk\\productivity-context.json",
            "main remains the formal v1.0.0 baseline");

        RequireContains(pipeline,
            "ProductivityContext = ProductivityContextCoordinator.Attach(window, this)",
            "public ProductivityContextCoordinator ProductivityContext { get; }",
            "Accessibility = AccessibilityCoordinator.Attach(window)");
        var productivityIndex = pipeline.IndexOf(
            "ProductivityContext = ProductivityContextCoordinator.Attach(window, this)",
            StringComparison.Ordinal);
        var accessibilityIndex = pipeline.IndexOf(
            "Accessibility = AccessibilityCoordinator.Attach(window)",
            StringComparison.Ordinal);
        if (productivityIndex < 0 || accessibilityIndex <= productivityIndex)
            throw new InvalidOperationException("Accessibility must remain the final presentation owner after productivity context attaches.");

        Console.WriteLine(
            "PASS AtlasDesk v1.1.3 connects Command Center, project profiles, safe session continuation and read-only Zotero links without adding a versioned enhancer");
    }

    private static string RequireFile(string root, string fileName)
    {
        var path = Path.Combine(root, fileName);
        if (!File.Exists(path))
            throw new InvalidOperationException("Missing v1.1.3 productivity-context source: " + fileName);
        return path;
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.1.3 productivity-context token: " + token);
        }
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden v1.1.3 productivity-context token returned: " + token);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.1.3 sources.");
    }
}
