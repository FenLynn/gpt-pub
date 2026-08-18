using System.ComponentModel;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;

namespace PersonalWorkbench;

public sealed class TaskToolCoordinator
{
    private readonly MainWindow _window;
    private readonly WorkspaceControl _workspace;
    private readonly Border? _modulePlaceholder;
    private readonly TaskCenterControl _tasks;
    private readonly ToolsCenterControl _tools;
    private bool _closed;

    private TaskToolCoordinator(MainWindow window, WorkbenchFeaturePipeline pipeline)
    {
        _window = window;
        _workspace = ReadField<WorkspaceControl>(pipeline.Base, "_workspace")
                     ?? throw new InvalidOperationException("Workspace module is unavailable.");
        _modulePlaceholder = ReadField<Border>(pipeline.Base, "_modulePlaceholder");
        _tasks = new TaskCenterControl(pipeline.Settings) { Visibility = Visibility.Collapsed };
        _tools = new ToolsCenterControl(pipeline.Settings) { Visibility = Visibility.Collapsed };

        Install();
        WireNavigation();
        _window.Closing += Window_Closing;
        _window.Closed += Window_Closed;
    }

    public static TaskToolCoordinator Attach(MainWindow window, WorkbenchFeaturePipeline pipeline)
        => new(window, pipeline);

    public TaskCenterControl Tasks => _tasks;
    public ToolsCenterControl Tools => _tools;

    private static T? ReadField<T>(object instance, string name) where T : class
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) as T;

    private void Install()
    {
        if (_window.FindName("PlaceholderView") is not Grid placeholder)
            throw new InvalidOperationException("Task and tool host view is unavailable.");

        placeholder.Children.Add(_tasks);
        placeholder.Children.Add(_tools);
    }

    private void WireNavigation()
    {
        if (_window.FindName("TasksNav") is RadioButton tasksNav)
            tasksNav.Checked += (_, _) => ShowTasks();
        if (_window.FindName("ToolsNav") is RadioButton toolsNav)
            toolsNav.Checked += (_, _) => ShowTools();

        foreach (var name in new[] { "HomeNav", "WorkspaceNav", "LibraryNav", "DevelopmentNav", "DashboardNav", "SettingsNav" })
        {
            if (_window.FindName(name) is RadioButton radio)
                radio.Checked += (_, _) => HideBoth();
        }
    }

    private void ShowTasks()
    {
        PrepareFeatureSurface();
        _tools.Visibility = Visibility.Collapsed;
        _tasks.Visibility = Visibility.Visible;
    }

    private void ShowTools()
    {
        PrepareFeatureSurface();
        _tasks.Visibility = Visibility.Collapsed;
        _tools.Visibility = Visibility.Visible;
    }

    private void PrepareFeatureSurface()
    {
        _workspace.Visibility = Visibility.Collapsed;
        if (_modulePlaceholder is not null)
            _modulePlaceholder.Visibility = Visibility.Collapsed;
    }

    private void HideBoth()
    {
        _tasks.Visibility = Visibility.Collapsed;
        _tools.Visibility = Visibility.Collapsed;
    }

    private void Window_Closing(object? sender, CancelEventArgs e)
    {
        var active = WorkbenchTaskHub.Service.Tasks.Count(task => task.CanCancel);
        if (active == 0)
            return;

        var result = MessageBox.Show(
            _window,
            $"仍有 {active} 个任务正在排队或运行。\n\n退出将取消这些任务，并在历史中记录中断状态。是否继续退出？",
            "AtlasDesk 任务仍在运行",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning);
        if (result != MessageBoxResult.Yes)
            e.Cancel = true;
    }

    private void Window_Closed(object? sender, EventArgs e)
    {
        if (_closed)
            return;
        _closed = true;
        _window.Closing -= Window_Closing;
        _window.Closed -= Window_Closed;
        _tasks.Dispose();
        _tools.Dispose();
        WorkbenchTaskHub.Shutdown();
    }
}
