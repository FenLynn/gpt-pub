using System.Reflection;
using System.Windows;
using System.Windows.Controls;

namespace PersonalWorkbench;

public sealed class V064TaskEnhancer
{
    private readonly MainWindow _window;
    private readonly TaskCenterControl _tasks;
    private readonly WorkspaceControl _workspace;
    private readonly Border? _modulePlaceholder;

    private V064TaskEnhancer(MainWindow window, WorkbenchFeaturePipeline pipeline)
    {
        _window = window;
        _workspace = ReadField<WorkspaceControl>(pipeline.Base, "_workspace")
                     ?? throw new InvalidOperationException("Workspace module is unavailable.");
        _modulePlaceholder = ReadField<Border>(pipeline.Base, "_modulePlaceholder");
        _tasks = new TaskCenterControl(pipeline.Settings) { Visibility = Visibility.Collapsed };
        Install();
        WireNavigation();
        _window.Closed += (_, _) =>
        {
            _tasks.Dispose();
            WorkbenchTaskHub.Shutdown();
        };
    }

    public static V064TaskEnhancer Attach(MainWindow window, WorkbenchFeaturePipeline pipeline) => new(window, pipeline);

    private static T? ReadField<T>(object instance, string name) where T : class
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) as T;

    private void Install()
    {
        if (_window.FindName("PlaceholderView") is not Grid placeholder)
            throw new InvalidOperationException("Task host view is unavailable.");
        placeholder.Children.Add(_tasks);
    }

    private void WireNavigation()
    {
        if (_window.FindName("TasksNav") is RadioButton tasksNav)
            tasksNav.Checked += (_, _) => ShowTasks();

        foreach (var name in new[] { "HomeNav", "WorkspaceNav", "LibraryNav", "DevelopmentNav", "ToolsNav", "DashboardNav", "SettingsNav" })
        {
            if (_window.FindName(name) is RadioButton radio) radio.Checked += (_, _) => HideTasks();
        }
    }

    private void ShowTasks()
    {
        _workspace.Visibility = Visibility.Collapsed;
        if (_modulePlaceholder is not null) _modulePlaceholder.Visibility = Visibility.Collapsed;
        _tasks.Visibility = Visibility.Visible;
    }

    private void HideTasks() => _tasks.Visibility = Visibility.Collapsed;
}
