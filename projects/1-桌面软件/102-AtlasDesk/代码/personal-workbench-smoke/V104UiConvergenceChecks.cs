using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V104UiConvergenceChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var projectRoot = Directory.GetParent(nativeRoot)?.FullName
                          ?? throw new DirectoryNotFoundException("AtlasDesk code root is unavailable.");
        var themePath = Path.Combine(nativeRoot, "UiConvergenceResources.xaml");
        var coordinatorPath = Path.Combine(nativeRoot, "UiConvergenceCoordinator.cs");
        var experiencePath = Path.Combine(nativeRoot, "V061ExperienceEnhancer.cs");
        var pipelinePath = Path.Combine(nativeRoot, "WorkbenchFeaturePipeline.cs");
        var diagnosticsXamlPath = Path.Combine(nativeRoot, "DiagnosticsWindow.xaml");
        var diagnosticsCodePath = Path.Combine(nativeRoot, "DiagnosticsWindow.xaml.cs");
        var residencyPath = Path.Combine(projectRoot, "personal-workbench-residency-smoke", "Program.cs");

        if (!File.Exists(themePath)) throw new InvalidOperationException("v1.0.4 convergence resource dictionary is missing");
        if (!File.Exists(coordinatorPath)) throw new InvalidOperationException("v1.0.4 convergence coordinator is missing");
        if (!File.Exists(residencyPath)) throw new InvalidOperationException("v1.0.4 adaptive residency source is missing");

        var theme = File.ReadAllText(themePath);
        var coordinator = File.ReadAllText(coordinatorPath);
        var experience = File.ReadAllText(experiencePath);
        var pipeline = File.ReadAllText(pipelinePath);
        var diagnosticsXaml = File.ReadAllText(diagnosticsXamlPath);
        var diagnosticsCode = File.ReadAllText(diagnosticsCodePath);
        var residency = File.ReadAllText(residencyPath);

        var document = XDocument.Parse(theme);
        XNamespace presentation = "http://schemas.microsoft.com/winfx/2006/xaml/presentation";
        XNamespace x = "http://schemas.microsoft.com/winfx/2006/xaml";
        var styleKeys = document
            .Descendants(presentation + "Style")
            .Select(element => (string?)element.Attribute(x + "Key"))
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToArray();

        foreach (var required in new[]
                 {
                     "ConvergedSurfaceCard", "ConvergedPrimaryButton", "ConvergedSecondaryButton",
                     "ConvergedTextBox", "ConvergedNavButton", "ConvergedPageHeading"
                 })
        {
            if (!styleKeys.Contains(required, StringComparer.Ordinal))
                throw new InvalidOperationException("Missing v1.0.4 convergence style: " + required);
        }

        RequireContains(theme,
            "PART_ContentHost",
            "CornerRadius=\"8\"",
            "ConvergedHomeCard",
            "ConvergedListViewItem");
        RequireAbsent(theme, "DropShadowEffect");

        RequireContains(experience,
            "public HomeDashboardControl Home => _home",
            "public SettingsControl SettingsPage => _settingsControl",
            "case Panel panel:",
            "case ContentControl content:",
            "content.Content = _home",
            "HomeView must be a Panel or ContentControl");

        RequireContains(coordinator,
            "UiAdaptiveAuditService",
            "UiDensityMode.Spacious",
            "UiDensityMode.Standard",
            "UiDensityMode.Compact",
            "VisualTreeHelper.GetDpi",
            "contentWidth >= 680",
            "private readonly HomeDashboardControl _home",
            "private readonly SettingsControl _settingsPage",
            "ApplyHome(_home, mode)",
            "ApplySettings(_settingsPage, mode)",
            "ApplyGenericPage",
            "metrics.Columns = compact ? 2 : 4",
            "GridLength(164)",
            "ReferenceEqualityComparer.Instance");
        RequireAbsent(coordinator,
            "Process.Start",
            "Directory.EnumerateFiles",
            "recentWorkspaceFiles",
            "TerminalOutput",
            "DashboardUrl",
            "GetField(\"_home\"");

        RequireContains(pipeline,
            "Experience = V061ExperienceEnhancer.Attach(window, Base)",
            "UiConvergence = UiConvergenceCoordinator.Attach(window, Experience.Home, Experience.SettingsPage)",
            "public UiConvergenceCoordinator UiConvergence");

        RequireContains(diagnosticsXaml,
            "UiConvergenceResources.xaml",
            "ConvergedSurfaceCard",
            "WrapPanel",
            "界面自适应");
        RequireAbsent(diagnosticsXaml,
            "ColumnDefinition Width=\"150\"",
            "DropShadowEffect");
        RequireContains(diagnosticsCode,
            "checks.Insert(0, UiAdaptiveAuditService.CreateDiagnosticCheck())");

        RequireContains(residency,
            "AssertAdaptiveLayout(window, pipeline.Experience.Home, 1100, 700, UiDensityMode.Compact, 2)",
            "AssertAdaptiveLayout(window, pipeline.Experience.Home, 1320, 780, UiDensityMode.Standard, 4)",
            "AssertAdaptiveLayout(window, pipeline.Experience.Home, 1500, 860, UiDensityMode.Spacious, 4)",
            "new DiagnosticsWindow(pipeline.Settings)");

        Console.WriteLine("PASS AtlasDesk v1.0.4 converges visual hierarchy, supports ScrollViewer home hosting and audits three adaptive modes without collecting user content");
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.0.4 UI convergence token: " + token);
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden v1.0.4 UI convergence token returned: " + token);
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
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.0.4 sources.");
    }
}
