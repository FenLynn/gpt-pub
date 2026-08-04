using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V1112ShellHomeSimplificationChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var versionText = XDocument.Load(Path.Combine(nativeRoot, "Version.props"))
            .Descendants("WorkbenchVersion")
            .Select(node => node.Value.Trim())
            .FirstOrDefault();
        if (!Version.TryParse(versionText, out var version) || version != new Version(1, 1, 12))
            throw new InvalidOperationException("AtlasDesk shell/home simplification candidate must be v1.1.12.");

        var app = File.ReadAllText(RequireFile(nativeRoot, "App.xaml"));
        var coordinator = File.ReadAllText(RequireFile(nativeRoot, "SidebarTerminalVisualCoordinator.cs"));
        var home = File.ReadAllText(RequireFile(nativeRoot, "HomeDashboardControl.xaml"));
        var notes = File.ReadAllText(RequireFile(nativeRoot, "RELEASE_NOTES.txt"));

        RequireContains(app,
            "<Setter Property=\"Height\" Value=\"34\"/><Setter Property=\"Margin\" Value=\"0,1\"/><Setter Property=\"Padding\" Value=\"10,0,4,0\"/>",
            "<Setter Property=\"FontSize\" Value=\"13\"/>",
            "<Setter Property=\"Padding\" Value=\"10,4\"/>",
            "<Setter Property=\"Width\" Value=\"27\"/><Setter Property=\"Height\" Value=\"27\"/>");

        RequireContains(coordinator,
            "collapsed ? 48 : 208",
            "_sidebarLayout.Margin = collapsed ? new Thickness(4, 6, 4, 6)",
            "button.Height = collapsed ? 30 : 34",
            "icon.Width = collapsed ? 15 : 16",
            "_userAvatar.Width = collapsed ? 24 : 26",
            "string.Equals(text.Text?.Replace(\" \", string.Empty), \"CtrlK\"",
            "搜索页面、项目、文件、任务、文献和命令（Ctrl+K）",
            "M9.5,3.5 H14.5",
            "_topBarRow.Height = new GridLength(36)",
            "tab.Height = 30",
            "QueueShellVisuals");

        RequireContains(home,
            "x:Key=\"HomeActionButton\"",
            "x:Key=\"HomeStatusCell\"",
            "x:Name=\"GreetingText\"",
            "FontSize=\"18\"",
            "Text=\"当前工作区\"",
            "Content=\"工作区\"",
            "Content=\"Dashboard\"",
            "Content=\"资料库\"",
            "Content=\"开发\"",
            "Content=\"终端\"",
            "Content=\"全局搜索\"",
            "x:Name=\"DashboardValue\"",
            "x:Name=\"ZoteroValue\"",
            "x:Name=\"PythonValue\"",
            "x:Name=\"WorkspaceValue\"",
            "x:Name=\"RecentFilesList\"");
        RequireAbsent(home,
            "ATLASDESK  ·  TODAY",
            "MinHeight=\"166\"",
            "LinearGradientBrush",
            "HomeMetricCard",
            "快捷入口",
            "常用动作保持在首页",
            "本地优先 · 工作区");

        RequireContains(notes,
            "AtlasDesk v1.1.12 shell and home simplification",
            "48-pixel icon rail",
            "visible Ctrl+K badge",
            "unambiguous gear glyph",
            "main remains the formal v1.0.0 baseline");

        Console.WriteLine(
            "PASS AtlasDesk v1.1.12 uses a narrow icon rail, compact navigation, clean command entry, clear settings glyph and simplified three-layer home");
    }

    private static string RequireFile(string root, params string[] parts)
    {
        var path = parts.Aggregate(root, Path.Combine);
        if (!File.Exists(path))
            throw new InvalidOperationException("Missing v1.1.12 shell/home source: " + path);
        return path;
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.1.12 shell/home token: " + token);
        }
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Retired v1.1.12 visual clutter returned: " + token);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.1.12 sources.");
    }
}
