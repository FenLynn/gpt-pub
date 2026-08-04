using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V1111SidebarTerminalPolishChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var versionText = XDocument.Load(Path.Combine(nativeRoot, "Version.props"))
            .Descendants("WorkbenchVersion")
            .Select(node => node.Value.Trim())
            .FirstOrDefault();
        if (!Version.TryParse(versionText, out var version) || version != new Version(1, 1, 11))
            throw new InvalidOperationException("AtlasDesk sidebar/terminal polish candidate must be v1.1.11.");

        var pipeline = File.ReadAllText(RequireFile(nativeRoot, "WorkbenchFeaturePipeline.cs"));
        var coordinator = File.ReadAllText(RequireFile(nativeRoot, "V1111VisualPolishCoordinator.cs"));
        var terminalXaml = File.ReadAllText(RequireFile(nativeRoot, "TerminalDrawerControl.xaml"));
        var terminalHtml = File.ReadAllText(RequireFile(nativeRoot, "TerminalAssets", "terminal.html"));
        var terminalJs = File.ReadAllText(RequireFile(nativeRoot, "TerminalAssets", "terminal-host.js"));
        var floating = File.ReadAllText(RequireFile(nativeRoot, "TerminalFloatingWindow.cs"));
        var notes = File.ReadAllText(RequireFile(nativeRoot, "RELEASE_NOTES.txt"));

        RequireContains(pipeline,
            "ProductivityContext = ProductivityContextCoordinator.Attach(window, this)",
            "VisualPolish = V1111VisualPolishCoordinator.Attach(window, this)",
            "public V1111VisualPolishCoordinator VisualPolish { get; }");
        RequireOrder(
            pipeline,
            "ProductivityContext = ProductivityContextCoordinator.Attach(window, this)",
            "VisualPolish = V1111VisualPolishCoordinator.Attach(window, this)",
            "Accessibility = AccessibilityCoordinator.Attach(window)");

        RequireContains(coordinator,
            "Equals(button.Tag, \"productivity-context\")",
            "Grid.SetRow(contextButton, Grid.GetRow(commandButton))",
            "contextButton.HorizontalAlignment = HorizontalAlignment.Right",
            "contextButton.ToolTip = \"项目上下文\"",
            "commandButton.Margin = new Thickness(0, 2, 38, 2)",
            "CreateProjectContextIcon",
            "new ShapePath",
            "_terminal.Loaded += Terminal_Loaded",
            "DispatcherPriority.ContextIdle",
            "_terminalHost.Background = Brushes.Black",
            "Color.FromRgb(13, 19, 32)",
            "ApplyTerminalButton(button)",
            "TerminalButtonText");

        RequireContains(terminalXaml,
            "Background=\"#000000\"",
            "Background=\"#0A0A0A\"",
            "Background=\"#0D0D0D\"",
            "Foreground=\"#F5F5F5\"",
            "BorderBrush=\"#4A4A4A\"",
            "Text=\"{TemplateBinding Content}\" Foreground=\"{TemplateBinding Foreground}\"",
            "<UniformGrid Columns=\"2\"",
            "Width=\"236\"",
            "Content=\"CMD\" Width=\"58\"",
            "Content=\"PowerShell\" Width=\"88\"");
        RequireAbsent(terminalXaml,
            "#0D1320",
            "#111A29",
            "#263B58",
            "#1D2D43",
            "#35577F");

        RequireContains(terminalHtml,
            "background: #000000",
            "background: #3a3a3a",
            "border: 2px solid #000000");
        RequireAbsent(terminalHtml, "#0d1320", "#33445d");

        RequireContains(terminalJs,
            "background: '#000000'",
            "foreground: '#f2f2f2'",
            "cursor: '#ffffff'",
            "selectionBackground: '#66666680'",
            "brightWhite: '#ffffff'");
        RequireAbsent(terminalJs, "#0d1320", "#355a8f99", "#6da8ff");

        RequireContains(floating,
            "Background = Brushes.Black",
            "Color.FromRgb(10, 10, 10)",
            "Color.FromRgb(245, 245, 245)",
            "Color.FromRgb(74, 74, 74)");
        RequireAbsent(floating,
            "Color.FromRgb(13, 19, 32)",
            "Color.FromRgb(17, 26, 41)",
            "Color.FromRgb(26, 38, 56)");

        RequireContains(notes,
            "AtlasDesk v1.1.11 sidebar and terminal visual polish",
            "project-context shortcut",
            "pure-black CMD terminal theme",
            "main remains the formal v1.0.0 baseline");

        Console.WriteLine(
            "PASS AtlasDesk v1.1.11 moves the project-context shortcut out of the brand row and applies a pure-black CMD terminal theme with explicit light button text");
    }

    private static string RequireFile(string root, params string[] parts)
    {
        var path = parts.Aggregate(root, Path.Combine);
        if (!File.Exists(path))
            throw new InvalidOperationException("Missing v1.1.11 visual-polish source: " + path);
        return path;
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.1.11 visual-polish token: " + token);
        }
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Retired v1.1.11 visual token returned: " + token);
        }
    }

    private static void RequireOrder(string source, params string[] tokens)
    {
        var previous = -1;
        foreach (var token in tokens)
        {
            var current = source.IndexOf(token, previous + 1, StringComparison.Ordinal);
            if (current < 0 || current <= previous)
                throw new InvalidOperationException("Invalid v1.1.11 pipeline order near: " + token);
            previous = current;
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.1.11 sources.");
    }
}
