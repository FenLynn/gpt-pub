using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V105FinalQualityChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var projectRoot = Directory.GetParent(nativeRoot)?.FullName
                          ?? throw new DirectoryNotFoundException("AtlasDesk code root is unavailable.");

        var accessibilityPath = Path.Combine(nativeRoot, "AccessibilityCoordinator.cs");
        var legacyAuditPath = Path.Combine(nativeRoot, "LegacyComponentAudit.cs");
        var themePath = Path.Combine(nativeRoot, "UiConvergenceResources.xaml");
        var pipelinePath = Path.Combine(nativeRoot, "WorkbenchFeaturePipeline.cs");
        var diagnosticsPath = Path.Combine(nativeRoot, "DiagnosticsWindow.xaml.cs");
        var projectPath = Path.Combine(nativeRoot, "PersonalWorkbench.csproj");
        var versionPath = Path.Combine(nativeRoot, "Version.props");
        var v069Path = Path.Combine(nativeRoot, "V069UiFixEnhancer.cs");
        var residencyPath = Path.Combine(projectRoot, "personal-workbench-residency-smoke", "Program.cs");

        foreach (var path in new[]
                 {
                     accessibilityPath, legacyAuditPath, themePath, pipelinePath,
                     diagnosticsPath, projectPath, versionPath, v069Path, residencyPath
                 })
        {
            if (!File.Exists(path))
                throw new InvalidOperationException("Missing v1.0.5 final-quality source: " + path);
        }

        var accessibility = File.ReadAllText(accessibilityPath);
        var legacyAudit = File.ReadAllText(legacyAuditPath);
        var theme = File.ReadAllText(themePath);
        var pipeline = File.ReadAllText(pipelinePath);
        var diagnostics = File.ReadAllText(diagnosticsPath);
        var project = File.ReadAllText(projectPath);
        var version = File.ReadAllText(versionPath);
        var v069 = File.ReadAllText(v069Path);
        var residency = File.ReadAllText(residencyPath);

        RequireContains(version, "<WorkbenchVersion>1.0.5</WorkbenchVersion>");
        RequireContains(project,
            "<Nullable>enable</Nullable>",
            "<WarningsAsErrors>nullable</WarningsAsErrors>",
            "GetItemTypeLabel(string? itemType)",
            "itemType ?? string.Empty",
            "Dispatcher.CheckAccess()",
            "Dispatcher.InvokeAsync(ShowWorkspaceAsync).Task.Unwrap()",
            "ShowWorkspaceCoreAsync",
            "ShowZoteroCoreAsync",
            "ShowWorkspaceFailureCore",
            "element.DesiredSize.Width &lt;= 0",
            "element.DesiredSize.Height &lt;= 0",
            "bounds.Left &gt; 1",
            "bounds.Top &gt; 1",
            "bounds.Right + 1 &lt; element.DesiredSize.Width",
            "bounds.Bottom + 1 &lt; element.DesiredSize.Height",
            "ZoteroLibraryControl.xaml",
            "x:Name=\\&quot;SearchBox\\&quot; Height=\\&quot;29\\&quot;",
            "x:Name=\\&quot;SearchBox\\&quot; Height=\\&quot;32\\&quot;");

        var document = XDocument.Parse(theme);
        XNamespace presentation = "http://schemas.microsoft.com/winfx/2006/xaml/presentation";
        XNamespace x = "http://schemas.microsoft.com/winfx/2006/xaml";
        var focusStyle = document.Descendants(presentation + "Style")
            .FirstOrDefault(element => string.Equals(
                (string?)element.Attribute(x + "Key"),
                "AtlasDeskFocusVisual",
                StringComparison.Ordinal));
        if (focusStyle is null)
            throw new InvalidOperationException("AtlasDeskFocusVisual is missing.");
        RequireContains(theme,
            "DynamicResource {x:Static SystemColors.HighlightBrushKey}",
            "FocusVisualStyle\" Value=\"{StaticResource AtlasDeskFocusVisual}",
            "ConvergedNavButton",
            "MinHeight\" Value=\"24");

        RequireContains(accessibility,
            "public sealed class AccessibilityCoordinator : IDisposable",
            "UiQualityAuditService",
            "AutomationProperties.SetName",
            "AutomationProperties.SetHelpText",
            "AutomationLiveSetting.Polite",
            "KeyboardNavigationMode.Cycle",
            "navigation.IsTabStop = ReferenceEquals(navigation, selected)",
            "SystemParameters.HighContrast",
            "SystemColors.ControlTextBrushKey",
            "control.ReadLocalValue(property)",
            "CriticalLayoutClips",
            "MissingAutomationNames",
            "PrepareAllApplicationWindows",
            "public UiQualityAuditSnapshot AuditNow()");
        RequireAbsent(accessibility,
            "Process.Start",
            "Directory.Enumerate",
            "File.ReadAllText",
            "WorkspaceRoot",
            "DashboardUrl",
            "TerminalOutput",
            "RecentWorkspaceFiles");

        RequireContains(v069,
            "navigation.FocusVisualStyle = null",
            "navigation.IsTabStop = false");
        RequireContains(pipeline,
            "ProjectWorkflow = ProjectWorkflowCoordinator.Attach(window, this)",
            "Accessibility = AccessibilityCoordinator.Attach(window)",
            "public AccessibilityCoordinator Accessibility { get; }");
        var accessibilityIndex = pipeline.IndexOf(
            "Accessibility = AccessibilityCoordinator.Attach(window)",
            StringComparison.Ordinal);
        var finalLegacyIndex = pipeline.IndexOf(
            "ExperiencePolish = V0612ExperienceEnhancer.Attach(window, this)",
            StringComparison.Ordinal);
        if (accessibilityIndex <= finalLegacyIndex)
            throw new InvalidOperationException("AccessibilityCoordinator must attach after every legacy presentation layer.");

        var attachedVersionTypes = Regex.Matches(pipeline, @"\b(V\d+[A-Za-z0-9_]*)\.Attach\(")
            .Select(match => match.Groups[1].Value)
            .ToHashSet(StringComparer.Ordinal);
        var expectedTypes = LegacyComponentAudit.RetainedTypeNames;
        var unexpected = attachedVersionTypes.Except(expectedTypes, StringComparer.Ordinal).OrderBy(value => value).ToArray();
        var missing = expectedTypes.Except(attachedVersionTypes, StringComparer.Ordinal).OrderBy(value => value).ToArray();
        if (unexpected.Length > 0)
            throw new InvalidOperationException("Unreviewed version-named production components: " + string.Join(", ", unexpected));
        if (missing.Length > 0)
            throw new InvalidOperationException("Legacy audit entries are not attached by the pipeline: " + string.Join(", ", missing));

        RequireContains(legacyAudit,
            "public static IReadOnlySet<string> RetainedTypeNames",
            "禁止新增版本号组件",
            "下一阶段必须使用职责命名",
            "V069UiFixEnhancer",
            "AccessibilityCoordinator 最后覆盖");
        RequireContains(diagnostics,
            "AccessibilityCoordinator.PrepareWindow(this)",
            "UiQualityAuditService.CreateDiagnosticCheck()",
            "LegacyComponentAudit.CreateDiagnosticCheck()");

        RequireContains(residency,
            "AssertKeyboardAccessibility(window, pipeline)",
            "AssertCorePageQuality(window, pipeline)",
            "pipeline.Accessibility.AuditNow()",
            "AutomationProperties.GetName",
            "NavigationTabStops != 1",
            "CriticalLayoutClips > 0");

        Console.WriteLine(
            "PASS AtlasDesk v1.0.5 restores keyboard focus after legacy layers, freezes audited compatibility owners, promotes nullable warnings and gates structured UI quality");
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.0.5 final-quality token: " + token);
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden v1.0.5 final-quality token returned: " + token);
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
                if (Directory.Exists(path)) return path;
                current = current.Parent;
            }
        }
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.0.5 sources.");
    }
}
