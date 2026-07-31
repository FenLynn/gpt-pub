using System.Reflection;
using System.Windows;
using System.Windows.Controls;

namespace PersonalWorkbench;

public sealed class V065ToolsEnhancer
{
    private readonly MainWindow _window;
    private readonly ToolsCenterControl _tools;
    private readonly WorkspaceControl _workspace;
    private readonly Border? _modulePlaceholder;

    private V065ToolsEnhancer(MainWindow window, WorkbenchFeaturePipeline pipeline)
    {
        _window = window;
        _workspace = ReadField<WorkspaceControl>(pipeline.Base, "_workspace")
                     ?? throw new InvalidOperationException("Workspace module is unavailable.");
        _modulePlaceholder = ReadField<Border>(pipeline.Base, "_modulePlaceholder");
        _tools = new ToolsCenterControl(pipeline.Settings) { Visibility = Visibility.Collapsed };
        Install();
        WireNavigation();
        _window.Closed += (_, _) => _tools.Dispose();
    }

    public static V065ToolsEnhancer Attach(MainWindow window, WorkbenchFeaturePipeline pipeline) => new(window, pipeline);

    private static T? ReadField<T>(object instance, string name) where T : class
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) as T;

    private void Install()
    {
        if (_window.FindName("PlaceholderView") is not Grid placeholder)
            throw new InvalidOperationException("Tools host view is unavailable.");
        placeholder.Children.Add(_tools);
    }

    private void WireNavigation()
    {
        if (_window.FindName("ToolsNav") is RadioButton toolsNav)
            toolsNav.Checked += (_, _) => ShowTools();

        foreach (var name in new[] { "HomeNav", "WorkspaceNav", "LibraryNav", "DevelopmentNav", "TasksNav", "DashboardNav", "SettingsNav" })
        {
            if (_window.FindName(name) is RadioButton radio) radio.Checked += (_, _) => HideTools();
        }
    }

    private void ShowTools()
    {
        _workspace.Visibility = Visibility.Collapsed;
        if (_modulePlaceholder is not null) _modulePlaceholder.Visibility = Visibility.Collapsed;
        _tools.Visibility = Visibility.Visible;
    }

    private void HideTools() => _tools.Visibility = Visibility.Collapsed;
}
